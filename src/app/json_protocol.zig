const std = @import("std");
const dispatcher_module = @import("dispatcher.zig");
const model = @import("model.zig");

const Allocator = std.mem.Allocator;

pub fn encodeResponse(allocator: Allocator, response: model.Response) ![]u8 {
    return switch (response) {
        .review_overview => |value| std.json.Stringify.valueAlloc(allocator, value, .{}),
        .file_review => |value| std.json.Stringify.valueAlloc(allocator, value, .{}),
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

    const object = switch (parsed.value) {
        .object => |object| object,
        else => return encodeEnvelopeError(allocator, .malformed_request),
    };
    const operation_value = object.get("type") orelse return encodeEnvelopeError(allocator, .malformed_request);
    const operation = switch (operation_value) {
        .string => |value| value,
        else => return encodeEnvelopeError(allocator, .malformed_request),
    };

    const request: model.Request = if (std.mem.eql(u8, operation, "get_review_overview"))
        .get_review_overview
    else if (std.mem.eql(u8, operation, "get_file_review")) blk: {
        const review_id = jsonString(object.get("reviewId")) orelse
            return encodeEnvelopeError(allocator, .malformed_request);
        const path = jsonString(object.get("path")) orelse
            return encodeEnvelopeError(allocator, .malformed_request);
        break :blk .{ .get_file_review = .{ .review_id = review_id, .path = path } };
    } else return encodeEnvelopeError(allocator, .unknown_operation);

    const response = dispatcher.dispatch(request) catch |err| {
        return encodeEnvelopeError(allocator, model.errorCode(err));
    };
    return switch (response) {
        .review_overview => |data| std.json.Stringify.valueAlloc(allocator, .{ .ok = true, .data = data }, .{}),
        .file_review => |data| std.json.Stringify.valueAlloc(allocator, .{ .ok = true, .data = data }, .{}),
    };
}

fn jsonString(value: ?std.json.Value) ?[]const u8 {
    return switch (value orelse return null) {
        .string => |string| string,
        else => null,
    };
}

fn encodeEnvelopeError(allocator: Allocator, code: model.ErrorCode) ![]u8 {
    return std.json.Stringify.valueAlloc(allocator, .{
        .ok = false,
        .@"error" = .{ .code = code, .message = model.errorMessage(code) },
    }, .{});
}
