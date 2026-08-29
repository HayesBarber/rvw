const std = @import("std");
const dispatcher_module = @import("dispatcher.zig");
const model = @import("model.zig");
const log = @import("../log.zig");
const output = @import("../output.zig");
const provider_module = @import("../provider.zig");

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

    pub fn init(
        allocator: Allocator,
        io: Io,
        diff_provider: provider_module.diff.DiffProvider,
        file_provider: provider_module.file.FileProvider,
        comment_provider: provider_module.comment.CommentProvider,
        clipboard: output.Clipboard,
        logger: log.Logger,
    ) Core {
        return .{
            .allocator = allocator,
            .io = io,
            .diff_provider = diff_provider,
            .file_provider = file_provider,
            .comment_provider = comment_provider,
            .clipboard = clipboard,
            .logger = logger,
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
            .log => |details| blk: {
                if (!validLogMessage(details.message)) return error.InvalidLogEntry;
                self.logger.log(self.io, .{
                    .level = details.level,
                    .source = .frontend,
                    .message = details.message,
                    .context = details.context,
                    .metrics = details.metrics,
                });
                break :blk .{ .log = .{} };
            },
        };
    }
};

fn validComment(body: []const u8, target: model.CommentTarget) bool {
    if (std.mem.trim(u8, body, " \t\r\n").len == 0) return false;
    return switch (target) {
        .file => |details| details.path.len > 0,
        .line => |details| details.path.len > 0 and
            details.startLine > 0 and
            details.endLine >= details.startLine,
    };
}

fn validLogMessage(message: []const u8) bool {
    return message.len > 0 and
        message.len <= log.maximum_message_size and
        std.unicode.utf8ValidateSlice(message);
}
