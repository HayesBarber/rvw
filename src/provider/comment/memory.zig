const std = @import("std");
const model = @import("../../app/model.zig");
const comment_provider = @import("interface.zig");

const Allocator = std.mem.Allocator;
const Io = std.Io;

pub const MemoryProvider = struct {
    const maximum_comment_count = 256;

    allocator: Allocator,
    mutex: std.Io.Mutex = .init,
    comments: [maximum_comment_count]model.Comment = undefined,
    comment_count: usize = 0,
    next_comment_id: usize = 1,

    pub fn init(allocator: Allocator) MemoryProvider {
        return .{ .allocator = allocator };
    }

    pub fn deinit(self: *MemoryProvider) void {
        for (self.comments[0..self.comment_count]) |comment| {
            self.allocator.free(comment.id);
            self.allocator.free(comment.body);
            freeTarget(self.allocator, comment.target);
        }
        self.* = undefined;
    }

    pub fn interface(self: *MemoryProvider) comment_provider.CommentProvider {
        return .{ .context = self, .vtable = &vtable };
    }

    fn createComment(
        context: *anyopaque,
        io: Io,
        body: []const u8,
        target: model.CommentTarget,
    ) !model.Comment {
        const self: *MemoryProvider = @ptrCast(@alignCast(context));
        self.mutex.lockUncancelable(io);
        defer self.mutex.unlock(io);

        if (self.comment_count == maximum_comment_count) return error.CommentLimitReached;

        // Keep all caller-owned input alive for the lifetime of the provider.
        const owned_id = try std.fmt.allocPrint(self.allocator, "comment-{d}", .{self.next_comment_id});
        errdefer self.allocator.free(owned_id);
        const owned_body = try self.allocator.dupe(u8, body);
        errdefer self.allocator.free(owned_body);
        const owned_target = try duplicateTarget(self.allocator, target);
        errdefer freeTarget(self.allocator, owned_target);

        const comment: model.Comment = .{
            .id = owned_id,
            .body = owned_body,
            .target = owned_target,
        };
        self.comments[self.comment_count] = comment;
        self.comment_count += 1;
        self.next_comment_id += 1;
        return comment;
    }

    fn getComments(context: *anyopaque, io: Io) ![]const model.Comment {
        const self: *MemoryProvider = @ptrCast(@alignCast(context));
        self.mutex.lockUncancelable(io);
        defer self.mutex.unlock(io);
        return self.comments[0..self.comment_count];
    }

    const vtable: comment_provider.CommentProvider.VTable = .{
        .createComment = createComment,
        .getComments = getComments,
    };
};

fn duplicateTarget(allocator: Allocator, target: model.CommentTarget) !model.CommentTarget {
    return switch (target) {
        .file => |details| .{ .file = .{
            .path = try allocator.dupe(u8, details.path),
        } },
        .line => |details| .{ .line = .{
            .path = try allocator.dupe(u8, details.path),
            .side = details.side,
            .startLine = details.startLine,
            .endLine = details.endLine,
        } },
    };
}

fn freeTarget(allocator: Allocator, target: model.CommentTarget) void {
    allocator.free(switch (target) {
        .file => |details| details.path,
        .line => |details| details.path,
    });
}
