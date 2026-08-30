const std = @import("std");
const model = @import("../../app/model.zig");

const Io = std.Io;

pub const CommentProvider = struct {
    context: *anyopaque,
    vtable: *const VTable,

    pub const VTable = struct {
        createComment: *const fn (*anyopaque, Io, []const u8, model.CommentTarget) anyerror!model.Comment,
        getComments: *const fn (*anyopaque, Io) anyerror![]const model.Comment,
        editComment: *const fn (*anyopaque, Io, []const u8, []const u8) anyerror!model.Comment,
        deleteComment: *const fn (*anyopaque, Io, []const u8) anyerror!void,
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

    /// Replaces only the body of the identified comment. The provider owns
    /// the returned comment and preserves its ID and target.
    pub fn editComment(
        self: CommentProvider,
        io: Io,
        comment_id: []const u8,
        body: []const u8,
    ) !model.Comment {
        return self.vtable.editComment(self.context, io, comment_id, body);
    }

    pub fn deleteComment(self: CommentProvider, io: Io, comment_id: []const u8) !void {
        return self.vtable.deleteComment(self.context, io, comment_id);
    }
};
