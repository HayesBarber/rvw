const std = @import("std");

const Allocator = std.mem.Allocator;
const Io = std.Io;

pub const Level = enum {
    debug,
    info,
    warning,
    err,

    pub fn jsonStringify(self: Level, writer: *std.json.Stringify) !void {
        try writer.write(switch (self) {
            .debug => "debug",
            .info => "info",
            .warning => "warning",
            .err => "error",
        });
    }
};

pub const Source = enum {
    backend,
};

pub const Event = struct {
    level: Level,
    source: Source,
    message: []const u8,
    context: ?std.json.Value = null,
};

pub const Logger = struct {
    allocator: Allocator,
    context: *anyopaque,
    vtable: *const VTable,

    pub const VTable = struct {
        write: *const fn (*anyopaque, Io, Event) anyerror!void,
    };

    /// Logging is intentionally non-fatal. A sink failure is reported to
    /// stderr, along with the original event when it can be encoded.
    pub fn log(self: Logger, io: Io, event: Event) void {
        self.vtable.write(self.context, io, event) catch |err| {
            writeFallback(self.allocator, io, event, err);
        };
    }
};

pub fn encodeEvent(allocator: Allocator, io: Io, event: Event) ![]u8 {
    return std.json.Stringify.valueAlloc(allocator, .{
        .timestamp = Io.Timestamp.now(io, .real).toMilliseconds(),
        .level = event.level,
        .source = event.source,
        .message = event.message,
        .context = event.context,
    }, .{ .emit_null_optional_fields = false });
}

fn writeFallback(allocator: Allocator, io: Io, event: Event, err: anyerror) void {
    const encoded = encodeEvent(allocator, io, event) catch null;
    defer if (encoded) |bytes| allocator.free(bytes);
    if (encoded) |bytes| {
        Io.File.stderr().writeStreamingAll(io, bytes) catch {};
        Io.File.stderr().writeStreamingAll(io, "\n") catch {};
    }
    std.log.err("application log sink failed: {t}", .{err});
}
