const std = @import("std");
const dispatcher_module = @import("dispatcher.zig");
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

    if (std.mem.eql(u8, operation, "get_configuration")) return .get_configuration;
    if (std.mem.eql(u8, operation, "get_diff_overview")) return .get_diff_overview;
    if (std.mem.eql(u8, operation, "get_files")) return .get_files;
    if (std.mem.eql(u8, operation, "get_file")) {
        const path = jsonString(object.get("path")) orelse return error.MalformedRequest;
        if (path.len == 0) return error.MalformedRequest;
        return .{ .get_file = .{ .path = path } };
    }
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
    if (std.mem.eql(u8, operation, "edit_comment")) {
        const comment_id = jsonString(object.get("commentId")) orelse return error.MalformedRequest;
        const body = jsonString(object.get("body")) orelse return error.MalformedRequest;
        return .{ .edit_comment = .{ .comment_id = comment_id, .body = body } };
    }
    if (std.mem.eql(u8, operation, "delete_comment")) {
        const comment_id = jsonString(object.get("commentId")) orelse return error.MalformedRequest;
        return .{ .delete_comment = .{ .comment_id = comment_id } };
    }
    return error.UnknownOperation;
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

test "comment mutation requests decode IDs and edited bodies" {
    var parsed_edit = try std.json.parseFromSlice(
        std.json.Value,
        std.testing.allocator,
        "{\"type\":\"edit_comment\",\"commentId\":\"comment-7\",\"body\":\"revised\"}",
        .{},
    );
    defer parsed_edit.deinit();
    const edit = try decodeRequestValue(parsed_edit.value);
    try std.testing.expectEqualStrings("comment-7", edit.edit_comment.comment_id);
    try std.testing.expectEqualStrings("revised", edit.edit_comment.body);

    var parsed_delete = try std.json.parseFromSlice(
        std.json.Value,
        std.testing.allocator,
        "{\"type\":\"delete_comment\",\"commentId\":\"comment-7\"}",
        .{},
    );
    defer parsed_delete.deinit();
    const delete = try decodeRequestValue(parsed_delete.value);
    try std.testing.expectEqualStrings("comment-7", delete.delete_comment.comment_id);
}
