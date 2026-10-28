const std = @import("std");
const httpz = @import("httpz");
const dispatcher_module = @import("../app/dispatcher.zig");
const json_protocol = @import("../app/json_protocol.zig");
const model = @import("../app/model.zig");

const Allocator = std.mem.Allocator;

const Handler = struct {
    dispatcher: dispatcher_module.Dispatcher,

    pub fn dispatch(self: *Handler, action: httpz.Action(*Handler), req: *httpz.Request, res: *httpz.Response) !void {
        return action(self, req, res);
    }

    pub fn notFound(self: *Handler, req: *httpz.Request, res: *httpz.Response) !void {
        if (req.method == .GET) {
            return self.failure(res, .not_found, .unknown_file);
        }
        return self.failure(res, .method_not_allowed, .malformed_request);
    }

    pub fn uncaughtError(_: *Handler, _: *httpz.Request, res: *httpz.Response, err: anyerror) void {
        std.log.warn("unexpected HTTP request failure: {t}", .{err});
        setJsonHeaders(res);
        res.status = @intFromEnum(std.http.Status.internal_server_error);
        res.body = json_protocol.encodeError(res.arena, .internal_error) catch
            "{\"error\":{\"code\":\"internal_error\",\"message\":\"Internal error\"}}";
    }

    fn dispatchRequest(self: *Handler, res: *httpz.Response, request: model.Request) !void {
        const response = self.dispatcher.dispatch(request) catch |err| {
            const code = model.errorCode(err);
            const status = errorStatus(code);
            return self.failure(res, status, code);
        };
        defer response.deinit();
        setJsonHeaders(res);
        res.body = try json_protocol.encodeResponse(res.arena, response);
    }

    fn dispatchCreated(self: *Handler, res: *httpz.Response, request: model.Request) !void {
        try self.dispatchRequest(res, request);
        if (res.status < 400) res.status = @intFromEnum(std.http.Status.created);
    }

    fn failure(_: *Handler, res: *httpz.Response, status: std.http.Status, code: model.ErrorCode) !void {
        setJsonHeaders(res);
        res.status = @intFromEnum(status);
        res.body = try json_protocol.encodeError(res.arena, code);
    }
};

fn errorStatus(code: model.ErrorCode) std.http.Status {
    return switch (code) {
        .unknown_diff, .unknown_file, .unknown_comment => .not_found,
        .malformed_request,
        .invalid_comment,
        .invalid_comment_id,
        .no_comments,
        .invalid_file_path,
        .invalid_search_query,
        => .bad_request,
        .search_unavailable, .repository_unavailable => .service_unavailable,
        else => .internal_server_error,
    };
}

fn getConfiguration(handler: *Handler, _: *httpz.Request, res: *httpz.Response) !void {
    return handler.dispatchRequest(res, .get_configuration);
}

fn getDiffOverview(handler: *Handler, _: *httpz.Request, res: *httpz.Response) !void {
    return handler.dispatchRequest(res, .get_diff_overview);
}

fn listCommits(handler: *Handler, _: *httpz.Request, res: *httpz.Response) !void {
    return handler.dispatchRequest(res, .list_commits);
}

fn reloadReview(handler: *Handler, req: *httpz.Request, res: *httpz.Response) !void {
    const body = req.body() orelse
        return handler.failure(res, .bad_request, .malformed_request);
    var parsed = std.json.parseFromSlice(std.json.Value, res.arena, body, .{}) catch
        return handler.failure(res, .bad_request, .malformed_request);
    defer parsed.deinit();
    const request = json_protocol.decodeRequestValue(parsed.value) catch
        return handler.failure(res, .bad_request, .malformed_request);
    switch (request) {
        .reload_review => return handler.dispatchRequest(res, request),
        else => return handler.failure(res, .bad_request, .malformed_request),
    }
}

fn searchText(handler: *Handler, req: *httpz.Request, res: *httpz.Response) !void {
    const body = req.body() orelse
        return handler.failure(res, .bad_request, .malformed_request);
    var parsed = std.json.parseFromSlice(std.json.Value, res.arena, body, .{}) catch
        return handler.failure(res, .bad_request, .malformed_request);
    defer parsed.deinit();
    const request = json_protocol.decodeRequestValue(parsed.value) catch
        return handler.failure(res, .bad_request, .malformed_request);
    switch (request) {
        .search_text => return handler.dispatchRequest(res, request),
        else => return handler.failure(res, .bad_request, .malformed_request),
    }
}

fn getFiles(handler: *Handler, _: *httpz.Request, res: *httpz.Response) !void {
    return handler.dispatchRequest(res, .get_files);
}

