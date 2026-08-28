const std = @import("std");
const dispatcher_module = @import("dispatcher.zig");
const model = @import("model.zig");
const provider_module = @import("../provider.zig");

const Allocator = std.mem.Allocator;
const Io = std.Io;

pub const Core = struct {
    allocator: Allocator,
    io: Io,
    diff_provider: provider_module.diff.DiffProvider,
    comment_provider: provider_module.comment.CommentProvider,

    pub fn init(
        allocator: Allocator,
        io: Io,
        diff_provider: provider_module.diff.DiffProvider,
        comment_provider: provider_module.comment.CommentProvider,
    ) Core {
        return .{
            .allocator = allocator,
            .io = io,
            .diff_provider = diff_provider,
            .comment_provider = comment_provider,
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

fn validComment(body: []const u8, target: model.CommentTarget) bool {
    if (std.mem.trim(u8, body, " \t\r\n").len == 0) return false;
    return switch (target) {
        .file => |details| details.path.len > 0,
        .line => |details| details.path.len > 0 and
            details.startLine > 0 and
            details.endLine >= details.startLine,
    };
}
