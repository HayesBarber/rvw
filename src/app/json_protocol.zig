const std = @import("std");
const dispatcher_module = @import("dispatcher.zig");
const log = @import("../log.zig");
const model = @import("model.zig");

const Allocator = std.mem.Allocator;

pub fn encodeResponse(allocator: Allocator, response: model.Response) ![]u8 {
    return switch (response) {
        inline else => |value| std.json.Stringify.valueAlloc(allocator, value, .{}),
    };
}

pub fn encodeError(allocator: Allocator, code: model.ErrorCode) ![]u8 {
    return std.json.Stringify.valueAlloc(allocator, .{
        .@"error" = .{ .code = code, .message = model.errorMessage(code) },
    }, .{});
}

pub fn dispatchJson(allocator: Allocator, dispatcher: dispatcher_module.Dispatcher, input: []const u8) ![]u8 {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, input, .{}) catch {
        return encodeEnvelopeError(allocator, .malformed_request);
    };
    defer parsed.deinit();

    const request = decodeRequestValue(parsed.value) catch |err| return encodeEnvelopeError(
        allocator,
        if (err == error.UnknownOperation) .unknown_operation else .malformed_request,
    );

    const response = dispatcher.dispatch(request) catch |err| {
        return encodeEnvelopeError(allocator, model.errorCode(err));
    };
    return switch (response) {
        inline else => |data| std.json.Stringify.valueAlloc(allocator, .{ .ok = true, .data = data }, .{}),
    };
}

pub const DecodeError = error{ MalformedRequest, UnknownOperation };

pub fn decodeRequestValue(value: std.json.Value) DecodeError!model.Request {
    const object = switch (value) {
        .object => |object| object,
        else => return error.MalformedRequest,
    };
    const operation = jsonString(object.get("type")) orelse return error.MalformedRequest;

    if (std.mem.eql(u8, operation, "get_diff_overview")) return .get_diff_overview;
    if (std.mem.eql(u8, operation, "get_file_diff")) {
        const diff_id = jsonString(object.get("diffId")) orelse return error.MalformedRequest;
        const path = jsonString(object.get("path")) orelse return error.MalformedRequest;
        return .{ .get_file_diff = .{ .diff_id = diff_id, .path = path } };
    }
    if (std.mem.eql(u8, operation, "get_comments")) return .get_comments;
    if (std.mem.eql(u8, operation, "copy_comments_as_markdown")) return .copy_comments_as_markdown;
    if (std.mem.eql(u8, operation, "create_comment")) {
        const body = jsonString(object.get("body")) orelse return error.MalformedRequest;
        const target = parseCommentTarget(object.get("target")) orelse return error.MalformedRequest;
        return .{ .create_comment = .{ .body = body, .target = target } };
    }
    if (std.mem.eql(u8, operation, "log")) {
        const level = parseLogLevel(jsonString(object.get("level")) orelse return error.MalformedRequest) orelse
            return error.MalformedRequest;
        const message = jsonString(object.get("message")) orelse return error.MalformedRequest;
        const context = parseOptionalObject(object.get("context")) orelse return error.MalformedRequest;
        const metrics = parseOptionalObject(object.get("metrics")) orelse return error.MalformedRequest;
        return .{ .log = .{
            .level = level,
            .message = message,
            .context = context,
            .metrics = metrics,
        } };
    }
    return error.UnknownOperation;
}

fn parseLogLevel(value: []const u8) ?log.Level {
    if (std.mem.eql(u8, value, "debug")) return .debug;
    if (std.mem.eql(u8, value, "info")) return .info;
    if (std.mem.eql(u8, value, "warning")) return .warning;
    if (std.mem.eql(u8, value, "error")) return .err;
    return null;
}

/// The outer optional distinguishes malformed values from a valid absent/null
/// value; structured context and metrics must be JSON objects when supplied.
fn parseOptionalObject(value: ?std.json.Value) ??std.json.Value {
    const actual = value orelse return @as(?std.json.Value, null);
    return switch (actual) {
        .null => @as(?std.json.Value, null),
        .object => @as(?std.json.Value, actual),
        else => null,
    };
}

fn jsonString(value: ?std.json.Value) ?[]const u8 {
    return switch (value orelse return null) {
        .string => |string| string,
        else => null,
    };
}