fn getFilesNotIgnored(handler: *Handler, _: *httpz.Request, res: *httpz.Response) !void {
    return handler.dispatchRequest(res, .get_files_not_ignored);
}

fn getFile(handler: *Handler, req: *httpz.Request, res: *httpz.Response) !void {
    const query = req.query() catch
        return handler.failure(res, .bad_request, .malformed_request);
    const path = query.get("path") orelse
        return handler.failure(res, .bad_request, .malformed_request);
    if (path.len == 0) return handler.failure(res, .bad_request, .malformed_request);
    return handler.dispatchRequest(res, .{ .get_file = .{ .path = path } });
}

fn getFileDiff(handler: *Handler, req: *httpz.Request, res: *httpz.Response) !void {
    const encoded_diff_id = req.param("diff_id") orelse
        return handler.failure(res, .bad_request, .malformed_request);
    const diff_id = (httpz.Url.unescape(res.arena, &.{}, encoded_diff_id) catch
        return handler.failure(res, .bad_request, .malformed_request)).value;
    const query = req.query() catch
        return handler.failure(res, .bad_request, .malformed_request);
    const path = query.get("path") orelse
        return handler.failure(res, .bad_request, .malformed_request);
    if (path.len == 0) return handler.failure(res, .bad_request, .malformed_request);

    return handler.dispatchRequest(res, .{ .get_file_diff = .{
        .diff_id = diff_id,
        .path = path,
    } });
}

fn getComments(handler: *Handler, _: *httpz.Request, res: *httpz.Response) !void {
    return handler.dispatchRequest(res, .get_comments);
}

fn createComment(handler: *Handler, req: *httpz.Request, res: *httpz.Response) !void {
    const body = req.body() orelse
        return handler.failure(res, .bad_request, .malformed_request);
    var parsed = std.json.parseFromSlice(std.json.Value, res.arena, body, .{}) catch
        return handler.failure(res, .bad_request, .malformed_request);
    defer parsed.deinit();
    const request = json_protocol.decodeRequestValue(parsed.value) catch
        return handler.failure(res, .bad_request, .malformed_request);
    switch (request) {
        .create_comment => return handler.dispatchCreated(res, request),
        else => return handler.failure(res, .bad_request, .malformed_request),
    }
}

fn editComment(handler: *Handler, req: *httpz.Request, res: *httpz.Response) !void {
    const comment_id = try commentIdParam(handler, req, res) orelse return;
    const body = req.body() orelse
        return handler.failure(res, .bad_request, .malformed_request);
    var parsed = std.json.parseFromSlice(std.json.Value, res.arena, body, .{}) catch
        return handler.failure(res, .bad_request, .malformed_request);
    defer parsed.deinit();
    const request = json_protocol.decodeRequestValue(parsed.value) catch
        return handler.failure(res, .bad_request, .malformed_request);
    switch (request) {
        .edit_comment => |details| {
            if (!std.mem.eql(u8, comment_id, details.comment_id)) {
                return handler.failure(res, .bad_request, .invalid_comment_id);
            }
            return handler.dispatchRequest(res, request);
        },
        else => return handler.failure(res, .bad_request, .malformed_request),
    }
}

fn deleteComment(handler: *Handler, req: *httpz.Request, res: *httpz.Response) !void {
    const comment_id = try commentIdParam(handler, req, res) orelse return;
    const body = req.body() orelse
        return handler.failure(res, .bad_request, .malformed_request);
    var parsed = std.json.parseFromSlice(std.json.Value, res.arena, body, .{}) catch
        return handler.failure(res, .bad_request, .malformed_request);
    defer parsed.deinit();
    const request = json_protocol.decodeRequestValue(parsed.value) catch
        return handler.failure(res, .bad_request, .malformed_request);
    switch (request) {
        .delete_comment => |details| {
            if (!std.mem.eql(u8, comment_id, details.comment_id)) {
                return handler.failure(res, .bad_request, .invalid_comment_id);
            }
            return handler.dispatchRequest(res, request);
        },
        else => return handler.failure(res, .bad_request, .malformed_request),
    }
}

fn commentIdParam(
    handler: *Handler,
    req: *httpz.Request,
    res: *httpz.Response,
) !?[]const u8 {
    const encoded = req.param("comment_id") orelse {
        try handler.failure(res, .bad_request, .invalid_comment_id);
        return null;
    };
    const comment_id = (httpz.Url.unescape(res.arena, &.{}, encoded) catch {
        try handler.failure(res, .bad_request, .invalid_comment_id);
        return null;
    }).value;
    return comment_id;
}

