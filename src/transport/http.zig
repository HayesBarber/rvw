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
                .unknown_review, .unknown_file => .not_found,
                .shutting_down => .service_unavailable,
                else => .internal_server_error,
            };
            return self.failure(res, status, code);
        };
        setJsonHeaders(res);
        res.body = try json_protocol.encodeResponse(res.arena, response);
    }

    fn failure(_: *Handler, res: *httpz.Response, status: std.http.Status, code: model.ErrorCode) !void {
        setJsonHeaders(res);
        res.status = @intFromEnum(status);
        res.body = try json_protocol.encodeError(res.arena, code);
    }
};

fn getReviewOverview(handler: *Handler, _: *httpz.Request, res: *httpz.Response) !void {
    return handler.dispatchRequest(res, .get_review_overview);
}

fn getFileReview(handler: *Handler, req: *httpz.Request, res: *httpz.Response) !void {
    const encoded_review_id = req.param("review_id") orelse
        return handler.failure(res, .bad_request, .malformed_request);
    const review_id = (httpz.Url.unescape(res.arena, &.{}, encoded_review_id) catch
        return handler.failure(res, .bad_request, .malformed_request)).value;
    const query = req.query() catch
        return handler.failure(res, .bad_request, .malformed_request);
    const path = query.get("path") orelse
        return handler.failure(res, .bad_request, .malformed_request);
    if (path.len == 0) return handler.failure(res, .bad_request, .malformed_request);

    return handler.dispatchRequest(res, .{ .get_file_review = .{
        .review_id = review_id,
        .path = path,
    } });
}

pub fn serve(allocator: Allocator, io: std.Io, dispatcher: dispatcher_module.Dispatcher, address: std.Io.net.IpAddress) !void {
    var handler: Handler = .{ .dispatcher = dispatcher };
    var server = try httpz.Server(*Handler).init(io, allocator, .{ .address = .{ .ip = address } }, &handler);
    defer server.deinit();
    defer server.stop();

    const router = try server.router(.{});
    router.get("/api/reviews/active", getReviewOverview, .{});
    router.get("/api/reviews/:review_id/files", getFileReview, .{});

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
