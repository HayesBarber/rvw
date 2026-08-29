const std = @import("std");
const log_interface = @import("interface.zig");

const Allocator = std.mem.Allocator;
const Io = std.Io;

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

        const fallback = environment.temporary_directory orelse "/tmp";
        return initInDirectory(allocator, io, fallback);
    }

    pub fn initInDirectory(allocator: Allocator, io: Io, directory: []const u8) !FileLogger {
        try Io.Dir.cwd().createDirPath(io, directory);
        const timestamp = Io.Timestamp.now(io, .real).toNanoseconds();
        const filename = try std.fmt.allocPrint(allocator, "rvw-{d}.jsonl", .{timestamp});
        defer allocator.free(filename);
        const path = try std.fs.path.join(allocator, &.{ directory, filename });
        errdefer allocator.free(path);
        const file_handle = try Io.Dir.createFileAbsolute(io, path, .{
            .truncate = false,
            .exclusive = true,
        });
        return .{
            .allocator = allocator,
            .io = io,
            .file = file_handle,
            .path = path,
        };
    }

    pub fn interface(self: *FileLogger) log_interface.Logger {
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

    fn write(context: *anyopaque, io: Io, event: log_interface.Event) !void {
        const self: *FileLogger = @ptrCast(@alignCast(context));
        if (!self.beginWrite(io)) return error.LoggerClosed;
        defer self.finishWrite(io);

        self.mutex.lockUncancelable(io);
        defer self.mutex.unlock(io);

        const encoded = try log_interface.encodeEvent(self.allocator, io, event);
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

    const vtable: log_interface.Logger.VTable = .{ .write = write };
};

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

test "file logger serializes concurrent writes as complete JSON lines" {
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    const directory = try tmp.dir.realPathFileAlloc(std.testing.io, ".", std.testing.allocator);
    defer std.testing.allocator.free(directory);
    var logger = try FileLogger.initInDirectory(std.testing.allocator, std.testing.io, directory);
    const path = try std.testing.allocator.dupe(u8, logger.path);
    defer std.testing.allocator.free(path);
    const logger_interface = logger.interface();

    const Worker = struct {
        fn run(log: log_interface.Logger, io: Io, index: usize) Io.Cancelable!void {
            var message_buffer: [32]u8 = undefined;
            const message = std.fmt.bufPrint(&message_buffer, "event-{d}", .{index}) catch unreachable;
            log.log(io, .{ .level = .info, .source = .backend, .message = message });
        }
    };
    var group: Io.Group = .init;
    defer group.cancel(std.testing.io);
    for (0..32) |index| try group.concurrent(std.testing.io, Worker.run, .{ logger_interface, std.testing.io, index });
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
