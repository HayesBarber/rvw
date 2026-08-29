const std = @import("std");
const httpz = @import("httpz");
const dispatcher_module = @import("../app/dispatcher.zig");
const json_protocol = @import("../app/json_protocol.zig");
const model = @import("../app/model.zig");

const Allocator = std.mem.Allocator;

const Handler = struct {
    dispatcher: dispatcher_module.Dispatcher,

    pub fn dispatch(self: *Handler, action: httpz.Action(*Handler), req: *httpz.Request, res: *httpz.Response) !void {
        logRequest(req);
        return action(self, req, res);
    }

    pub fn notFound(self: *Handler, req: *httpz.Request, res: *httpz.Response) !void {
        logRequest(req);
        if (req.method == .GET) {
            return self.failure(res, .not_found, .unknown_file);
        }
        return self.failure(res, .method_not_allowed, .malformed_request);
    }

    pub fn uncaughtError(_: *Handler, req: *httpz.Request, res: *httpz.Response, err: anyerror) void {
        std.log.warn("unexpected HTTP error for {s}: {t}", .{ req.url.raw, err });
        setJsonHeaders(res);
        res.status = @intFromEnum(std.http.Status.internal_server_error);
        res.body = json_protocol.encodeError(res.arena, .internal_error) catch
            "{\"error\":{\"code\":\"internal_error\",\"message\":\"Internal error\"}}";
    }

    fn dispatchRequest(self: *Handler, res: *httpz.Response, request: model.Request) !void {
        const response = self.dispatcher.dispatch(request) catch |err| {
            const code = model.errorCode(err);
            const status: std.http.Status = switch (code) {
                .unknown_diff, .unknown_file => .not_found,
                .malformed_request, .no_comments => .bad_request,
                else => .internal_server_error,
            };
            return self.failure(res, status, code);
        };
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

fn getConfiguration(handler: *Handler, _: *httpz.Request, res: *httpz.Response) !void {
    return handler.dispatchRequest(res, .get_configuration);
}

fn getDiffOverview(handler: *Handler, _: *httpz.Request, res: *httpz.Response) !void {
    return handler.dispatchRequest(res, .get_diff_overview);
}

fn getFiles(handler: *Handler, _: *httpz.Request, res: *httpz.Response) !void {
    return handler.dispatchRequest(res, .get_files);
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

fn createLog(handler: *Handler, req: *httpz.Request, res: *httpz.Response) !void {
    const body = req.body() orelse
        return handler.failure(res, .bad_request, .malformed_request);
    var parsed = std.json.parseFromSlice(std.json.Value, res.arena, body, .{}) catch
        return handler.failure(res, .bad_request, .malformed_request);
    defer parsed.deinit();
    const request = json_protocol.decodeRequestValue(parsed.value) catch
        return handler.failure(res, .bad_request, .malformed_request);
    switch (request) {
        .log => return handler.dispatchRequest(res, request),
        else => return handler.failure(res, .bad_request, .malformed_request),
    }
}

pub fn serve(allocator: Allocator, io: std.Io, dispatcher: dispatcher_module.Dispatcher, address: std.Io.net.IpAddress) !void {
    var handler: Handler = .{ .dispatcher = dispatcher };
    var server = try httpz.Server(*Handler).init(io, allocator, .{ .address = .{ .ip = address } }, &handler);
    defer server.deinit();
    defer server.stop();

    const router = try server.router(.{});
    router.get("/api/configuration", getConfiguration, .{});
    router.get("/api/diffs/active", getDiffOverview, .{});
    router.get("/api/diffs/:diff_id/files", getFileDiff, .{});
    router.get("/api/files", getFiles, .{});
    router.get("/api/files/content", getFile, .{});
    router.get("/api/comments", getComments, .{});
    router.post("/api/comments", createComment, .{});
    router.post("/api/comments/copy-markdown", copyCommentsAsMarkdown, .{});
    router.post("/api/logs", createLog, .{});

    std.log.info("rvw listening on http://{f}", .{address});
    try server.listen();
}

fn logRequest(req: *const httpz.Request) void {
    std.log.info("{t} {s}", .{ req.method, req.url.raw });
}

fn setJsonHeaders(res: *httpz.Response) void {
    res.header("content-type", "application/json; charset=utf-8");
    res.header("cache-control", "no-store");
}
