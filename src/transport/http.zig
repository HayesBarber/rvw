const std = @import("std");
const default_executables = @import("../config/executables.zig").defaults;
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

    fn dispatchRequest(self: *Handler, req: *httpz.Request, res: *httpz.Response, request: model.Request) !void {
        const session_id = if (req.header("x-rvw-session")) |value|
            json_protocol.parseSessionId(value) catch return self.failure(res, .bad_request, .malformed_request)
        else
            null;
        const scoped = self.dispatcher.dispatchScoped(request, session_id) catch |err| {
            const code = model.errorCode(err);
            const status = if (request == .reload_review and code == .invalid_revision) .bad_request else errorStatus(code);
            return self.failure(res, status, code);
        };
        defer scoped.deinit();
        setJsonHeaders(res);
        res.body = try json_protocol.encodeResponse(res.arena, scoped.response);
    }

    fn dispatchCreated(self: *Handler, req: *httpz.Request, res: *httpz.Response, request: model.Request) !void {
        try self.dispatchRequest(req, res, request);
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
        .stale_session => .conflict,
        .malformed_request,
        .invalid_comment,
        .invalid_comment_id,
        .no_comments,
        .invalid_file_path,
        .invalid_search_query,
        .missing_origin,
        .unsupported_origin,
        => .bad_request,
        .search_unavailable, .repository_unavailable, .pull_request_list_unavailable, .pull_request_authentication_failed, .pull_request_unavailable => .service_unavailable,
        else => .internal_server_error,
    };
}

fn getReviewSession(handler: *Handler, req: *httpz.Request, res: *httpz.Response) !void {
    return handler.dispatchRequest(req, res, .get_review_session);
}

fn getLaunchIntent(handler: *Handler, req: *httpz.Request, res: *httpz.Response) !void {
    return handler.dispatchRequest(req, res, .get_launch_intent);
}

fn acknowledgeLaunchIntent(handler: *Handler, req: *httpz.Request, res: *httpz.Response) !void {
    const body = req.body() orelse return handler.failure(res, .bad_request, .malformed_request);
    var parsed = std.json.parseFromSlice(std.json.Value, res.arena, body, .{}) catch
        return handler.failure(res, .bad_request, .malformed_request);
    defer parsed.deinit();
    const request = json_protocol.decodeRequestValue(parsed.value) catch
        return handler.failure(res, .bad_request, .malformed_request);
    if (request != .acknowledge_launch_intent) return handler.failure(res, .bad_request, .malformed_request);
    return handler.dispatchRequest(req, res, request);
}

fn getConfiguration(handler: *Handler, req: *httpz.Request, res: *httpz.Response) !void {
    return handler.dispatchRequest(req, res, .get_configuration);
}

fn getDiffOverview(handler: *Handler, req: *httpz.Request, res: *httpz.Response) !void {
    return handler.dispatchRequest(req, res, .get_diff_overview);
}

fn listCommits(handler: *Handler, req: *httpz.Request, res: *httpz.Response) !void {
    return handler.dispatchRequest(req, res, .list_commits);
}

fn listWorkingTreeChanges(handler: *Handler, req: *httpz.Request, res: *httpz.Response) !void {
    return handler.dispatchRequest(req, res, .list_working_tree_changes);
}

fn listOpenPullRequests(handler: *Handler, req: *httpz.Request, res: *httpz.Response) !void {
    return handler.dispatchRequest(req, res, .list_open_pull_requests);
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
        .reload_review => return handler.dispatchRequest(req, res, request),
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
        .search_text => return handler.dispatchRequest(req, res, request),
        else => return handler.failure(res, .bad_request, .malformed_request),
    }
}

fn getFiles(handler: *Handler, req: *httpz.Request, res: *httpz.Response) !void {
    return handler.dispatchRequest(req, res, .get_files);
}

fn getFilesNotIgnored(handler: *Handler, req: *httpz.Request, res: *httpz.Response) !void {
    return handler.dispatchRequest(req, res, .get_files_not_ignored);
}

