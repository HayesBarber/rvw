const std = @import("std");
const config = @import("../config/config.zig");
const dispatcher_module = @import("dispatcher.zig");
const model = @import("model.zig");
const log = @import("../log/log.zig");
const output = @import("../output/output.zig");
const provider_module = @import("../provider/provider.zig");

const Allocator = std.mem.Allocator;
const Io = std.Io;

pub const Core = struct {
    allocator: Allocator,
    io: Io,
    diff_provider: provider_module.diff.DiffProvider,
    file_provider: provider_module.file.FileProvider,
    comment_provider: provider_module.comment.CommentProvider,
    clipboard: output.Clipboard,
    logger: log.Logger,
    configuration: config.Snapshot,

    pub fn init(
        allocator: Allocator,
        io: Io,
        diff_provider: provider_module.diff.DiffProvider,
        file_provider: provider_module.file.FileProvider,
        comment_provider: provider_module.comment.CommentProvider,
        clipboard: output.Clipboard,
        logger: log.Logger,
        configuration: config.Snapshot,
    ) Core {
        return .{
            .allocator = allocator,
            .io = io,
            .diff_provider = diff_provider,
            .file_provider = file_provider,
            .comment_provider = comment_provider,
            .clipboard = clipboard,
            .logger = logger,
            .configuration = configuration,
        };
    }

    pub fn dispatcher(self: *Core) dispatcher_module.Dispatcher {
        return .{ .context = self, .dispatchFn = dispatchOpaque };
    }

    fn dispatchOpaque(context: *anyopaque, request: model.Request) !model.Response {
        const self: *Core = @ptrCast(@alignCast(context));
        return self.dispatch(request);
    }

    pub fn dispatch(self: *Core, request: model.Request) !model.Response {
        return switch (request) {
            .get_configuration => .{ .configuration = self.configuration },
            .get_diff_overview => .{ .diff_overview = try self.diff_provider.getDiffOverview(self.io) },
            .get_files => .{ .files = try self.file_provider.getFiles(self.io) },
            .get_file => |details| .{ .file = .{
                .path = details.path,
                .status = .unchanged,
                .content = try self.file_provider.getFile(self.io, details.path),
            } },
            .get_file_diff => |details| .{
                .file_diff = try self.diff_provider.getFileDiff(self.io, details.diff_id, details.path),
            },
            .get_comments => .{ .comments = try self.comment_provider.getComments(self.io) },
            .copy_comments_as_markdown => blk: {
                const comments = try self.comment_provider.getComments(self.io);
                if (comments.len == 0) return error.NoComments;

                const markdown = try output.markdown.serialize(self.allocator, comments);
                defer self.allocator.free(markdown);
                try self.clipboard.copy(self.io, markdown);
                break :blk .{ .copy_comments_result = .{ .commentCount = comments.len } };
            },
            .create_comment => |details| blk: {
                if (!validComment(details.body, details.target)) return error.InvalidComment;
                break :blk .{ .comment = try self.comment_provider.createComment(
                    self.io,
                    details.body,
                    details.target,
                ) };
            },
            .edit_comment => |details| blk: {
                if (!validCommentId(details.comment_id)) return error.InvalidCommentId;
                if (!validCommentBody(details.body)) return error.InvalidComment;
                break :blk .{ .comment = try self.comment_provider.editComment(
                    self.io,
                    details.comment_id,
                    details.body,
                ) };
            },
            .delete_comment => |details| blk: {
                if (!validCommentId(details.comment_id)) return error.InvalidCommentId;
                try self.comment_provider.deleteComment(self.io, details.comment_id);
                break :blk .{ .delete_comment_result = .{ .commentId = details.comment_id } };
            },
        };
    }
};

fn validComment(body: []const u8, target: model.CommentTarget) bool {
    if (!validCommentBody(body)) return false;
    return switch (target) {
        .file => |details| details.path.len > 0,
        .line => |details| details.path.len > 0 and
            details.startLine > 0 and
            details.endLine >= details.startLine,
    };
}

fn validCommentBody(body: []const u8) bool {
    return std.mem.trim(u8, body, " \t\r\n").len > 0 and
        std.unicode.utf8ValidateSlice(body);
}

fn validCommentId(comment_id: []const u8) bool {
    return comment_id.len > 0 and
        comment_id.len <= 128 and
        std.mem.trim(u8, comment_id, " \t\r\n").len == comment_id.len and
        std.unicode.utf8ValidateSlice(comment_id);
}

