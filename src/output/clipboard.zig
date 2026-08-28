const builtin = @import("builtin");
const std = @import("std");

const Io = std.Io;

/// Copies arbitrary text to the current system clipboard.
pub fn copy(io: Io, text: []const u8) !void {
    var system: SystemClipboard = .{};
    return system.copy(io, text);
}

/// Text output destination backed by a clipboard implementation.
///
/// Application code depends on this interface instead of platform-specific
/// clipboard commands. Implementations must consume `text` before returning.
pub const Clipboard = struct {
    context: *anyopaque,
    vtable: *const VTable,

    pub const VTable = struct {
        copy: *const fn (*anyopaque, Io, []const u8) anyerror!void,
    };

    pub fn copy(self: Clipboard, io: Io, text: []const u8) !void {
        return self.vtable.copy(self.context, io, text);
    }
};

/// Clipboard implementation for macOS and Linux.
pub const SystemClipboard = struct {
    runner: Runner = .system,

    pub fn interface(self: *SystemClipboard) Clipboard {
        return .{ .context = self, .vtable = &vtable };
    }

    pub fn copy(self: *SystemClipboard, io: Io, text: []const u8) !void {
        return copyForOs(self.runner, builtin.os.tag, io, text);
    }

    fn copyInterface(context: *anyopaque, io: Io, text: []const u8) !void {
        const self: *SystemClipboard = @ptrCast(@alignCast(context));
        return self.copy(io, text);
    }

    const vtable: Clipboard.VTable = .{ .copy = copyInterface };
};

pub const Error = error{
    ClipboardCommandFailed,
    ClipboardToolNotFound,
    ClipboardWriteFailed,
    UnsupportedPlatform,
};

const Runner = struct {
    context: *anyopaque,
    runFn: *const fn (*anyopaque, Io, []const []const u8, []const u8) anyerror!void,

    const system: Runner = .{
        .context = &system_runner_context,
        .runFn = runSystemCommand,
    };

    fn run(self: Runner, io: Io, argv: []const []const u8, text: []const u8) !void {
        return self.runFn(self.context, io, argv, text);
    }
};

var system_runner_context: u8 = 0;

fn copyForOs(runner: Runner, os: std.Target.Os.Tag, io: Io, text: []const u8) !void {
    switch (os) {
        .macos => try runner.run(io, &.{"/usr/bin/pbcopy"}, text),
        .linux => runner.run(io, &.{"wl-copy"}, text) catch |err| switch (err) {
            error.ClipboardToolNotFound => try runner.run(io, &.{ "xclip", "-selection", "clipboard" }, text),
            else => return err,
        },
        else => return error.UnsupportedPlatform,
    }
}

fn runSystemCommand(_: *anyopaque, io: Io, argv: []const []const u8, text: []const u8) !void {
    var child = std.process.spawn(io, .{
        .argv = argv,
        .stdin = .pipe,
        .stdout = .ignore,
        .stderr = .ignore,
        .create_no_window = true,
    }) catch |err| switch (err) {
        error.FileNotFound => return error.ClipboardToolNotFound,
        else => return err,
    };
    defer child.kill(io);

    child.stdin.?.writeStreamingAll(io, text) catch return error.ClipboardWriteFailed;
    child.stdin.?.close(io);
    child.stdin = null;

    const result = try child.wait(io);
    switch (result) {
        .exited => |status| if (status != 0) return error.ClipboardCommandFailed,
        else => return error.ClipboardCommandFailed,
    }
}

test "clipboard forwards arbitrary text" {
    const Fake = struct {
        expected: []const u8,
        calls: usize = 0,

        fn run(context: *anyopaque, _: Io, _: []const []const u8, text: []const u8) !void {
            const self: *@This() = @ptrCast(@alignCast(context));
            try std.testing.expectEqualStrings(self.expected, text);
            self.calls += 1;
        }
    };

    const expected = "# Review\n\n- arbitrary **Markdown** text\n";
    var fake: Fake = .{ .expected = expected };
    var system: SystemClipboard = .{ .runner = .{ .context = &fake, .runFn = Fake.run } };
    var threaded: Io.Threaded = .init(std.testing.allocator, .{ .environ = .empty });
    defer threaded.deinit();

    try system.interface().copy(threaded.io(), expected);
    try std.testing.expectEqual(@as(usize, 1), fake.calls);
}

test "clipboard failures propagate to caller" {
    const Fake = struct {
        fn run(_: *anyopaque, _: Io, _: []const []const u8, _: []const u8) !void {
            return error.ClipboardCommandFailed;
        }
    };

    var context: u8 = 0;
    var system: SystemClipboard = .{ .runner = .{ .context = &context, .runFn = Fake.run } };
    var threaded: Io.Threaded = .init(std.testing.allocator, .{ .environ = .empty });
    defer threaded.deinit();

    try std.testing.expectError(
        error.ClipboardCommandFailed,
        system.interface().copy(threaded.io(), "review"),
    );
}

test "Linux falls back to xclip when wl-copy is unavailable" {
    const Fake = struct {
        calls: usize = 0,

        fn run(context: *anyopaque, _: Io, argv: []const []const u8, _: []const u8) !void {
            const self: *@This() = @ptrCast(@alignCast(context));
            self.calls += 1;
            if (self.calls == 1) {
                try std.testing.expectEqualStrings("wl-copy", argv[0]);
                return error.ClipboardToolNotFound;
            }
            try std.testing.expectEqualSlices(
                []const u8,
                &.{ "xclip", "-selection", "clipboard" },
                argv,
            );
        }
    };

    var fake: Fake = .{};
    const runner: Runner = .{ .context = &fake, .runFn = Fake.run };
    var threaded: Io.Threaded = .init(std.testing.allocator, .{ .environ = .empty });
    defer threaded.deinit();

    try copyForOs(runner, .linux, threaded.io(), "review");
    try std.testing.expectEqual(@as(usize, 2), fake.calls);
}

test "unsupported desktop platform returns a useful error" {
    var context: u8 = 0;
    const runner: Runner = .{
        .context = &context,
        .runFn = struct {
            fn run(_: *anyopaque, _: Io, _: []const []const u8, _: []const u8) !void {}
        }.run,
    };
    var threaded: Io.Threaded = .init(std.testing.allocator, .{ .environ = .empty });
    defer threaded.deinit();

    try std.testing.expectError(
        error.UnsupportedPlatform,
        copyForOs(runner, .wasi, threaded.io(), "review"),
    );
}
