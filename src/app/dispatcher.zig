const std = @import("std");
const logging = @import("../log/interface.zig");
const model = @import("model.zig");

pub const Dispatcher = struct {
    io: ?std.Io = null,
    logger: ?logging.Logger = null,
    context: *anyopaque,
    dispatchFn: *const fn (*anyopaque, model.Request) anyerror!model.Response,

    pub fn startTiming(self: Dispatcher, request: model.Request) Timing {
        const id = switch (request) {
            .get_file => |r| r.trace_id,
            .get_file_diff => |r| r.trace_id,
            else => null,
        };
        const logger = self.logger orelse return .{};
        const io = self.io orelse return .{};
        if (id == null or logger.minimum_level != .debug) return .{};
        return .{ .io = io, .logger = logger, .id = id, .start = std.Io.Timestamp.now(io, .awake).toNanoseconds() };
    }

    pub fn dispatch(self: Dispatcher, request: model.Request) !model.Response {
        return self.dispatchFn(self.context, request);
    }
};

pub const Timing = struct {
    io: ?std.Io = null,
    logger: ?logging.Logger = null,
    id: ?[]const u8 = null,
    start: i96 = 0,

    pub fn finish(self: Timing, stage: []const u8, bytes: usize) void {
        const logger = self.logger orelse return;
        const io = self.io.?;
        const elapsed = std.Io.Timestamp.now(io, .awake).toNanoseconds() - self.start;
        var context: std.json.ObjectMap = .{};
        defer context.deinit(logger.allocator);
        context.put(logger.allocator, "stage", .{ .string = stage }) catch return;
        context.put(logger.allocator, "durationMs", .{ .float = @as(f64, @floatFromInt(elapsed)) / 1_000_000 }) catch return;
        context.put(logger.allocator, "bytes", .{ .integer = @intCast(bytes) }) catch return;
        logger.log(io, .{ .level = .debug, .source = .backend, .message = "file load timing", .traceId = self.id, .context = .{ .object = context } });
    }
};

test "file timing is correlated numeric content-free and disabled by default" {
    const Sink = struct {
        count: usize = 0,
        fn write(ptr: *anyopaque, _: std.Io, event: logging.Event) !void {
            const self: *@This() = @ptrCast(@alignCast(ptr));
            self.count += 1;
            try std.testing.expectEqualStrings("trace-188", event.traceId.?);
            try std.testing.expectEqual(logging.Level.debug, event.level);
            const context = event.context.?.object;
            try std.testing.expectEqual(@as(usize, 3), context.count());
            try std.testing.expect(context.get("durationMs").?.float >= 0);
            try std.testing.expectEqualStrings("backend_file", context.get("stage").?.string);
        }
        fn dispatch(_: *anyopaque, _: model.Request) !model.Response {
            return error.Unused;
        }
    };
    var sink: Sink = .{};
    var dispatcher: Dispatcher = .{ .context = &sink, .dispatchFn = Sink.dispatch, .io = std.testing.io, .logger = .{ .context = &sink, .allocator = std.testing.allocator, .vtable = &.{ .write = Sink.write } } };
    const request: model.Request = .{ .get_file = .{ .path = "PRIVATE", .trace_id = "trace-188" } };
    dispatcher.startTiming(request).finish("backend_file", 0);
    try std.testing.expectEqual(@as(usize, 0), sink.count);
    dispatcher.logger.?.minimum_level = .debug;
    dispatcher.startTiming(request).finish("backend_file", 0);
    dispatcher.startTiming(.{ .get_file = .{ .path = "PRIVATE" } }).finish("backend_file", 0);
    try std.testing.expectEqual(@as(usize, 1), sink.count);
}