fn jsonUnsigned(value: ?std.json.Value) ?usize {
    return switch (value orelse return null) {
        .integer => |integer| if (integer >= 0) @intCast(integer) else null,
        else => null,
    };
}

fn parseCommentTarget(value: ?std.json.Value) ?model.CommentTarget {
    const object = switch (value orelse return null) {
        .object => |object| object,
        else => return null,
    };
    const kind = jsonString(object.get("kind")) orelse return null;
    const path = jsonString(object.get("path")) orelse return null;
    if (std.mem.eql(u8, kind, "file")) return .{ .file = .{ .path = path } };
    if (!std.mem.eql(u8, kind, "line")) return null;

    const side_value = jsonString(object.get("side")) orelse return null;
    const start_line = jsonUnsigned(object.get("startLine")) orelse return null;
    const end_line = jsonUnsigned(object.get("endLine")) orelse return null;
    if (std.mem.eql(u8, side_value, "old")) return .{ .line = .{
        .path = path,
        .side = .old,
        .startLine = start_line,
        .endLine = end_line,
    } };
    if (std.mem.eql(u8, side_value, "new")) return .{ .line = .{
        .path = path,
        .side = .new,
        .startLine = start_line,
        .endLine = end_line,
    } };
    return null;
}

fn encodeEnvelopeError(allocator: Allocator, code: model.ErrorCode) ![]u8 {
    return std.json.Stringify.valueAlloc(allocator, .{
        .ok = false,
        .@"error" = .{ .code = code, .message = model.errorMessage(code) },
    }, .{});
}

test "copy comments as Markdown request decodes through the JSON protocol" {
    var parsed = try std.json.parseFromSlice(
        std.json.Value,
        std.testing.allocator,
        "{\"type\":\"copy_comments_as_markdown\"}",
        .{},
    );
    defer parsed.deinit();

    const request = try decodeRequestValue(parsed.value);
    switch (request) {
        .copy_comments_as_markdown => {},
        else => return error.UnexpectedRequest,
    }
}

test "copy comments result encodes the copied comment count" {
    const encoded = try encodeResponse(std.testing.allocator, .{
        .copy_comments_result = .{ .commentCount = 2 },
    });
    defer std.testing.allocator.free(encoded);

    try std.testing.expectEqualStrings("{\"commentCount\":2}", encoded);
}

test "log response has no return value" {
    const encoded = try encodeResponse(std.testing.allocator, .log);
    defer std.testing.allocator.free(encoded);

    try std.testing.expectEqualStrings("{}", encoded);
}

test "frontend log requests validate levels and structured fields" {
    var parsed = try std.json.parseFromSlice(
        std.json.Value,
        std.testing.allocator,
        "{\"type\":\"log\",\"level\":\"warning\",\"message\":\"slow\",\"context\":{\"view\":\"diff\"},\"metrics\":{\"durationMs\":12}}",
        .{},
    );
    defer parsed.deinit();
    const request = try decodeRequestValue(parsed.value);
    switch (request) {
        .log => |details| {
            try std.testing.expectEqual(log.Level.warning, details.level);
            try std.testing.expectEqualStrings("slow", details.message);
            try std.testing.expectEqualStrings("diff", details.context.?.object.get("view").?.string);
            try std.testing.expectEqual(@as(i64, 12), details.metrics.?.object.get("durationMs").?.integer);
        },
        else => return error.UnexpectedRequest,
    }

    var minimal = try std.json.parseFromSlice(
        std.json.Value,
        std.testing.allocator,
        "{\"type\":\"log\",\"level\":\"debug\",\"message\":\"ready\"}",
        .{},
    );
    defer minimal.deinit();
    switch (try decodeRequestValue(minimal.value)) {
        .log => |details| {
            try std.testing.expect(details.context == null);
            try std.testing.expect(details.metrics == null);
        },
        else => return error.UnexpectedRequest,
    }

    var invalid = try std.json.parseFromSlice(
        std.json.Value,
        std.testing.allocator,
        "{\"type\":\"log\",\"level\":\"fatal\",\"message\":\"boom\"}",
        .{},
    );
    defer invalid.deinit();
    try std.testing.expectError(error.MalformedRequest, decodeRequestValue(invalid.value));
}