fn copyCommentsAsMarkdown(handler: *Handler, req: *httpz.Request, res: *httpz.Response) !void {
    const body = req.body() orelse
        return handler.failure(res, .bad_request, .malformed_request);
    var parsed = std.json.parseFromSlice(std.json.Value, res.arena, body, .{}) catch
        return handler.failure(res, .bad_request, .malformed_request);
    defer parsed.deinit();
    const request = json_protocol.decodeRequestValue(parsed.value) catch
        return handler.failure(res, .bad_request, .malformed_request);
    switch (request) {
        .copy_comments_as_markdown => return handler.dispatchRequest(res, request),
        else => return handler.failure(res, .bad_request, .malformed_request),
    }
}

fn copyFilePath(handler: *Handler, req: *httpz.Request, res: *httpz.Response) !void {
    const body = req.body() orelse
        return handler.failure(res, .bad_request, .malformed_request);
    var parsed = std.json.parseFromSlice(std.json.Value, res.arena, body, .{}) catch
        return handler.failure(res, .bad_request, .malformed_request);
    defer parsed.deinit();
    const request = json_protocol.decodeRequestValue(parsed.value) catch
        return handler.failure(res, .bad_request, .malformed_request);
    switch (request) {
        .copy_file_path => return handler.dispatchRequest(res, request),
        else => return handler.failure(res, .bad_request, .malformed_request),
    }
}

fn clearComments(handler: *Handler, req: *httpz.Request, res: *httpz.Response) !void {
    const body = req.body() orelse
        return handler.failure(res, .bad_request, .malformed_request);
    var parsed = std.json.parseFromSlice(std.json.Value, res.arena, body, .{}) catch
        return handler.failure(res, .bad_request, .malformed_request);
    defer parsed.deinit();
    const request = json_protocol.decodeRequestValue(parsed.value) catch
        return handler.failure(res, .bad_request, .malformed_request);
    switch (request) {
        .clear_comments => return handler.dispatchRequest(res, request),
        else => return handler.failure(res, .bad_request, .malformed_request),
    }
}

pub fn serve(allocator: Allocator, io: std.Io, dispatcher: dispatcher_module.Dispatcher, address: std.Io.net.IpAddress) !void {
    var handler: Handler = .{ .dispatcher = dispatcher };
    var server = try httpz.Server(*Handler).init(io, allocator, .{ .address = .{ .ip = address } }, &handler);
    defer server.deinit();
    defer server.stop();

    const router = try server.router(.{});
    router.post("/api/log", submitLog, .{});
    router.get("/api/configuration", getConfiguration, .{});
    router.get("/api/diffs/active", getDiffOverview, .{});
    router.get("/api/repository/commits", listCommits, .{});
    router.post("/api/review/reload", reloadReview, .{});
    router.post("/api/search/text", searchText, .{});
    router.get("/api/diffs/:diff_id/files", getFileDiff, .{});
    router.get("/api/files", getFiles, .{});
    router.get("/api/files/not-ignored", getFilesNotIgnored, .{});
    router.get("/api/files/content", getFile, .{});
    router.post("/api/files/copy-path", copyFilePath, .{});
    router.get("/api/comments", getComments, .{});
    router.post("/api/comments", createComment, .{});
    router.patch("/api/comments/:comment_id", editComment, .{});
    router.delete("/api/comments/:comment_id", deleteComment, .{});
    router.post("/api/comments/copy-markdown", copyCommentsAsMarkdown, .{});
    router.delete("/api/comments", clearComments, .{});

    std.log.info("rvw listening on http://{f}", .{address});
    try server.listen();
}

fn setJsonHeaders(res: *httpz.Response) void {
    res.header("content-type", "application/json; charset=utf-8");
    res.header("cache-control", "no-store");
}

test "HTTP comment mutation errors distinguish invalid and stale IDs" {
    try std.testing.expectEqual(std.http.Status.bad_request, errorStatus(.invalid_comment));
    try std.testing.expectEqual(std.http.Status.bad_request, errorStatus(.invalid_comment_id));
    try std.testing.expectEqual(std.http.Status.not_found, errorStatus(.unknown_comment));
}

fn submitLog(handler: *Handler, req: *httpz.Request, res: *httpz.Response) !void {
    const body = req.body() orelse return handler.failure(res, .bad_request, .malformed_request);
    var parsed = std.json.parseFromSlice(std.json.Value, res.arena, body, .{}) catch return handler.failure(res, .bad_request, .malformed_request);
    defer parsed.deinit();
    const request = json_protocol.decodeRequestValue(parsed.value) catch return handler.failure(res, .bad_request, .malformed_request);
    if (request != .log) return handler.failure(res, .bad_request, .malformed_request);
    return handler.dispatchRequest(res, request);
}

