const std = @import("std");
const dispatcher_module = @import("dispatcher.zig");
const model = @import("model.zig");
const log = @import("../log/interface.zig");

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
    defer if (response == .text_search) response.text_search.deinit();
    const timing = dispatcher.startTiming(request);
    const encoded = try switch (response) {
        inline else => |data| std.json.Stringify.valueAlloc(allocator, .{ .ok = true, .data = data }, .{}),
    };
    timing.finish("response_serialize", encoded.len);
    return encoded;
}

pub const DecodeError = error{ MalformedRequest, UnknownOperation };

pub fn decodeRequestValue(value: std.json.Value) DecodeError!model.Request {
    const object = switch (value) {
        .object => |object| object,
        else => return error.MalformedRequest,
    };
    const operation = jsonString(object.get("type")) orelse return error.MalformedRequest;

    if (std.mem.eql(u8, operation, "log")) return decodeLog(value);
    if (std.mem.eql(u8, operation, "get_configuration")) return .get_configuration;
    if (std.mem.eql(u8, operation, "reload_review")) return .reload_review;
    if (std.mem.eql(u8, operation, "get_diff_overview")) return .get_diff_overview;
    if (std.mem.eql(u8, operation, "get_files")) return .get_files;
    if (std.mem.eql(u8, operation, "get_files_not_ignored")) return .get_files_not_ignored;
    if (std.mem.eql(u8, operation, "search_text")) {
        const query = jsonString(object.get("query")) orelse return error.MalformedRequest;
        const mode_value = jsonString(object.get("mode")) orelse return error.MalformedRequest;
        const mode = std.meta.stringToEnum(model.TextSearchMode, mode_value) orelse return error.MalformedRequest;
        return .{ .search_text = .{ .query = query, .mode = mode } };
    }
    if (std.mem.eql(u8, operation, "get_file")) {
        const path = jsonString(object.get("path")) orelse return error.MalformedRequest;
        if (path.len == 0) return error.MalformedRequest;
        return .{ .get_file = .{ .path = path, .trace_id = try optionalTraceId(object.get("traceId")) } };
    }
    if (std.mem.eql(u8, operation, "get_file_diff")) {
        const diff_id = jsonString(object.get("diffId")) orelse return error.MalformedRequest;
        const path = jsonString(object.get("path")) orelse return error.MalformedRequest;
        return .{ .get_file_diff = .{ .diff_id = diff_id, .path = path, .trace_id = try optionalTraceId(object.get("traceId")) } };
    }
    if (std.mem.eql(u8, operation, "get_comments")) return .get_comments;
    if (std.mem.eql(u8, operation, "copy_comments_as_markdown")) return .copy_comments_as_markdown;
    if (std.mem.eql(u8, operation, "copy_file_path")) {
        const path = jsonString(object.get("path")) orelse return error.MalformedRequest;
        const format_value = jsonString(object.get("format")) orelse return error.MalformedRequest;
        const format: model.FilePathFormat = if (std.mem.eql(u8, format_value, "relative"))
            .relative
        else if (std.mem.eql(u8, format_value, "absolute"))
            .absolute
        else
            return error.MalformedRequest;
        return .{ .copy_file_path = .{ .path = path, .format = format } };
    }
    if (std.mem.eql(u8, operation, "create_comment")) {
        const body = jsonString(object.get("body")) orelse return error.MalformedRequest;
        const comment_type = try optionalJsonString(object.get("commentType"));
        const target = parseCommentTarget(object.get("target")) orelse return error.MalformedRequest;
        return .{ .create_comment = .{ .body = body, .comment_type = comment_type, .target = target } };
    }
    if (std.mem.eql(u8, operation, "edit_comment")) {
        const comment_id = jsonString(object.get("commentId")) orelse return error.MalformedRequest;
        const body = jsonString(object.get("body")) orelse return error.MalformedRequest;
        const comment_type = try optionalJsonString(object.get("commentType"));
        return .{ .edit_comment = .{ .comment_id = comment_id, .body = body, .comment_type = comment_type } };
    }
    if (std.mem.eql(u8, operation, "delete_comment")) {
        const comment_id = jsonString(object.get("commentId")) orelse return error.MalformedRequest;
        return .{ .delete_comment = .{ .comment_id = comment_id } };
    }
    if (std.mem.eql(u8, operation, "clear_comments")) return .clear_comments;
    return error.UnknownOperation;
}

fn jsonString(value: ?std.json.Value) ?[]const u8 {
    return switch (value orelse return null) {
        .string => |string| string,
        else => null,
    };
}

