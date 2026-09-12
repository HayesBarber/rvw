const std = @import("std");

const Io = std.Io;

pub const FileTreeProvider = struct {
    context: *anyopaque,
    vtable: *const VTable,

    pub const VTable = struct {
        getFiles: *const fn (*anyopaque, Io) anyerror![]const []const u8,
    };

    /// The provider owns the returned slice and paths.
    pub fn getFiles(self: FileTreeProvider, io: Io) ![]const []const u8 {
        return self.vtable.getFiles(self.context, io);
    }

    /// Alias that describes the operation without prescribing transport naming.
    pub fn listFiles(self: FileTreeProvider, io: Io) ![]const []const u8 {
        return self.getFiles(io);
    }
};
