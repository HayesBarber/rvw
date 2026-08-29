const std = @import("std");

const Allocator = std.mem.Allocator;
const Io = std.Io;

pub const maximum_message_size = 16 * 1024;

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
    frontend,
};

pub const Event = struct {
    level: Level,
    source: Source,
    message: []const u8,
    context: ?std.json.Value = null,
    metrics: ?std.json.Value = null,
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
        .metrics = event.metrics,
    }, .{ .emit_null_optional_fields = true });
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

test "event encoding produces a structured wide event" {
    var context = std.json.ObjectMap.init(std.testing.allocator);
    defer context.deinit();
    try context.put("path", .{ .string = "src/main.zig" });
    var metrics = std.json.ObjectMap.init(std.testing.allocator);
    defer metrics.deinit();
    try metrics.put("durationMs", .{ .integer = 12 });

    const encoded = try encodeEvent(std.testing.allocator, std.testing.io, .{
        .level = .warning,
        .source = .backend,
        .message = "slow operation",
        .context = .{ .object = context },
        .metrics = .{ .object = metrics },
    });
    defer std.testing.allocator.free(encoded);

    var parsed = try std.json.parseFromSlice(std.json.Value, std.testing.allocator, encoded, .{});
    defer parsed.deinit();
    const object = parsed.value.object;
    try std.testing.expect(object.get("timestamp").? == .integer);
    try std.testing.expectEqualStrings("warning", object.get("level").?.string);
    try std.testing.expectEqualStrings("backend", object.get("source").?.string);
    try std.testing.expectEqualStrings("slow operation", object.get("message").?.string);
    try std.testing.expectEqualStrings("src/main.zig", object.get("context").?.object.get("path").?.string);
    try std.testing.expectEqual(@as(i64, 12), object.get("metrics").?.object.get("durationMs").?.integer);
}

test "sink failures are non-fatal" {
    const Failing = struct {
        fn write(_: *anyopaque, _: Io, _: Event) !void {
            return error.SimulatedWriteFailure;
        }
    };
    var context: u8 = 0;
    const logger: Logger = .{
        .allocator = std.testing.allocator,
        .context = &context,
        .vtable = &.{ .write = Failing.write },
    };
    logger.log(std.testing.io, .{ .level = .err, .source = .backend, .message = "still running" });
}