test "comment mutation validation rejects blank bodies and malformed IDs" {
    try std.testing.expect(validCommentBody("updated"));
    try std.testing.expect(!validCommentBody(" \n\t"));
    try std.testing.expect(validCommentId("comment-12"));
    try std.testing.expect(!validCommentId(""));
    try std.testing.expect(!validCommentId(" comment-12"));
}

test "core edits and deletes only the requested comment with useful errors" {
    const TestDependencies = struct {
        fn getDiffOverview(_: *anyopaque, _: Io) !model.DiffOverview {
            return error.TestUnexpectedResult;
        }

        fn getFileDiff(_: *anyopaque, _: Io, _: []const u8, _: []const u8) !model.FileDiff {
            return error.TestUnexpectedResult;
        }

        fn getFiles(_: *anyopaque, _: Io) ![]const []const u8 {
            return &.{};
        }

        fn getFile(_: *anyopaque, _: Io, _: []const u8) !model.FileContent {
            return error.UnknownFile;
        }

        fn copy(_: *anyopaque, _: Io, _: []const u8) !void {}
        fn writeLog(_: *anyopaque, _: Io, _: log.Event) !void {}

        const diff_vtable: provider_module.diff.DiffProvider.VTable = .{
            .getDiffOverview = getDiffOverview,
            .getFileDiff = getFileDiff,
        };
        const file_vtable: provider_module.file.FileProvider.VTable = .{
            .getFiles = getFiles,
            .getFile = getFile,
        };
        const clipboard_vtable: output.Clipboard.VTable = .{ .copy = copy };
        const logger_vtable: log.Logger.VTable = .{ .write = writeLog };
    };

    var threaded: std.Io.Threaded = .init(std.testing.allocator, .{});
    defer threaded.deinit();
    var context: u8 = 0;
    var comments = provider_module.comment.memory.MemoryProvider.init(std.testing.allocator);
    defer comments.deinit();
    var core = Core.init(
        std.testing.allocator,
        threaded.io(),
        .{ .context = &context, .vtable = &TestDependencies.diff_vtable },
        .{ .context = &context, .vtable = &TestDependencies.file_vtable },
        comments.interface(),
        .{ .context = &context, .vtable = &TestDependencies.clipboard_vtable },
        .{
            .allocator = std.testing.allocator,
            .context = &context,
            .vtable = &TestDependencies.logger_vtable,
        },
        .{ .configuration = .{ .object = .empty }, .diagnostic = null },
    );

    const first = (try core.dispatch(.{ .create_comment = .{
        .body = "first",
        .target = .{ .file = .{ .path = "README.md" } },
    } })).comment;
    const second = (try core.dispatch(.{ .create_comment = .{
        .body = "second",
        .target = .{ .file = .{ .path = "LICENSE" } },
    } })).comment;
    const first_id = try std.testing.allocator.dupe(u8, first.id);
    defer std.testing.allocator.free(first_id);

    const edited = (try core.dispatch(.{ .edit_comment = .{
        .comment_id = first_id,
        .body = "updated",
    } })).comment;
    try std.testing.expectEqualStrings(first_id, edited.id);
    try std.testing.expectEqualStrings("updated", edited.body);
    try std.testing.expectEqualStrings("README.md", edited.target.file.path);
    try std.testing.expectError(error.InvalidComment, core.dispatch(.{ .edit_comment = .{
        .comment_id = first_id,
        .body = "  \n",
    } }));
    try std.testing.expectError(error.InvalidCommentId, core.dispatch(.{ .delete_comment = .{
        .comment_id = " invalid",
    } }));
    try std.testing.expectError(error.UnknownComment, core.dispatch(.{ .edit_comment = .{
        .comment_id = "comment-99",
        .body = "missing",
    } }));

    const deleted = (try core.dispatch(.{ .delete_comment = .{
        .comment_id = first_id,
    } })).delete_comment_result;
    try std.testing.expectEqualStrings(first_id, deleted.commentId);
    try std.testing.expectError(error.UnknownComment, core.dispatch(.{ .delete_comment = .{
        .comment_id = first_id,
    } }));
    const remaining = (try core.dispatch(.get_comments)).comments;
    try std.testing.expectEqual(@as(usize, 1), remaining.len);
    try std.testing.expectEqualStrings(second.id, remaining[0].id);
    try std.testing.expectEqualStrings("second", remaining[0].body);
}
