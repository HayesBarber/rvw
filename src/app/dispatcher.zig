const std = @import("std");
const log = @import("../log/interface.zig");
const model = @import("model.zig");

pub const Dispatcher = struct {
    context: *anyopaque,
    io: ?std.Io = null,
    logger: ?log.Logger = null,
    dispatchFn: *const fn (*anyopaque, model.Request) anyerror!model.Response,

    pub fn dispatch(self: Dispatcher, request: model.Request) !model.Response {
        const start = self.startTiming(request);
        defer self.finishTiming(request, if (request == .get_file) "filesystem_read" else "diff_snapshot_lookup", start);
        return self.dispatchFn(self.context, request);
    }
    pub fn startTiming(self: Dispatcher, request: model.Request) ?log.Timing {
        const logger = self.logger orelse return null;
        if (logger.minimum_level != .debug or traceId(request) == null) return null;
        return log.Timing.begin(logger, self.io orelse return null);
    }

    pub fn finishTiming(_: Dispatcher, request: model.Request, stage: []const u8, start: ?log.Timing) void {
        const timing = start orelse return;
        timing.finish(stage, traceId(request));
    }
};

fn traceId(request: model.Request) ?[]const u8 {
    return switch (request) {
        .get_file => |details| details.trace_id,
        .get_file_diff => |details| details.trace_id,
        else => null,
    };
}

test "timings correlate successful and failed file operations and stay opt in" {
    const Harness = struct {
        count: usize = 0,
        fn dispatch(_: *anyopaque, _: model.Request) !model.Response {
            return error.UnknownFile;
        }
        fn write(ptr: *anyopaque, _: std.Io, event: log.Event) !void {
            const self: *@This() = @ptrCast(@alignCast(ptr));
            self.count += 1;
            try std.testing.expectEqualStrings("load-1", event.traceId.?);
            try std.testing.expectEqualStrings("filesystem_read", event.context.?.object.get("stage").?.string);
            try std.testing.expect(event.context.?.object.get("path") == null);
            try std.testing.expect(event.context.?.object.get("durationMs").?.float >= 0);
        }
    };
    var harness: Harness = .{};
    var dispatcher: Dispatcher = .{ .context = &harness, .dispatchFn = Harness.dispatch, .io = std.testing.io, .logger = .{ .allocator = std.testing.allocator, .context = &harness, .vtable = &.{ .write = Harness.write } } };
    const request: model.Request = .{ .get_file = .{ .path = "secret", .trace_id = "load-1" } };
    try std.testing.expectError(error.UnknownFile, dispatcher.dispatch(request));
    try std.testing.expectEqual(@as(usize, 0), harness.count);
    dispatcher.logger.?.minimum_level = .debug;
    try std.testing.expectError(error.UnknownFile, dispatcher.dispatch(request));
    try std.testing.expectEqual(@as(usize, 1), harness.count);
}