test "HTTP text search validates requests and returns empty results without execution" {
    const SearchDispatcher = struct {
        fn dispatch(_: *anyopaque, request: model.Request) !model.Response {
            var provider: @import("../provider/text_search/ripgrep.zig").RipgrepProvider = .{
                .allocator = std.testing.allocator,
                .mode = request.search_text.mode,
            };
            return .{ .text_search = try provider.interface().search(std.testing.io, "/does-not-exist", request.search_text.query) };
        }
    };
    var context: u8 = 0;
    var handler: Handler = .{ .dispatcher = .{ .context = &context, .dispatchFn = SearchDispatcher.dispatch } };
    for (std.enums.values(model.TextSearchMode)) |mode| {
        var ht = httpz.testing.init(.{});
        defer ht.deinit();
        ht.json(.{ .type = "search_text", .query = "", .mode = mode });
        try searchText(&handler, ht.req, ht.res);
        try ht.expectStatusCode(.ok);
        try ht.expectHeader("content-type", "application/json; charset=utf-8");
        try ht.expectBody(
            \\{"matches":[],"truncated":false}
        );
    }
    for ([_][]const u8{
        "{}",
        \\{"type":"search_text","query":"x","mode":"invalid"}
        ,
        \\{"type":"get_files"}
        ,
    }) |input| {
        var ht = httpz.testing.init(.{});
        defer ht.deinit();
        ht.body(input);
        try searchText(&handler, ht.req, ht.res);
        try ht.expectStatusCode(.bad_request);
    }
    try std.testing.expectEqual(std.http.Status.bad_request, errorStatus(.invalid_search_query));
    try std.testing.expectEqual(std.http.Status.service_unavailable, errorStatus(.search_unavailable));
    try std.testing.expectEqual(std.http.Status.internal_server_error, errorStatus(.search_failed));
}

test "real ripgrep results cross HTTP and native JSON transports in both modes" {
    var repository = try @import("../testing/repository.zig").Repository.init(std.testing.allocator);
    defer repository.deinit();
    try repository.write(".gitignore", "ignored.txt\n");
    try repository.write("unchanged.txt", "a😀雪\n");
    try repository.commit("initial");
    try repository.write("ignored.txt", "a😀雪\n");
    const SearchDispatcher = struct {
        root: []const u8,
        fn dispatch(context: *anyopaque, request: model.Request) !model.Response {
            const self: *@This() = @ptrCast(@alignCast(context));
            var provider: @import("../provider/text_search/ripgrep.zig").RipgrepProvider = .{
                .allocator = std.testing.allocator,
                .mode = request.search_text.mode,
            };
            return .{ .text_search = try provider.interface().search(std.testing.io, self.root, request.search_text.query) };
        }
    };
    var search: SearchDispatcher = .{ .root = repository.root };
    const dispatcher: dispatcher_module.Dispatcher = .{ .context = &search, .dispatchFn = SearchDispatcher.dispatch };
    var handler: Handler = .{ .dispatcher = dispatcher };
    for (std.enums.values(model.TextSearchMode)) |mode| {
        const input = try std.json.Stringify.valueAlloc(std.testing.allocator, .{ .type = "search_text", .mode = mode, .query = "雪" }, .{});
        defer std.testing.allocator.free(input);
        const native = try json_protocol.dispatchJson(std.testing.allocator, dispatcher, input);
        defer std.testing.allocator.free(native);
        var envelope = try std.json.parseFromSlice(std.json.Value, std.testing.allocator, native, .{});
        defer envelope.deinit();
        try std.testing.expect(envelope.value.object.get("ok").?.bool);
        var ht = httpz.testing.init(.{});
        defer ht.deinit();
        ht.body(input);
        try searchText(&handler, ht.req, ht.res);
        try ht.expectStatusCode(.ok);
        var http = try std.json.parseFromSlice(std.json.Value, std.testing.allocator, ht.res.body, .{});
        defer http.deinit();
        for ([_]std.json.Value{ envelope.value.object.get("data").?, http.value }) |data| {
            const matches = data.object.get("matches").?.array.items;
            try std.testing.expectEqual(@as(usize, if (mode == .@"all-files") 2 else 1), matches.len);
            try std.testing.expectEqual(@as(usize, 2), data.object.count());
            for (matches) |match| {
                try std.testing.expectEqualStrings("a😀雪", match.object.get("lineText").?.string);
                const span = match.object.get("spans").?.array.items[0];
                try std.testing.expectEqual(@as(i64, 3), span.object.get("start").?.integer);
                try std.testing.expectEqual(@as(i64, 4), span.object.get("end").?.integer);
            }
        }
    }
}

