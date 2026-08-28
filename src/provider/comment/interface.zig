const std = @import("std");
const model = @import("../../app/model.zig");

const Io = std.Io;

pub const CommentProvider = struct {
    context: *anyopaque,
    vtable: *const VTable,

    pub const VTable = struct {
        createComment: *const fn (*anyopaque, Io, []const u8, model.CommentTarget) anyerror!model.Comment,
        getComments: *const fn (*anyopaque, Io) anyerror![]const model.Comment,
    };

    /// The provider owns the returned comment and any strings within it.
    pub fn createComment(
        self: CommentProvider,
        io: Io,
        body: []const u8,
        target: model.CommentTarget,
    ) !model.Comment {
        return self.vtable.createComment(self.context, io, body, target);
    }

    /// The provider owns the returned slice and comments.
    pub fn getComments(self: CommentProvider, io: Io) ![]const model.Comment {
        return self.vtable.getComments(self.context, io);
    }
};