fn getFile(handler: *Handler, req: *httpz.Request, res: *httpz.Response) !void {
    const query = req.query() catch
        return handler.failure(res, .bad_request, .malformed_request);
    const path = query.get("path") orelse
        return handler.failure(res, .bad_request, .malformed_request);
    if (path.len == 0) return handler.failure(res, .bad_request, .malformed_request);
    return handler.dispatchRequest(req, res, .{ .get_file = .{ .path = path } });
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

    return handler.dispatchRequest(req, res, .{ .get_file_diff = .{
        .diff_id = diff_id,
        .path = path,
    } });
}

fn getComments(handler: *Handler, req: *httpz.Request, res: *httpz.Response) !void {
    return handler.dispatchRequest(req, res, .get_comments);
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
        .create_comment => return handler.dispatchCreated(req, res, request),
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
            return handler.dispatchRequest(req, res, request);
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
            return handler.dispatchRequest(req, res, request);
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
        .copy_comments_as_markdown => return handler.dispatchRequest(req, res, request),
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
        .copy_file_path => return handler.dispatchRequest(req, res, request),
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
        .clear_comments => return handler.dispatchRequest(req, res, request),
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
    router.get("/api/review/session", getReviewSession, .{});
    router.get("/api/review/launch-intent", getLaunchIntent, .{});
    router.post("/api/review/launch-intent/acknowledge", acknowledgeLaunchIntent, .{});
    router.get("/api/diffs/active", getDiffOverview, .{});
    router.get("/api/repository/commits", listCommits, .{});
    router.get("/api/repository/working-tree-changes", listWorkingTreeChanges, .{});
    router.get("/api/repository/pull-requests", listOpenPullRequests, .{});
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
    return handler.dispatchRequest(req, res, request);
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

const RepositoryTransportTest = struct {
    root: []const u8,
    request: model.Request,
    repository: @import("../provider/repository/git.zig").GitProvider = .{ .allocator = std.testing.allocator },
    pull_requests: @import("../provider/pull_request/github_cli.zig").GitHubCliProvider = .{ .allocator = std.testing.allocator },
    failure: ?anyerror = null,

    fn dispatch(context: *anyopaque, request: model.Request) !model.Response {
        const self: *@This() = @ptrCast(@alignCast(context));
        try std.testing.expectEqual(std.meta.activeTag(self.request), std.meta.activeTag(request));
        if (self.failure) |failure| return failure;
        return switch (request) {
            .list_commits => .{ .commit_list = try self.repository.interface().listCommits(std.testing.io, self.root) },
            .list_working_tree_changes => .{ .working_tree_changes = try self.repository.interface().listWorkingTreeChanges(std.testing.io, self.root) },
            .list_open_pull_requests => .{ .pull_request_list = try self.pull_requests.interface().listOpenPullRequests(std.testing.io, self.root) },
            else => error.UnexpectedRequest,
        };
    }

    fn handler(self: *@This()) Handler {
        return .{ .dispatcher = .{ .context = self, .dispatchFn = dispatch } };
    }

    fn action(self: *@This()) httpz.Action(*Handler) {
        return switch (self.request) {
            .list_commits => listCommits,
            .list_working_tree_changes => listWorkingTreeChanges,
            .list_open_pull_requests => listOpenPullRequests,
            else => unreachable,
        };
    }

    fn input(self: *@This()) ![]u8 {
        return std.fmt.allocPrint(std.testing.allocator, "{{\"type\":\"{s}\"}}", .{@tagName(self.request)});
    }

    fn expectResponse(self: *@This()) !std.json.Parsed(std.json.Value) {
        var target = self.handler();
        const request = try self.input();
        defer std.testing.allocator.free(request);
        const native = try json_protocol.dispatchJson(std.testing.allocator, target.dispatcher, request);
        defer std.testing.allocator.free(native);
        const envelope = try std.json.parseFromSlice(std.json.Value, std.testing.allocator, native, .{});
        errdefer envelope.deinit();
        try std.testing.expect(envelope.value.object.get("ok").?.bool);
        const expected = try std.json.Stringify.valueAlloc(std.testing.allocator, envelope.value.object.get("data").?, .{});
        defer std.testing.allocator.free(expected);
        var ht = httpz.testing.init(.{});
        defer ht.deinit();
        try self.action()(&target, ht.req, ht.res);
        try ht.expectStatusCode(.ok);
        try ht.expectHeader("content-type", "application/json; charset=utf-8");
        try ht.expectHeader("cache-control", "no-store");
        try ht.expectBody(expected);
        return envelope;
    }

    fn expectError(self: *@This(), code: model.ErrorCode, status: std.http.Status) !void {
        var target = self.handler();
        const request = try self.input();
        defer std.testing.allocator.free(request);
        const native = try json_protocol.dispatchJson(std.testing.allocator, target.dispatcher, request);
        defer std.testing.allocator.free(native);
        const expected = try json_protocol.encodeError(std.testing.allocator, code);
        defer std.testing.allocator.free(expected);
        const expected_native = try std.fmt.allocPrint(std.testing.allocator, "{{\"ok\":false,{s}", .{expected[1..]});
        defer std.testing.allocator.free(expected_native);
        try std.testing.expectEqualStrings(expected_native, native);
        var ht = httpz.testing.init(.{});
        defer ht.deinit();
        try self.action()(&target, ht.req, ht.res);
        try ht.expectStatusCode(status);
        try ht.expectBody(expected);
    }

    fn expectSerializationFailure(self: *@This()) !void {
        var target = self.handler();
        var ht = httpz.testing.init(.{});
        defer ht.deinit();
        var failing = std.testing.FailingAllocator.init(std.testing.allocator, .{ .fail_index = 0 });
        ht.res.arena = failing.allocator();
        try std.testing.expectError(error.OutOfMemory, self.action()(&target, ht.req, ht.res));
    }
};

test "commit history crosses HTTP and native JSON with matching results and errors" {
    var repository = try @import("../testing/repository.zig").Repository.init(std.testing.allocator);
    defer repository.deinit();
    var context: RepositoryTransportTest = .{ .root = repository.root, .request = .list_commits };
    for (0..2) |count| {
        if (count == 1) {
            try repository.write("tracked.txt", "content\n");
            try repository.commit("Subject with \"quotes\" and 雪\nsecond line\n\nbody");
        }
        const envelope = try context.expectResponse();
        defer envelope.deinit();
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
    }
    for ([_]struct { executable: []const u8, code: model.ErrorCode, status: std.http.Status }{
        .{ .executable = "/rvw-missing-git", .code = .repository_unavailable, .status = .service_unavailable },
        .{ .executable = "/usr/bin/false", .code = .repository_failed, .status = .internal_server_error },
        .{ .executable = "/usr/bin/true", .code = .invalid_commit_history, .status = .internal_server_error },
    }) |failure| {
        context.repository.executable = failure.executable;
        try context.expectError(failure.code, failure.status);
    }
    context.repository.executable = default_executables.git;
    try context.expectSerializationFailure();
}

test "open pull requests cross HTTP and native JSON with matching results and errors" {
    var repository = try @import("../testing/repository.zig").Repository.init(std.testing.allocator);
    defer repository.deinit();
    try repository.git(&.{ "remote", "add", "origin", "https://github.com/owner/repo.git" });
    try repository.write(".git/fake-gh", "#!/bin/sh\ncat .git/gh-response\n");
    var executable = try repository.temporary.dir.openFile(std.testing.io, ".git/fake-gh", .{});
    defer executable.close(std.testing.io);
    try executable.setPermissions(std.testing.io, .executable_file);
    const gh = try std.fs.path.join(std.testing.allocator, &.{ repository.root, ".git/fake-gh" });
    defer std.testing.allocator.free(gh);
    var context: RepositoryTransportTest = .{ .root = repository.root, .request = .list_open_pull_requests, .pull_requests = .{ .allocator = std.testing.allocator, .executable = gh } };
    const output =
        \\[{"number":42,"title":"Draft \"quoted\" 雪","author":{"login":"author"},"url":"https://github.com/owner/repo/pull/42","isDraft":true,"baseRefName":"main","headRefName":"feature"},{"number":7,"title":"Ready","author":{"login":"other"},"url":"https://github.com/owner/repo/pull/7","isDraft":false,"baseRefName":"release","headRefName":"fix"}]
    ;
    for ([_][]const u8{ "[]", output, "[]" }, [_]usize{ 0, 2, 0 }) |body, count| {
        try repository.write(".git/gh-response", body);
        const envelope = try context.expectResponse();
        defer envelope.deinit();
        const data = envelope.value.object.get("data").?;
        const requests = data.object.get("pullRequests").?.array.items;
        try std.testing.expectEqual(count, requests.len);
        try std.testing.expectEqual(@as(usize, 1), data.object.count());
        if (count != 0) {
            const draft = requests[0].object;
            try std.testing.expectEqual(@as(usize, 7), draft.count());
            try std.testing.expectEqual(@as(i64, 42), draft.get("number").?.integer);
            try std.testing.expectEqualStrings("Draft \"quoted\" 雪", draft.get("title").?.string);
            try std.testing.expectEqualStrings("author", draft.get("authorLogin").?.string);
            try std.testing.expectEqualStrings("https://github.com/owner/repo/pull/42", draft.get("url").?.string);
            try std.testing.expect(draft.get("isDraft").?.bool);
            try std.testing.expectEqualStrings("main", draft.get("baseRefName").?.string);
            try std.testing.expectEqualStrings("feature", draft.get("headRefName").?.string);
            try std.testing.expectEqual(@as(i64, 7), requests[1].object.get("number").?.integer);
            try std.testing.expect(!requests[1].object.get("isDraft").?.bool);
        }
    }
    for ([_]struct { failure: anyerror, code: model.ErrorCode, status: std.http.Status }{
        .{ .failure = error.MissingOrigin, .code = .missing_origin, .status = .bad_request },
        .{ .failure = error.UnsupportedOrigin, .code = .unsupported_origin, .status = .bad_request },
        .{ .failure = error.RepositoryUnavailable, .code = .repository_unavailable, .status = .service_unavailable },
        .{ .failure = error.RepositoryFailed, .code = .repository_failed, .status = .internal_server_error },
        .{ .failure = error.PullRequestListUnavailable, .code = .pull_request_list_unavailable, .status = .service_unavailable },
        .{ .failure = error.PullRequestAuthenticationFailed, .code = .pull_request_authentication_failed, .status = .service_unavailable },
        .{ .failure = error.PullRequestListFailed, .code = .pull_request_list_failed, .status = .internal_server_error },
        .{ .failure = error.InvalidPullRequestList, .code = .invalid_pull_request_list, .status = .internal_server_error },
    }) |failure| {
        context.failure = failure.failure;
        try context.expectError(failure.code, failure.status);
    }
    context.failure = null;
    try repository.write(".git/gh-response", output);
    try context.expectSerializationFailure();
}

test "working-tree summaries cross HTTP and native JSON with matching results and errors" {
    var repository = try @import("../testing/repository.zig").Repository.init(std.testing.allocator);
    defer repository.deinit();
    try repository.write("old.txt", "base\n");
    try repository.commit("base");
    var context: RepositoryTransportTest = .{ .root = repository.root, .request = .list_working_tree_changes };
    for (0..2) |phase| {
        if (phase == 1) {
            try repository.git(&.{ "mv", "old.txt", "new 雪.txt" });
            try repository.write("binary.dat", "\x00data");
        }
        const files: []const model.FileSummary = if (phase == 0) &.{} else &.{
            .{ .path = "binary.dat", .status = .added, .additions = null, .deletions = null },
            .{ .path = "new 雪.txt", .previousPath = "old.txt", .status = .renamed, .additions = 0, .deletions = 0 },
        };
        const expected = try std.json.Stringify.valueAlloc(std.testing.allocator, .{ .files = files }, .{});
        defer std.testing.allocator.free(expected);
        const envelope = try context.expectResponse();
        defer envelope.deinit();
        const actual = try std.json.Stringify.valueAlloc(std.testing.allocator, envelope.value.object.get("data").?, .{});
        defer std.testing.allocator.free(actual);
        try std.testing.expectEqualStrings(expected, actual);
    }
    for ([_]anyerror{ error.RepositoryUnavailable, error.WorkingTreeChangesFailed, error.InvalidRevision, error.UnsupportedPath, error.MalformedGitOutput }) |failure| {
        context.failure = failure;
        const code = model.errorCode(failure);
        try context.expectError(code, if (failure == error.RepositoryUnavailable) .service_unavailable else .internal_server_error);
    }
    context.failure = null;
    try context.expectSerializationFailure();
}

test "HTTP launch intent retains pending instructions until acknowledgement and clears on reload" {
    const allocator = std.testing.allocator;
    const io = std.testing.io;
    const Session = @import("../app/session.zig").Session;
    const Owner = @import("../app/session_owner.zig").SessionOwner;
    var repository = try @import("../testing/repository.zig").Repository.init(allocator);
    defer repository.deinit();
    try repository.write("file.txt", "base\n");
    try repository.commit("base");
    var owner = Owner.init(io, try Session.create(allocator, io, .{
        .directory = repository.root,
        .configuration = .{ .configuration = .{ .object = .empty }, .diagnostic = null },
        .logger = @import("../log/log.zig").stderrLogger(allocator),
    }));
    defer owner.deinit();
    var handler: Handler = .{ .dispatcher = owner.dispatcher() };
    {
        var ht = httpz.testing.init(.{});
        defer ht.deinit();
        try getLaunchIntent(&handler, ht.req, ht.res);
        try ht.expectStatusCode(.ok);
        try ht.expectHeader("cache-control", "no-store");
        try ht.expectBody("{\"openReviewSourcePicker\":false}");
    }
    owner.active.core.open_review_source_picker = true;
    for (0..2) |_| {
        var ht = httpz.testing.init(.{});
        defer ht.deinit();
        try getLaunchIntent(&handler, ht.req, ht.res);
        try ht.expectStatusCode(.ok);
        try ht.expectBody("{\"openReviewSourcePicker\":true}");
    }
    {
        var ht = httpz.testing.init(.{});
        defer ht.deinit();
        var failing = std.testing.FailingAllocator.init(allocator, .{ .fail_index = 0 });
        ht.res.arena = failing.allocator();
        try std.testing.expectError(error.OutOfMemory, getLaunchIntent(&handler, ht.req, ht.res));
        try std.testing.expect(owner.active.core.open_review_source_picker);
    }
    for ([_]?[]const u8{ null, "{", "{\"type\":\"get_launch_intent\"}" }) |body| {
        var ht = httpz.testing.init(.{});
        defer ht.deinit();
        if (body) |value| ht.body(value);
        try acknowledgeLaunchIntent(&handler, ht.req, ht.res);
        try ht.expectStatusCode(.bad_request);
        try std.testing.expect(owner.active.core.open_review_source_picker);
    }
    for (0..2) |_| {
        var ht = httpz.testing.init(.{});
        defer ht.deinit();
        ht.json(.{ .type = "acknowledge_launch_intent" });
        try acknowledgeLaunchIntent(&handler, ht.req, ht.res);
        try ht.expectStatusCode(.ok);
        try ht.expectBody("{\"openReviewSourcePicker\":false}");
    }
    var transport: ReloadTransportTest = .{ .owner = &owner, .transport = .http };
    try transport.reload(null, null);
    {
        var ht = httpz.testing.init(.{});
        defer ht.deinit();
        ht.header("x-rvw-session", "2");
        try getLaunchIntent(&handler, ht.req, ht.res);
        try ht.expectStatusCode(.ok);
        try ht.expectBody("{\"openReviewSourcePicker\":false}");
    }
    {
        var ht = httpz.testing.init(.{});
        defer ht.deinit();
        ht.header("x-rvw-session", "1");
        ht.json(.{ .type = "acknowledge_launch_intent" });
        try acknowledgeLaunchIntent(&handler, ht.req, ht.res);
        try ht.expectStatusCode(.conflict);
    }
}

test "HTTP session scopes reject stale mutations and release after serialization failure" {
    const allocator = std.testing.allocator;
    const io = std.testing.io;
    const session_module = @import("../app/session.zig");
    const Owner = @import("../app/session_owner.zig").SessionOwner;
    var repository = try @import("../testing/repository.zig").Repository.init(allocator);
    defer repository.deinit();
    try repository.write("file.txt", "base\n");
    try repository.commit("base");
    const session = try session_module.Session.create(allocator, io, .{
        .directory = repository.root,
        .configuration = .{ .configuration = .{ .object = .empty }, .diagnostic = null },
        .logger = @import("../log/log.zig").stderrLogger(allocator),
    });
    var owner = Owner.init(io, session);
    defer owner.deinit();
    var handler: Handler = .{ .dispatcher = owner.dispatcher() };
    {
        var ht = httpz.testing.init(.{});
        defer ht.deinit();
        var failing = std.testing.FailingAllocator.init(allocator, .{ .fail_index = 0 });
        ht.res.arena = failing.allocator();
        try std.testing.expectError(error.OutOfMemory, getDiffOverview(&handler, ht.req, ht.res));
        try std.testing.expect(owner.mutex.tryLock());
        owner.mutex.unlock(io);
    }
    try owner.replace(try session_module.Session.create(allocator, io, owner.active.options));
    for ([_]?[]const u8{ null, "1", "2", "invalid", "0" }) |id| {
        var ht = httpz.testing.init(.{});
        defer ht.deinit();
        if (id) |value| ht.header("x-rvw-session", value);
        ht.json(.{ .type = "create_comment", .body = "new session", .target = .{ .kind = "review" } });
        try createComment(&handler, ht.req, ht.res);
        const valid = if (id) |value| std.mem.eql(u8, value, "2") else false;
        const malformed = if (id) |value| std.mem.eql(u8, value, "invalid") or std.mem.eql(u8, value, "0") else false;
        try ht.expectStatusCode(if (valid) .created else if (malformed) .bad_request else .conflict);
    }
    {
        var ht = httpz.testing.init(.{});
        defer ht.deinit();
        try getReviewSession(&handler, ht.req, ht.res);
        try ht.expectBody("{\"id\":2}");
    }
    const current = try owner.dispatcher().dispatchScoped(.get_comments, 2);
    defer current.deinit();
    try std.testing.expectEqual(@as(usize, 1), current.response.comments.len);
}

const ReloadTransportTest = struct {
    owner: *@import("../app/session_owner.zig").SessionOwner,
    transport: enum { http, native },
    session_id: u64 = 1,

    fn reload(self: *@This(), source: ?model.DiffSource, expected_error: ?model.ErrorCode) !void {
        const input = try std.json.Stringify.valueAlloc(std.testing.allocator, .{
            .type = "reload_review",
            .source = source,
            .sessionId = self.session_id,
        }, .{ .emit_null_optional_fields = false });
        defer std.testing.allocator.free(input);
        try self.request(input, expected_error);
    }

    fn request(self: *@This(), input: []const u8, expected_error: ?model.ErrorCode) !void {
        const allocator = std.testing.allocator;
        const encoded = switch (self.transport) {
            .native => try json_protocol.dispatchJson(allocator, self.owner.dispatcher(), input),
            .http => blk: {
                var ht = httpz.testing.init(.{});
                defer ht.deinit();
                var handler: Handler = .{ .dispatcher = self.owner.dispatcher() };
                const id = try std.fmt.allocPrint(allocator, "{d}", .{self.session_id});
                defer allocator.free(id);
                ht.header("x-rvw-session", id);
                ht.body(input);
                try reloadReview(&handler, ht.req, ht.res);
                try ht.expectStatusCode(if (expected_error) |code|
                    if (code == .invalid_revision) .bad_request else errorStatus(code)
                else
                    .ok);
                break :blk try allocator.dupe(u8, ht.res.body);
            },
        };
        defer allocator.free(encoded);
        var parsed = try std.json.parseFromSlice(std.json.Value, allocator, encoded, .{});
        defer parsed.deinit();
        const fields = parsed.value.object;
        if (expected_error) |code| {
            if (self.transport == .native) try std.testing.expect(!fields.get("ok").?.bool);
            try std.testing.expectEqualStrings(@tagName(code), fields.get("error").?.object.get("code").?.string);
            return;
        }
        const data = if (self.transport == .native) fields.get("data").? else parsed.value;
        const next_id: u64 = @intCast(data.object.get("sessionId").?.integer);
        try std.testing.expectEqual(self.session_id + 1, next_id);
        self.session_id = next_id;
    }

    fn addComment(self: *@This()) !void {
        const scoped = try self.owner.dispatcher().dispatchScoped(.{ .create_comment = .{ .body = "discard on success", .target = .review } }, self.session_id);
        defer scoped.deinit();
    }

    fn expectFile(self: *@This(), expected: []const u8) !void {
        const id = blk: {
            const overview = try self.owner.dispatcher().dispatchScoped(.get_diff_overview, self.session_id);
            defer overview.deinit();
            break :blk try std.testing.allocator.dupe(u8, overview.response.diff_overview.id);
        };
        defer std.testing.allocator.free(id);
        const file = try self.owner.dispatcher().dispatchScoped(.{ .get_file_diff = .{ .diff_id = id, .path = "file.txt" } }, self.session_id);
        defer file.deinit();
        try std.testing.expectEqualStrings("base\n", file.response.file_diff.content.diff.oldFile.?.contents);
        try std.testing.expectEqualStrings(expected, file.response.file_diff.content.diff.newFile.?.contents);
    }

    fn expectReview(self: *@This(), source: model.DiffSource, comment_count: usize) !void {
        {
            const overview = try self.owner.dispatcher().dispatchScoped(.get_diff_overview, self.session_id);
            defer overview.deinit();
            try std.testing.expectEqualDeep(source, overview.response.diff_overview.source);
        }
        const comments = try self.owner.dispatcher().dispatchScoped(.get_comments, self.session_id);
        defer comments.deinit();
        try std.testing.expectEqual(comment_count, comments.response.comments.len);
    }
};

test "HTTP and native reload replace every source type and hard reset unchanged snapshots" {
    const allocator = std.testing.allocator;
    const io = std.testing.io;
    const Session = @import("../app/session.zig").Session;
    const Owner = @import("../app/session_owner.zig").SessionOwner;
    var repository = try @import("../testing/repository.zig").Repository.init(allocator);
    defer repository.deinit();
    try repository.write("file.txt", "base\n");
    try repository.commit("base");
    const base = try repository.revision("HEAD");
    defer allocator.free(base);
    try repository.write("file.txt", "head\n");
    try repository.commit("head");
    const head = try repository.revision("HEAD");
    defer allocator.free(head);
    try repository.git(&.{ "remote", "add", "origin", repository.root });
    try repository.git(&.{ "update-ref", "refs/pull/100/head", head });
    try repository.git(&.{ "update-ref", "refs/pull/100/merge", head });
    try repository.write("file.txt", "working\n");
    const index_before = try repository.temporary.dir.readFileAlloc(io, ".git/index", allocator, .unlimited);
    defer allocator.free(index_before);
    const branch_before = try repository.temporary.dir.readFileAlloc(io, ".git/HEAD", allocator, .unlimited);
    defer allocator.free(branch_before);
    const sources = [_]model.DiffSource{
        .{ .working_tree = .{ .base = base } },
        .{ .commit_range = .{ .base = base, .head = head } },
        .{ .pull_request = .{ .number = 100 } },
    };
    for (std.enums.values(@FieldType(ReloadTransportTest, "transport"))) |transport| {
        var owner = Owner.init(io, try Session.create(allocator, io, .{
            .directory = repository.root,
            .configuration = .{ .configuration = .{ .object = .empty }, .diagnostic = null },
            .logger = @import("../log/log.zig").stderrLogger(allocator),
        }));
        defer owner.deinit();
        var client: ReloadTransportTest = .{ .owner = &owner, .transport = transport };
        for (sources) |from| {
            for (sources) |to| {
                try client.reload(from, null);
                try client.addComment();
                try client.reload(to, null);
                try client.expectReview(to, 0);
                try client.addComment();
                try client.reload(null, null);
                try client.expectReview(to, 0);
            }
        }
        // A failed construction retains both the source and its comments.
        try client.addComment();
        try client.reload(.{ .working_tree = .{ .base = "missing-commit" } }, .invalid_revision);
        try client.expectReview(sources[2], 1);
        const malformed = try std.fmt.allocPrint(
            allocator,
            "{{\"type\":\"reload_review\",\"sessionId\":{d},\"source\":{{\"kind\":\"working-tree\",\"base\":\"HEAD\",\"head\":\"fake\"}}}}",
            .{client.session_id},
        );
        defer allocator.free(malformed);
        try client.request(malformed, .malformed_request);
        try client.expectReview(sources[2], 1);
        // Retry the retained PR source; a successful reset still clears comments.
        try client.reload(null, null);
        try client.expectReview(sources[2], 0);
    }
    const index_after = try repository.temporary.dir.readFileAlloc(io, ".git/index", allocator, .unlimited);
    defer allocator.free(index_after);
    try std.testing.expectEqualSlices(u8, index_before, index_after);
    const branch_after = try repository.temporary.dir.readFileAlloc(io, ".git/HEAD", allocator, .unlimited);
    defer allocator.free(branch_after);
    try std.testing.expectEqualSlices(u8, branch_before, branch_after);
    const contents = try repository.temporary.dir.readFileAlloc(io, "file.txt", allocator, .unlimited);
    defer allocator.free(contents);
    try std.testing.expectEqualStrings("working\n", contents);
}

test "HTTP and native ordinary PR reload fetch force pushes and preserve the review on fetch failure" {
    const allocator = std.testing.allocator;
    const io = std.testing.io;
    const Repository = @import("../testing/repository.zig").Repository;
    const Session = @import("../app/session.zig").Session;
    const Owner = @import("../app/session_owner.zig").SessionOwner;
    for (std.enums.values(@FieldType(ReloadTransportTest, "transport"))) |transport| {
        var remote = try Repository.init(allocator);
        defer remote.deinit();
        try remote.write("file.txt", "base\n");
        try remote.commit("base");
        const base = try remote.revision("HEAD");
        defer allocator.free(base);
        try remote.write("file.txt", "first\n");
        try remote.commit("first");
        try remote.git(&.{ "update-ref", "refs/pull/100/head", "HEAD" });
        try remote.git(&.{ "update-ref", "refs/pull/100/merge", "HEAD" });
        var local = try Repository.init(allocator);
        defer local.deinit();
        try local.write("local.txt", "local\n");
        try local.commit("local");
        try local.git(&.{ "remote", "add", "origin", remote.root });
        var owner = Owner.init(io, try Session.create(allocator, io, .{
            .directory = local.root,
            .configuration = .{ .configuration = .{ .object = .empty }, .diagnostic = null },
            .logger = @import("../log/log.zig").stderrLogger(allocator),
        }));
        defer owner.deinit();
        var client: ReloadTransportTest = .{ .owner = &owner, .transport = transport };
        const source: model.DiffSource = .{ .pull_request = .{ .number = 100 } };
        try client.reload(source, null);
        try client.expectFile("first\n");
        try remote.git(&.{ "checkout", "--quiet", "--detach", base });
        try remote.write("file.txt", "rewritten\n");
        try remote.commit("rewritten");
        try remote.git(&.{ "update-ref", "refs/pull/100/head", "HEAD" });
        try remote.git(&.{ "update-ref", "refs/pull/100/merge", "HEAD" });
        try client.addComment();
        try client.reload(null, null);
        try client.expectReview(source, 0);
        try client.expectFile("rewritten\n");
        try client.addComment();
        try local.git(&.{ "remote", "set-url", "origin", "/nonexistent/rvw-test-remote" });
        try client.reload(null, .pull_request_unavailable);
        try client.expectReview(source, 1);
        try client.expectFile("rewritten\n");
        try local.git(&.{ "remote", "set-url", "origin", remote.root });
        try client.reload(null, null);
        try client.expectReview(source, 0);
    }
}