test "commit history crosses HTTP and native JSON with matching results and errors" {
    var repository = try @import("../testing/repository.zig").Repository.init(std.testing.allocator);
    defer repository.deinit();
    const CommitDispatcher = struct {
        root: []const u8,
        provider: @import("../provider/repository/git.zig").GitProvider = .{ .allocator = std.testing.allocator },
        fn dispatch(context: *anyopaque, request: model.Request) !model.Response {
            const self: *@This() = @ptrCast(@alignCast(context));
            try std.testing.expect(request == .list_commits);
            return .{ .commit_list = try self.provider.interface().listCommits(std.testing.io, self.root) };
        }
    };
    var context: CommitDispatcher = .{ .root = repository.root };
    const dispatcher: dispatcher_module.Dispatcher = .{ .context = &context, .dispatchFn = CommitDispatcher.dispatch };
    var handler: Handler = .{ .dispatcher = dispatcher };
    const input = "{\"type\":\"list_commits\"}";
    for (0..2) |count| {
        if (count == 1) {
            try repository.write("tracked.txt", "content\n");
            try repository.commit("Subject with \"quotes\" and 雪\nsecond line\n\nbody");
        }
        const native = try json_protocol.dispatchJson(std.testing.allocator, dispatcher, input);
        defer std.testing.allocator.free(native);
        const envelope = try std.json.parseFromSlice(std.json.Value, std.testing.allocator, native, .{});
        defer envelope.deinit();
        try std.testing.expect(envelope.value.object.get("ok").?.bool);
        const data = envelope.value.object.get("data").?;
        const commits = data.object.get("commits").?.array.items;
        try std.testing.expectEqual(count, commits.len);
        try std.testing.expectEqual(@as(usize, 1), data.object.count());
        if (count == 1) {
            const sha = try repository.revision("HEAD");
            defer std.testing.allocator.free(sha);
            const commit = commits[0].object;
            try std.testing.expectEqual(@as(usize, 4), commit.count());
            try std.testing.expectEqualStrings(sha, commit.get("sha").?.string);
            try std.testing.expectEqualStrings("Subject with \"quotes\" and 雪", commit.get("subject").?.string);
            try std.testing.expectEqualStrings("rvw tests", commit.get("authorName").?.string);
            try std.testing.expect(commit.get("commitDate").?.string.len > 0);
        }
        const expected = try std.json.Stringify.valueAlloc(std.testing.allocator, data, .{});
        defer std.testing.allocator.free(expected);
        var ht = httpz.testing.init(.{});
        defer ht.deinit();
        try listCommits(&handler, ht.req, ht.res);
        try ht.expectStatusCode(.ok);
        try ht.expectHeader("content-type", "application/json; charset=utf-8");
        try ht.expectHeader("cache-control", "no-store");
        try ht.expectBody(expected);
    }
    for ([_]struct { executable: []const u8, code: model.ErrorCode, status: std.http.Status }{
        .{ .executable = "/rvw-missing-git", .code = .repository_unavailable, .status = .service_unavailable },
        .{ .executable = "/usr/bin/false", .code = .repository_failed, .status = .internal_server_error },
        .{ .executable = "/usr/bin/true", .code = .invalid_commit_history, .status = .internal_server_error },
    }) |failure| {
        context.provider.executable = failure.executable;
        const native = try json_protocol.dispatchJson(std.testing.allocator, dispatcher, input);
        defer std.testing.allocator.free(native);
        const envelope = try std.json.parseFromSlice(std.json.Value, std.testing.allocator, native, .{});
        defer envelope.deinit();
        try std.testing.expect(!envelope.value.object.get("ok").?.bool);
        try std.testing.expectEqualStrings(@tagName(failure.code), envelope.value.object.get("error").?.object.get("code").?.string);
        var ht = httpz.testing.init(.{});
        defer ht.deinit();
        try listCommits(&handler, ht.req, ht.res);
        try ht.expectStatusCode(failure.status);
        const expected = try json_protocol.encodeError(std.testing.allocator, failure.code);
        defer std.testing.allocator.free(expected);
        try ht.expectBody(expected);
    }
    // Result storage uses the testing allocator. A missing deinit leaks here.
    context.provider.executable = null;
    var ht = httpz.testing.init(.{});
    defer ht.deinit();
    var failing = std.testing.FailingAllocator.init(std.testing.allocator, .{ .fail_index = 0 });
    ht.res.arena = failing.allocator();
    try std.testing.expectError(error.OutOfMemory, listCommits(&handler, ht.req, ht.res));
}
