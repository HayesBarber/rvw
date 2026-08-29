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

pub const Event = struct {
    level: Level,
    source: []const u8,
    message: []const u8,
    context: ?std.json.Value = null,
    metrics: ?std.json.Value = null,
};

const EncodedEvent = struct {
    timestamp: i64,
    level: Level,
    source: []const u8,
    message: []const u8,
    context: ?std.json.Value,
    metrics: ?std.json.Value,
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

pub const Environment = struct {
    home: ?[]const u8 = null,
    xdg_state_home: ?[]const u8 = null,
    temporary_directory: ?[]const u8 = null,
};

pub const FileLogger = struct {
    allocator: Allocator,
    io: Io,
    file: Io.File,
    path: []u8,
    mutex: Io.Mutex = .init,
    lifecycle_mutex: Io.Mutex = .init,
    lifecycle_condition: Io.Condition = .init,
    active_writes: usize = 0,
    closing: bool = false,

    /// Creates one new timestamped JSONL file for this process launch. The
    /// preferred platform directory is attempted first, then the OS temporary
    /// directory. The caller owns the logger and must call `deinit`.
    pub fn init(allocator: Allocator, io: Io, environment: Environment) !FileLogger {
        const preferred = try preferredDirectory(allocator, environment);
        defer if (preferred) |path| allocator.free(path);

        if (preferred) |directory| {
            if (initInDirectory(allocator, io, directory)) |logger| return logger else |_| {}
        }

        const fallback = environment.temporary_directory orelse defaultTemporaryDirectory();
        return initInDirectory(allocator, io, fallback);
    }

    pub fn initInDirectory(allocator: Allocator, io: Io, directory: []const u8) !FileLogger {
        try Io.Dir.cwd().createDirPath(io, directory);
        const timestamp = Io.Timestamp.now(io, .real).toNanoseconds();
        const filename = try std.fmt.allocPrint(allocator, "rvw-{d}.jsonl", .{timestamp});
        defer allocator.free(filename);
        const path = try std.fs.path.join(allocator, &.{ directory, filename });
        errdefer allocator.free(path);
        const file = try Io.Dir.createFileAbsolute(io, path, .{
            .truncate = false,
            .exclusive = true,
        });
        return .{
            .allocator = allocator,
            .io = io,
            .file = file,
            .path = path,
        };
    }

    pub fn interface(self: *FileLogger) Logger {
        return .{
            .allocator = self.allocator,
            .context = self,
            .vtable = &vtable,
        };
    }

    /// Stops new writes and waits for every write already admitted by this
    /// logger before closing the file. As with any interface backed by an
    /// object pointer, the owner must stop request producers before destroying
    /// the object so no call begins after `deinit`.
    pub fn deinit(self: *FileLogger) void {
        self.lifecycle_mutex.lockUncancelable(self.io);
        self.closing = true;
        while (self.active_writes != 0) {
            self.lifecycle_condition.waitUncancelable(self.io, &self.lifecycle_mutex);
        }
        self.lifecycle_mutex.unlock(self.io);

        self.file.close(self.io);
        self.allocator.free(self.path);
        self.* = undefined;
    }

    fn write(context: *anyopaque, io: Io, event: Event) !void {
        const self: *FileLogger = @ptrCast(@alignCast(context));
        if (!self.beginWrite(io)) return error.LoggerClosed;
        defer self.finishWrite(io);

        self.mutex.lockUncancelable(io);
        defer self.mutex.unlock(io);

        const encoded = try encodeEvent(self.allocator, io, event);
        defer self.allocator.free(encoded);
        try self.file.writeStreamingAll(io, encoded);
        try self.file.writeStreamingAll(io, "\n");
    }

    fn beginWrite(self: *FileLogger, io: Io) bool {
        self.lifecycle_mutex.lockUncancelable(io);
        defer self.lifecycle_mutex.unlock(io);
        if (self.closing) return false;
        self.active_writes += 1;
        return true;
    }

    fn finishWrite(self: *FileLogger, io: Io) void {
        self.lifecycle_mutex.lockUncancelable(io);
        defer self.lifecycle_mutex.unlock(io);
        std.debug.assert(self.active_writes > 0);
        self.active_writes -= 1;
        if (self.closing and self.active_writes == 0) self.lifecycle_condition.signal(io);
    }

    const vtable: Logger.VTable = .{ .write = write };
};

pub fn stderrLogger(allocator: Allocator) Logger {
    return .{
        .allocator = allocator,
        .context = &stderr_context,
        .vtable = &stderr_vtable,
    };
}

pub fn encodeEvent(allocator: Allocator, io: Io, event: Event) ![]u8 {
    return std.json.Stringify.valueAlloc(allocator, EncodedEvent{
        .timestamp = Io.Timestamp.now(io, .real).toMilliseconds(),
        .level = event.level,
        .source = event.source,
        .message = event.message,
        .context = event.context,
        .metrics = event.metrics,
    }, .{ .emit_null_optional_fields = true });
}

fn preferredDirectory(allocator: Allocator, environment: Environment) !?[]u8 {
    return switch (@import("builtin").os.tag) {
        .macos => if (environment.home) |home|
            try std.fs.path.join(allocator, &.{ home, "Library", "Logs", "rvw" })
        else
            null,
        .linux => if (environment.xdg_state_home) |state_home|
            try std.fs.path.join(allocator, &.{ state_home, "rvw" })
        else if (environment.home) |home|
            try std.fs.path.join(allocator, &.{ home, ".local", "state", "rvw" })
        else
            null,
        else => null,
    };
}

fn defaultTemporaryDirectory() []const u8 {
    return switch (@import("builtin").os.tag) {
        .windows => ".",
        else => "/tmp",
    };
}

fn writeStderr(_: *anyopaque, io: Io, event: Event) !void {
    const encoded = try encodeEvent(std.heap.page_allocator, io, event);
    defer std.heap.page_allocator.free(encoded);
    try Io.File.stderr().writeStreamingAll(io, encoded);
    try Io.File.stderr().writeStreamingAll(io, "\n");
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

var stderr_context: u8 = 0;
const stderr_vtable: Logger.VTable = .{ .write = writeStderr };

test "event encoding produces a structured wide event" {
    var context = std.json.ObjectMap.init(std.testing.allocator);
    defer context.deinit();
    try context.put("path", .{ .string = "src/main.zig" });
    var metrics = std.json.ObjectMap.init(std.testing.allocator);
    defer metrics.deinit();
    try metrics.put("durationMs", .{ .integer = 12 });

    const encoded = try encodeEvent(std.testing.allocator, std.testing.io, .{
        .level = .warning,
        .source = "backend",
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

test "file logger serializes concurrent writes as complete JSON lines" {
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    const directory = try tmp.dir.realPathFileAlloc(std.testing.io, ".", std.testing.allocator);
    defer std.testing.allocator.free(directory);
    var logger = try FileLogger.initInDirectory(std.testing.allocator, std.testing.io, directory);
    const path = try std.testing.allocator.dupe(u8, logger.path);
    defer std.testing.allocator.free(path);
    const interface = logger.interface();

    const Worker = struct {
        fn run(log: Logger, io: Io, index: usize) Io.Cancelable!void {
            var message_buffer: [32]u8 = undefined;
            const message = std.fmt.bufPrint(&message_buffer, "event-{d}", .{index}) catch unreachable;
            log.log(io, .{ .level = .info, .source = "test", .message = message });
        }
    };
    var group: Io.Group = .init;
    defer group.cancel(std.testing.io);
    for (0..32) |index| try group.concurrent(std.testing.io, Worker.run, .{ interface, std.testing.io, index });
    try group.await(std.testing.io);
    logger.deinit();

    const contents = try Io.Dir.cwd().readFileAlloc(std.testing.io, path, std.testing.allocator, .limited(256 * 1024));
    defer std.testing.allocator.free(contents);
    var line_count: usize = 0;
    var lines = std.mem.splitScalar(u8, contents, '\n');
    while (lines.next()) |line| {
        if (line.len == 0) continue;
        var parsed = try std.json.parseFromSlice(std.json.Value, std.testing.allocator, line, .{});
        parsed.deinit();
        line_count += 1;
    }
    try std.testing.expectEqual(@as(usize, 32), line_count);
}

test "file logger prefers the platform log directory" {
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    const root = try tmp.dir.realPathFileAlloc(std.testing.io, ".", std.testing.allocator);
    defer std.testing.allocator.free(root);
    const state = try std.fs.path.join(std.testing.allocator, &.{ root, "state" });
    defer std.testing.allocator.free(state);
    const temporary = try std.fs.path.join(std.testing.allocator, &.{ root, "temporary" });
    defer std.testing.allocator.free(temporary);

    var logger = try FileLogger.init(std.testing.allocator, std.testing.io, .{
        .home = root,
        .xdg_state_home = state,
        .temporary_directory = temporary,
    });
    defer logger.deinit();
    const expected_directory = switch (@import("builtin").os.tag) {
        .macos => try std.fs.path.join(std.testing.allocator, &.{ root, "Library", "Logs", "rvw" }),
        .linux => try std.fs.path.join(std.testing.allocator, &.{ state, "rvw" }),
        else => try std.testing.allocator.dupe(u8, temporary),
    };
    defer std.testing.allocator.free(expected_directory);
    try std.testing.expect(std.mem.startsWith(u8, logger.path, expected_directory));
}

test "file logger falls back to the temporary directory" {
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    const root = try tmp.dir.realPathFileAlloc(std.testing.io, ".", std.testing.allocator);
    defer std.testing.allocator.free(root);
    const blocked = try std.fs.path.join(std.testing.allocator, &.{ root, "blocked" });
    defer std.testing.allocator.free(blocked);
    try Io.Dir.cwd().writeFile(std.testing.io, .{ .sub_path = blocked, .data = "not a directory" });
    const temporary = try std.fs.path.join(std.testing.allocator, &.{ root, "temporary" });
    defer std.testing.allocator.free(temporary);

    var logger = try FileLogger.init(std.testing.allocator, std.testing.io, .{
        .home = blocked,
        .xdg_state_home = blocked,
        .temporary_directory = temporary,
    });
    defer logger.deinit();
    try std.testing.expect(std.mem.startsWith(u8, logger.path, temporary));
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
    logger.log(std.testing.io, .{ .level = .err, .source = "test", .message = "still running" });
}
