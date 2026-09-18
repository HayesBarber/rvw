const std = @import("std");

const Allocator = std.mem.Allocator;
const Io = std.Io;

pub const Level = enum {
    debug,
    info,
    warning,
    err,

    pub fn parse(value: []const u8) ?Level {
        inline for (.{ .{ "debug", Level.debug }, .{ "info", Level.info }, .{ "warning", Level.warning }, .{ "warn", Level.warning }, .{ "error", Level.err }, .{ "err", Level.err } }) |entry| {
            if (std.mem.eql(u8, value, entry[0])) return entry[1];
        }
        return null;
    }

    pub fn resolve(io: Io, value: ?[]const u8) Level {
        return parse(value orelse return .err) orelse blk: {
            Io.File.stderr().writeStreamingAll(io, "invalid LOG_LEVEL; using error\n") catch {};
            break :blk .err;
        };
    }

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
    traceId: ?[]const u8 = null,
};

pub const Logger = struct {
    allocator: Allocator,
    context: *anyopaque,
    vtable: *const VTable,
    minimum_level: Level = .err,

    pub const VTable = struct {
        write: *const fn (*anyopaque, Io, Event) anyerror!void,
    };

    /// Logging is intentionally non-fatal. A sink failure is reported to
    /// stderr, along with the original event when it can be encoded.
    pub fn log(self: Logger, io: Io, event: Event) void {
        if (@intFromEnum(event.level) < @intFromEnum(self.minimum_level)) return;
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
        .traceId = event.traceId,
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

test "encoded events omit absent optional context" {
    const encoded = try encodeEvent(std.testing.allocator, std.testing.io, .{
        .level = .info,
        .source = .backend,
        .message = "application started",
    });
    defer std.testing.allocator.free(encoded);
    var parsed = try std.json.parseFromSlice(std.json.Value, std.testing.allocator, encoded, .{});
    defer parsed.deinit();

    const object = parsed.value.object;
    try std.testing.expectEqualStrings("info", object.get("level").?.string);
    try std.testing.expectEqualStrings("backend", object.get("source").?.string);
    try std.testing.expectEqualStrings("application started", object.get("message").?.string);
    try std.testing.expect(object.get("timestamp") != null);
    try std.testing.expect(object.get("context") == null);
    try std.testing.expect(object.get("traceId") == null);
}

test "severity aliases and authoritative threshold cover every event level" {
    try std.testing.expectEqual(Level.warning, Level.parse("warn").?);
    try std.testing.expectEqual(Level.err, Level.parse("err").?);
    try std.testing.expectEqual(Level.err, Level.resolve(std.testing.io, null));
    for ([_][]const u8{ "", "ERROR", "secret-token", " info" }) |invalid| try std.testing.expect(Level.parse(invalid) == null);
    const Counter = struct {
        count: usize = 0,
        fn write(ptr: *anyopaque, _: Io, _: Event) !void {
            const self: *@This() = @ptrCast(@alignCast(ptr));
            self.count += 1;
        }
    };
    for (std.enums.values(Level)) |threshold| {
        var counter: Counter = .{};
        const logger: Logger = .{ .allocator = std.testing.allocator, .context = &counter, .vtable = &.{ .write = Counter.write }, .minimum_level = threshold };
        for (std.enums.values(Level)) |level| logger.log(std.testing.io, .{ .level = level, .source = .frontend, .message = "test" });
        try std.testing.expectEqual(4 - @as(usize, @intFromEnum(threshold)), counter.count);
    }
}

/// Optional monotonic timing. No clock reads or allocations below debug level.
pub const Timing = struct {
    logger: Logger,
    io: Io,
    start: Io.Timestamp,

    pub fn begin(logger: Logger, io: Io) ?Timing {
        if (logger.minimum_level != .debug) return null;
        return .{ .logger = logger, .io = io, .start = Io.Timestamp.now(io, .awake) };
    }

    pub fn finish(self: Timing, stage: []const u8, trace_id: ?[]const u8) void {
        const duration = Io.Timestamp.now(self.io, .awake).nanoseconds - self.start.nanoseconds;
        var context: std.json.ObjectMap = .empty;
        defer context.deinit(self.logger.allocator);
        context.put(self.logger.allocator, "stage", .{ .string = stage }) catch return;
        context.put(self.logger.allocator, "durationMs", .{ .float = @as(f64, @floatFromInt(duration)) / 1_000_000 }) catch return;
        self.logger.log(self.io, .{ .level = .debug, .source = .backend, .message = "file load timing", .traceId = trace_id, .context = .{ .object = context } });
    }
};
