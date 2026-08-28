const std = @import("std");
const model = @import("../../app/model.zig");

const Io = std.Io;

pub const DiffProvider = struct {
    context: *anyopaque,
    vtable: *const VTable,

    pub const VTable = struct {
        getDiffOverview: *const fn (*anyopaque, Io) anyerror!model.DiffOverview,
        getFileDiff: *const fn (*anyopaque, Io, []const u8, []const u8) anyerror!model.FileDiff,
    };

    pub fn getDiffOverview(self: DiffProvider, io: Io) !model.DiffOverview {
        return self.vtable.getDiffOverview(self.context, io);
    }

    pub fn getFileDiff(self: DiffProvider, io: Io, diff_id: []const u8, path: []const u8) !model.FileDiff {
        return self.vtable.getFileDiff(self.context, io, diff_id, path);
    }
};
