const std = @import("std");
const log = @import("../log/log.zig");

/// Records a production initialization failure without including repository
/// paths or other user-controlled input.
pub fn logApplicationStartFailed(
    logger: log.Logger,
    io: std.Io,
    stage: []const u8,
    err: anyerror,
) void {
    var context: std.json.ObjectMap = .empty;
    defer context.deinit(logger.allocator);

    context.put(logger.allocator, "stage", .{ .string = stage }) catch
        return logStartFailureWithoutContext(logger, io);
    context.put(logger.allocator, "errorCode", .{ .string = @errorName(err) }) catch
        return logStartFailureWithoutContext(logger, io);

    logger.log(io, .{
        .level = .err,
        .source = .backend,
        .message = "application start failed",
        .context = .{ .object = context },
    });
}

fn logStartFailureWithoutContext(logger: log.Logger, io: std.Io) void {
    logger.log(io, .{
        .level = .err,
        .source = .backend,
        .message = "application start failed",
    });
}

test "startup failure records only the stage and stable error code" {
    var recorder: RecordingLogger = .{};
    logApplicationStartFailed(
        recorder.interface(),
        std.testing.io,
        "diff_provider",
        error.InvalidRevision,
    );

    try std.testing.expectEqual(@as(usize, 1), recorder.count);
    try std.testing.expectEqual(log.Level.err, recorder.level.?);
    try std.testing.expectEqualStrings("application start failed", recorder.message.?);
    try std.testing.expectEqualStrings("diff_provider", recorder.stage.?);
    try std.testing.expectEqualStrings("InvalidRevision", recorder.error_code.?);
}

const RecordingLogger = struct {
    count: usize = 0,
    level: ?log.Level = null,
    message: ?[]const u8 = null,
    stage: ?[]const u8 = null,
    error_code: ?[]const u8 = null,

    fn interface(self: *RecordingLogger) log.Logger {
        return .{
            .allocator = std.testing.allocator,
            .context = self,
            .vtable = &.{ .write = write },
        };
    }

    fn write(context: *anyopaque, _: std.Io, event: log.Event) !void {
        const self: *RecordingLogger = @ptrCast(@alignCast(context));
        self.count += 1;
        self.level = event.level;
        self.message = event.message;
        const fields = switch (event.context orelse return) {
            .object => |object| object,
            else => return,
        };
        self.stage = jsonString(fields.get("stage"));
        self.error_code = jsonString(fields.get("errorCode"));
    }
};

fn jsonString(value: ?std.json.Value) ?[]const u8 {
    return switch (value orelse return null) {
        .string => |string| string,
        else => null,
    };
}
