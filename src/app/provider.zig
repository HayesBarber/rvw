const std = @import("std");
const model = @import("model.zig");

const Io = std.Io;

pub const ReviewProvider = struct {
    context: *anyopaque,
    vtable: *const VTable,

    pub const VTable = struct {
        getOverview: *const fn (*anyopaque, Io) anyerror!model.ReviewOverview,
        getFileReview: *const fn (*anyopaque, Io, []const u8, []const u8) anyerror!model.FileReview,
    };

    pub fn getOverview(self: ReviewProvider, io: Io) !model.ReviewOverview {
        return self.vtable.getOverview(self.context, io);
    }

    pub fn getFileReview(self: ReviewProvider, io: Io, review_id: []const u8, path: []const u8) !model.FileReview {
        return self.vtable.getFileReview(self.context, io, review_id, path);
    }
};
