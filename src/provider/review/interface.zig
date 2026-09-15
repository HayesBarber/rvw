const std = @import("std");
const model = @import("../../app/model.zig");

const Io = std.Io;

/// Owns the reloadable repository snapshot used by a review session.
pub const ReviewProvider = struct {
    context: *anyopaque,
    vtable: *const VTable,

    pub const VTable = struct {
        getDiffOverview: *const fn (*anyopaque, Io) anyerror!model.DiffOverview,
        getFileDiff: *const fn (*anyopaque, Io, []const u8, []const u8) anyerror!model.FileDiff,
        getFiles: *const fn (*anyopaque, Io) anyerror![]const []const u8,
        getFilesNotIgnored: *const fn (*anyopaque, Io) anyerror![]const []const u8,
        getFile: *const fn (*anyopaque, Io, []const u8) anyerror!model.FileContent,
        reload: *const fn (*anyopaque, Io) anyerror!void,
        repositoryRoot: *const fn (*anyopaque) []const u8,
    };

    pub fn getDiffOverview(self: ReviewProvider, io: Io) !model.DiffOverview {
        return self.vtable.getDiffOverview(self.context, io);
    }

    pub fn getFileDiff(self: ReviewProvider, io: Io, diff_id: []const u8, path: []const u8) !model.FileDiff {
        return self.vtable.getFileDiff(self.context, io, diff_id, path);
    }

    pub fn getFiles(self: ReviewProvider, io: Io) ![]const []const u8 {
        return self.vtable.getFiles(self.context, io);
    }

    pub fn getFilesNotIgnored(self: ReviewProvider, io: Io) ![]const []const u8 {
        return self.vtable.getFilesNotIgnored(self.context, io);
    }

    pub fn getFile(self: ReviewProvider, io: Io, path: []const u8) !model.FileContent {
        return self.vtable.getFile(self.context, io, path);
    }

    pub fn reload(self: ReviewProvider, io: Io) !void {
        return self.vtable.reload(self.context, io);
    }

    pub fn repositoryRoot(self: ReviewProvider) []const u8 {
        return self.vtable.repositoryRoot(self.context);
    }
};