fn optionalJsonString(value: ?std.json.Value) DecodeError!?[]const u8 {
    return switch (value orelse return null) {
        .null => null,
        .string => |string| string,
        else => error.MalformedRequest,
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

test "comment mutation requests decode optional types" {
    var parsed_edit = try std.json.parseFromSlice(
        std.json.Value,
        std.testing.allocator,
        "{\"type\":\"edit_comment\",\"commentId\":\"comment-7\",\"body\":\"revised\",\"commentType\":\"QUESTION\"}",
        .{},
    );
    defer parsed_edit.deinit();
    const edit = try decodeRequestValue(parsed_edit.value);
    try std.testing.expectEqualStrings("comment-7", edit.edit_comment.comment_id);
    try std.testing.expectEqualStrings("revised", edit.edit_comment.body);
    try std.testing.expectEqualStrings("QUESTION", edit.edit_comment.comment_type.?);

    var parsed_delete = try std.json.parseFromSlice(
        std.json.Value,
        std.testing.allocator,
        "{\"type\":\"delete_comment\",\"commentId\":\"comment-7\"}",
        .{},
    );
    defer parsed_delete.deinit();
    const delete = try decodeRequestValue(parsed_delete.value);
    try std.testing.expectEqualStrings("comment-7", delete.delete_comment.comment_id);

    var parsed_clear = try std.json.parseFromSlice(
        std.json.Value,
        std.testing.allocator,
        "{\"type\":\"clear_comments\"}",
        .{},
    );
    defer parsed_clear.deinit();
    const clear = try decodeRequestValue(parsed_clear.value);
    try std.testing.expectEqual(model.Request.clear_comments, clear);
}

test "reload review request decodes" {
    var parsed = try std.json.parseFromSlice(
        std.json.Value,
        std.testing.allocator,
        "{\"type\":\"reload_review\"}",
        .{},
    );
    defer parsed.deinit();
    try std.testing.expectEqual(model.Request.reload_review, try decodeRequestValue(parsed.value));
}

test "file path copy requests require a supported format" {
    var parsed_relative = try std.json.parseFromSlice(
        std.json.Value,
        std.testing.allocator,
        "{\"type\":\"copy_file_path\",\"path\":\"nested/renamed ü.txt\",\"format\":\"relative\"}",
        .{},
    );
    defer parsed_relative.deinit();
    const relative = try decodeRequestValue(parsed_relative.value);
    try std.testing.expectEqualStrings("nested/renamed ü.txt", relative.copy_file_path.path);
    try std.testing.expectEqual(model.FilePathFormat.relative, relative.copy_file_path.format);

    var parsed_invalid = try std.json.parseFromSlice(
        std.json.Value,
        std.testing.allocator,
        "{\"type\":\"copy_file_path\",\"path\":\"README.md\",\"format\":\"markdown\"}",
        .{},
    );
    defer parsed_invalid.deinit();
    try std.testing.expectError(error.MalformedRequest, decodeRequestValue(parsed_invalid.value));
}

fn decodeLog(value: std.json.Value) DecodeError!model.Request {
    const object = value.object;
    const level = log.Level.parse(jsonString(object.get("level")) orelse return error.MalformedRequest) orelse return error.MalformedRequest;
    const message = jsonString(object.get("message")) orelse return error.MalformedRequest;
    if (std.mem.trim(u8, message, &std.ascii.whitespace).len == 0) return error.MalformedRequest;
    var trace: ?[]const u8 = null;
    if (object.get("traceId")) |field| {
        if (field != .null) {
            trace = jsonString(field) orelse return error.MalformedRequest;
            if (trace.?.len == 0) return error.MalformedRequest;
        }
    }
    var context: ?std.json.Value = null;
    if (object.get("context")) |field| {
        if (field != .null) {
            if (field != .object) return error.MalformedRequest;
            context = field;
        }
    }
    return .{ .log = .{ .level = level, .source = .frontend, .message = message, .context = context, .traceId = trace } };
}

test "log relay validates fields and preserves context and trace" {
    const input =
        \\{"type":"log","level":"warn","message":"frontend error","traceId":"op-7","source":"backend","timestamp":1,"context":{"nested":{"count":2,"ok":true},"array":[null,3]}}
    ;
    var parsed = try std.json.parseFromSlice(std.json.Value, std.testing.allocator, input, .{});
    defer parsed.deinit();
    const event = (try decodeRequestValue(parsed.value)).log;
    try std.testing.expectEqual(log.Source.frontend, event.source);
    const encoded = try log.encodeEvent(std.testing.allocator, std.testing.io, event);
    defer std.testing.allocator.free(encoded);
    var retained = try std.json.parseFromSlice(std.json.Value, std.testing.allocator, encoded, .{});
    defer retained.deinit();
    try std.testing.expectEqualStrings("warning", retained.value.object.get("level").?.string);
    try std.testing.expectEqualStrings("op-7", retained.value.object.get("traceId").?.string);
    try std.testing.expect(retained.value.object.get("timestamp").?.integer != 1);
    try std.testing.expectEqual(@as(i64, 2), retained.value.object.get("context").?.object.get("nested").?.object.get("count").?.integer);
    for ([_][]const u8{
        "{}",                                                                        "{\"type\":\"log\",\"message\":\"x\"}",
        "{\"type\":\"log\",\"level\":\"ERROR\",\"message\":\"x\"}",                  "{\"type\":\"log\",\"level\":\"error\",\"message\":\" \"}",
        "{\"type\":\"log\",\"level\":\"error\",\"message\":\"x\",\"traceId\":\"\"}", "{\"type\":\"log\",\"level\":\"error\",\"message\":\"x\",\"context\":[]}",
    }) |invalid| {
        var bad = try std.json.parseFromSlice(std.json.Value, std.testing.allocator, invalid, .{});
        defer bad.deinit();
        try std.testing.expectError(error.MalformedRequest, decodeRequestValue(bad.value));
    }
}

test "null relay options are omitted" {
    var parsed = try std.json.parseFromSlice(std.json.Value, std.testing.allocator,
        \\{"type":"log","level":"err","message":"event","context":null,"traceId":null}
    , .{});
    defer parsed.deinit();
    const event = (try decodeRequestValue(parsed.value)).log;
    try std.testing.expect(event.context == null);
    try std.testing.expect(event.traceId == null);
}

test "text search parses both modes and requires query and mode strings" {
    for (std.enums.values(model.TextSearchMode)) |mode| {
        const input = try std.json.Stringify.valueAlloc(std.testing.allocator, .{ .type = "search_text", .query = "雪😀", .mode = mode }, .{});
        defer std.testing.allocator.free(input);
        var parsed = try std.json.parseFromSlice(std.json.Value, std.testing.allocator, input, .{});
        defer parsed.deinit();
        const request = (try decodeRequestValue(parsed.value)).search_text;
        try std.testing.expectEqual(mode, request.mode);
        try std.testing.expectEqualStrings("雪😀", request.query);
    }
    for ([_][]const u8{
        \\{"type":"search_text","mode":"ignore-aware"}
        ,
        \\{"type":"search_text","query":"x"}
        ,
        \\{"type":"search_text","query":null,"mode":"all-files"}
        ,
        \\{"type":"search_text","query":"x","mode":"unknown"}
        ,
        \\{"type":"search_text","query":"x","mode":false}
        ,
    }) |input| {
        var parsed = try std.json.parseFromSlice(std.json.Value, std.testing.allocator, input, .{});
        defer parsed.deinit();
        try std.testing.expectError(error.MalformedRequest, decodeRequestValue(parsed.value));
    }
}

test "text search serializes navigation metadata UTF-16 spans and truncation" {
    const response: model.Response = .{ .text_search = .{
        .matches = &.{.{ .path = "src/雪.txt", .lineNumber = 12, .lineText = "a😀é", .spans = &.{.{ .start = 1, .end = 3 }} }},
        .truncated = true,
    } };
    const encoded = try encodeResponse(std.testing.allocator, response);
    defer std.testing.allocator.free(encoded);
    try std.testing.expectEqualStrings(
        \\{"matches":[{"path":"src/雪.txt","lineNumber":12,"lineText":"a😀é","spans":[{"start":1,"end":3}]}],"truncated":true}
    , encoded);
}

// Restrict trace IDs to bounded opaque identifiers, never paths or contents.
pub fn optionalTraceId(value: ?std.json.Value) DecodeError!?[]const u8 {
    const id = try optionalJsonString(value) orelse return null;
    if (id.len == 0 or id.len > 64) return error.MalformedRequest;
    for (id) |c| if (!std.ascii.isAlphanumeric(c) and c != '-') return error.MalformedRequest;
    return id;
}

test "file requests preserve optional trace IDs and reject unbounded or unsafe IDs" {
    for ([_][]const u8{ "get_file", "get_file_diff" }) |operation| {
        const input = try std.json.Stringify.valueAlloc(std.testing.allocator, .{ .type = operation, .diffId = "active", .path = "PRIVATE", .traceId = "trace-188" }, .{});
        defer std.testing.allocator.free(input);
        var parsed = try std.json.parseFromSlice(std.json.Value, std.testing.allocator, input, .{});
        defer parsed.deinit();
        const request = try decodeRequestValue(parsed.value);
        const id = switch (request) {
            .get_file => |r| r.trace_id,
            .get_file_diff => |r| r.trace_id,
            else => unreachable,
        };
        try std.testing.expectEqualStrings("trace-188", id.?);
    }
    for ([_][]const u8{ "", "file/name", "line\ncontent", "x" ** 65 }) |id| {
        try std.testing.expectError(error.MalformedRequest, optionalTraceId(.{ .string = id }));
    }
    try std.testing.expect(try optionalTraceId(null) == null);
}
