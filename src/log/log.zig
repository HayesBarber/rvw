const std = @import("std");

pub const interface = @import("interface.zig");
pub const file = @import("file.zig");
pub const stderr = @import("stderr.zig");

pub const Level = interface.Level;
pub const Source = interface.Source;
pub const Event = interface.Event;
pub const Logger = interface.Logger;
pub const Environment = file.Environment;
pub const FileLogger = file.FileLogger;
pub const maximum_file_count = file.maximum_file_count;
pub const encodeEvent = interface.encodeEvent;
pub const stderrLogger = stderr.logger;

/// Owns the preferred file logger when it can be created and otherwise exposes
/// the stderr implementation. This keeps application entry points from
/// duplicating logger setup and fallback behavior.
pub const DefaultLogger = struct {
    allocator: std.mem.Allocator,
    file_logger: ?FileLogger,

    pub fn init(allocator: std.mem.Allocator, io: std.Io, environment: Environment) DefaultLogger {
        const file_logger = FileLogger.init(allocator, io, environment) catch |err| {
            std.log.err("unable to create application log file: {t}", .{err});
            return .{ .allocator = allocator, .file_logger = null };
        };
        return .{ .allocator = allocator, .file_logger = file_logger };
    }

    pub fn interface(self: *DefaultLogger) Logger {
        if (self.file_logger) |*file_logger| return file_logger.interface();
        return stderrLogger(self.allocator);
    }

    pub fn deinit(self: *DefaultLogger) void {
        if (self.file_logger) |*file_logger| file_logger.deinit();
        self.* = undefined;
    }
};
