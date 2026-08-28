const std = @import("std");
const dispatcher_module = @import("dispatcher.zig");
const model = @import("model.zig");
const output = @import("../output.zig");
const provider_module = @import("../provider.zig");

const Allocator = std.mem.Allocator;
const Io = std.Io;

pub const Core = struct {
    allocator: Allocator,
    io: Io,
    diff_provider: provider_module.diff.DiffProvider,
    comment_provider: provider_module.comment.CommentProvider,
    clipboard: output.Clipboard,

    pub fn init(
        allocator: Allocator,
        io: Io,
        diff_provider: provider_module.diff.DiffProvider,
        comment_provider: provider_module.comment.CommentProvider,
        clipboard: output.Clipboard,
    ) Core {
        return .{
            .allocator = allocator,
            .io = io,
            .diff_provider = diff_provider,
            .comment_provider = comment_provider,
            .clipboard = clipboard,
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
            .get_diff_overview => .{ .diff_overview = try self.diff_provider.getDiffOverview(self.io) },
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
        };
    }
};

test "copy comments as Markdown serializes all comments and copies once" {
    var threaded: Io.Threaded = .init(std.testing.allocator, .{ .environ = .empty });
    defer threaded.deinit();

    var comments = provider_module.comment.memory.MemoryProvider.init(std.testing.allocator);
    defer comments.deinit();
    _ = try comments.interface().createComment(threaded.io(), "Handle this error.", .{ .line = .{
        .path = "src/main.zig",
        .side = .new,
        .startLine = 7,
        .endLine = 7,
    } });

    const FakeClipboard = struct {
        copied: [128]u8 = undefined,
        copied_len: usize = 0,
        calls: usize = 0,

        fn copy(context: *anyopaque, _: Io, text: []const u8) !void {
            const self: *@This() = @ptrCast(@alignCast(context));
            @memcpy(self.copied[0..text.len], text);
            self.copied_len = text.len;
            self.calls += 1;
        }
    };
    var fake_clipboard: FakeClipboard = .{};
    const clipboard: output.Clipboard = .{
        .context = &fake_clipboard,
        .vtable = &.{ .copy = FakeClipboard.copy },
    };

    var fake_diff_context: u8 = 0;
    const fake_diff: provider_module.diff.DiffProvider = .{
        .context = &fake_diff_context,
        .vtable = &.{
            .getDiffOverview = struct {
                fn get(_: *anyopaque, _: Io) !model.DiffOverview {
                    return error.UnexpectedDiffRequest;
                }
            }.get,
            .getFileDiff = struct {
                fn get(_: *anyopaque, _: Io, _: []const u8, _: []const u8) !model.FileDiff {
                    return error.UnexpectedDiffRequest;
                }
            }.get,
        },
    };

    var core = Core.init(
        std.testing.allocator,
        threaded.io(),
        fake_diff,
        comments.interface(),
        clipboard,
    );
    const response = try core.dispatch(.copy_comments_as_markdown);
    switch (response) {
        .copy_comments_result => |result| try std.testing.expectEqual(@as(usize, 1), result.commentCount),
        else => return error.UnexpectedResponse,
    }
    try std.testing.expectEqual(@as(usize, 1), fake_clipboard.calls);
    try std.testing.expectEqualStrings(
        "- src/main.zig:7 - Handle this error.\n",
        fake_clipboard.copied[0..fake_clipboard.copied_len],
    );
}

test "copy comments as Markdown rejects an empty review" {
    var threaded: Io.Threaded = .init(std.testing.allocator, .{ .environ = .empty });
    defer threaded.deinit();

    var comments = provider_module.comment.memory.MemoryProvider.init(std.testing.allocator);
    defer comments.deinit();
    var unused_context: u8 = 0;
    const unused_diff: provider_module.diff.DiffProvider = .{
        .context = &unused_context,
        .vtable = undefined,
    };
    const unused_clipboard: output.Clipboard = .{
        .context = &unused_context,
        .vtable = undefined,
    };
    var core = Core.init(
        std.testing.allocator,
        threaded.io(),
        unused_diff,
        comments.interface(),
        unused_clipboard,
    );

    try std.testing.expectError(error.NoComments, core.dispatch(.copy_comments_as_markdown));
}

test "copy comments as Markdown propagates clipboard failures" {
    var threaded: Io.Threaded = .init(std.testing.allocator, .{ .environ = .empty });
    defer threaded.deinit();

    var comments = provider_module.comment.memory.MemoryProvider.init(std.testing.allocator);
    defer comments.deinit();
    _ = try comments.interface().createComment(threaded.io(), "Explain this branch.", .{
        .file = .{ .path = "src/main.zig" },
    });

    const FailingClipboard = struct {
        fn copy(_: *anyopaque, _: Io, _: []const u8) !void {
            return error.ClipboardCommandFailed;
        }
    };
    var unused_context: u8 = 0;
    const unused_diff: provider_module.diff.DiffProvider = .{
        .context = &unused_context,
        .vtable = undefined,
    };
    const clipboard: output.Clipboard = .{
        .context = &unused_context,
        .vtable = &.{ .copy = FailingClipboard.copy },
    };
    var core = Core.init(
        std.testing.allocator,
        threaded.io(),
        unused_diff,
        comments.interface(),
        clipboard,
    );

    try std.testing.expectError(
        error.ClipboardCommandFailed,
        core.dispatch(.copy_comments_as_markdown),
    );
}

fn validComment(body: []const u8, target: model.CommentTarget) bool {
    if (std.mem.trim(u8, body, " \t\r\n").len == 0) return false;
    return switch (target) {
        .file => |details| details.path.len > 0,
        .line => |details| details.path.len > 0 and
            details.startLine > 0 and
            details.endLine >= details.startLine,
    };
}
