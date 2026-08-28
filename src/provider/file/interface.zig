const std = @import("std");
const model = @import("../../app/model.zig");

const Io = std.Io;

pub const FileProvider = struct {
    context: *anyopaque,
    vtable: *const VTable,

    pub const VTable = struct {
        getFiles: *const fn (*anyopaque, Io) anyerror![]const []const u8,
        getFile: *const fn (*anyopaque, Io, []const u8) anyerror!model.FileContent,
    };

    /// The provider owns the returned slice and paths.
    pub fn getFiles(self: FileProvider, io: Io) ![]const []const u8 {
        return self.vtable.getFiles(self.context, io);
    }

    /// Alias that describes the operation without prescribing transport naming.
    pub fn listFiles(self: FileProvider, io: Io) ![]const []const u8 {
        return self.getFiles(io);
    }

    /// The provider owns the returned content and any strings within it.
    pub fn getFile(self: FileProvider, io: Io, path: []const u8) !model.FileContent {
        return self.vtable.getFile(self.context, io, path);
    }

    pub fn loadFile(self: FileProvider, io: Io, path: []const u8) !model.FileContent {
        return self.getFile(io, path);
    }
};
