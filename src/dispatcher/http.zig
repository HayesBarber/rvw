const std = @import("std");
const dispatcher_module = @import("dispatcher.zig");
const json_protocol = @import("../app/json_protocol.zig");
const model = @import("../app/model.zig");

const Allocator = std.mem.Allocator;

pub const Response = struct {
    status: std.http.Status,
    body: []u8,

    pub fn deinit(self: Response, allocator: Allocator) void {
        allocator.free(self.body);
    }
};

pub const Adapter = struct {
    allocator: Allocator,
    dispatcher: dispatcher_module.Dispatcher,

    pub fn route(self: Adapter, method: std.http.Method, target: []const u8) !Response {
        return switch (method) {
            .GET => switch (parseRoute(target)) {
                .review_overview => self.dispatch(.get_review_overview),
                .file_review => |file| self.routeFileReview(file),
                .malformed => self.failure(.bad_request, .malformed_request),
                .not_found => self.failure(.not_found, .unknown_file),
            },
            else => self.failure(.method_not_allowed, .malformed_request),
        };
    }

    fn routeFileReview(self: Adapter, file: Route.FileReview) !Response {
        const review_id = percentDecode(self.allocator, file.encoded_review_id) catch
            return self.failure(.bad_request, .malformed_request);
        defer self.allocator.free(review_id);
        const path = percentDecode(self.allocator, file.encoded_path) catch
            return self.failure(.bad_request, .malformed_request);
        defer self.allocator.free(path);

        return self.dispatch(.{ .get_file_review = .{ .review_id = review_id, .path = path } });
    }

    fn dispatch(self: Adapter, request: model.Request) !Response {
        const response = self.dispatcher.dispatch(request) catch |err| {
            const code = model.errorCode(err);
            const status: std.http.Status = switch (code) {
                .unknown_review, .unknown_file => .not_found,
                .shutting_down => .service_unavailable,
                else => .internal_server_error,
            };
            return self.failure(status, code);
        };
        return .{ .status = .ok, .body = try json_protocol.encodeResponse(self.allocator, response) };
    }

    fn failure(self: Adapter, status: std.http.Status, code: model.ErrorCode) !Response {
        return .{ .status = status, .body = try json_protocol.encodeError(self.allocator, code) };
    }
};

const Route = union(enum) {
    review_overview,
    file_review: FileReview,
    malformed,
    not_found,

    const FileReview = struct {
        encoded_review_id: []const u8,
        encoded_path: []const u8,
    };
};

fn parseRoute(target: []const u8) Route {
    if (std.mem.eql(u8, target, "/api/reviews/active")) return .review_overview;

    const prefix = "/api/reviews/";
    if (!std.mem.startsWith(u8, target, prefix)) return .not_found;
    const rest = target[prefix.len..];
    const marker = "/files?";
    const marker_index = std.mem.indexOf(u8, rest, marker) orelse return .not_found;
    const query = rest[marker_index + marker.len ..];
    if (!std.mem.startsWith(u8, query, "path=") or query.len == "path=".len) return .malformed;

    return .{ .file_review = .{
        .encoded_review_id = rest[0..marker_index],
        .encoded_path = query["path=".len..],
    } };
}

pub fn serve(allocator: Allocator, io: std.Io, dispatcher: dispatcher_module.Dispatcher, address: std.Io.net.IpAddress) !void {
    var listener = try address.listen(io, .{ .reuse_address = true });
    defer listener.deinit(io);
    var connections: std.Io.Group = .init;
    defer connections.cancel(io);

    std.log.info("rvw listening on http://{f}", .{address});
    while (true) {
        const stream = try listener.accept(io);
        connections.async(io, serveConnection, .{ allocator, io, dispatcher, stream });
    }
}

fn serveConnection(allocator: Allocator, io: std.Io, dispatcher: dispatcher_module.Dispatcher, stream: std.Io.net.Stream) void {
    defer stream.close(io);
    var recv_buffer: [16 * 1024]u8 = undefined;
    var send_buffer: [16 * 1024]u8 = undefined;
    var reader = stream.reader(io, &recv_buffer);
    var writer = stream.writer(io, &send_buffer);
    var server = std.http.Server.init(&reader.interface, &writer.interface);
    const adapter: Adapter = .{ .allocator = allocator, .dispatcher = dispatcher };

    while (server.reader.state == .ready) {
        var request = server.receiveHead() catch |err| switch (err) {
            error.HttpConnectionClosing => return,
            else => {
                std.log.warn("invalid HTTP connection: {t}", .{err});
                return;
            },
        };
        std.log.info("{t} {s}", .{ request.head.method, request.head.target });
        const response = adapter.route(request.head.method, request.head.target) catch {
            request.respond("{\"error\":{\"code\":\"internal_error\",\"message\":\"Internal error\"}}", .{
                .status = .internal_server_error,
                .extra_headers = json_headers,
            }) catch {};
            return;
        };
        defer response.deinit(allocator);
        request.respond(response.body, .{
            .status = response.status,
            .extra_headers = json_headers,
        }) catch return;
    }
}

const json_headers = &[_]std.http.Header{
    .{ .name = "content-type", .value = "application/json; charset=utf-8" },
    .{ .name = "cache-control", .value = "no-store" },
};

/// Decodes percent escapes in URI components such as `a%20b.zig`. The router
/// uses it for the review id path segment and the `path` query value.
fn percentDecode(allocator: Allocator, encoded: []const u8) ![]u8 {
    const result = try allocator.alloc(u8, encoded.len);
    errdefer allocator.free(result);
    var source: usize = 0;
    var dest: usize = 0;
    while (source < encoded.len) {
        if (encoded[source] == '%') {
            if (source + 2 >= encoded.len) return error.InvalidEncoding;
            result[dest] = std.fmt.parseInt(u8, encoded[source + 1 .. source + 3], 16) catch
                return error.InvalidEncoding;
            source += 3;
        } else {
            result[dest] = encoded[source];
            source += 1;
        }
        dest += 1;
    }
    return allocator.realloc(result, dest);
}

test "HTTP adapter translates routes through an injected dispatcher" {
    const Fake = struct {
        fn dispatch(_: *anyopaque, request: model.Request) !model.Response {
            return switch (request) {
                .get_review_overview => .{ .review_overview = .{
                    .review = .{ .id = "test", .repository = .{ .name = "fake" }, .source = .{ .kind = "working-tree", .base = "HEAD" } },
                    .initialPath = "a b.zig",
                    .files = &.{},
                    .comments = &.{},
                } },
                .get_file_review => |details| if (std.mem.eql(u8, details.path, "a b.zig"))
                    .{ .file_review = .{
                        .path = details.path,
                        .status = .unchanged,
                        .content = .{ .file = .{ .file = .{ .name = details.path, .contents = "" } } },
                    } }
                else
                    error.UnknownFile,
            };
        }
    };
    var context: u8 = 0;
    const adapter: Adapter = .{
        .allocator = std.testing.allocator,
        .dispatcher = .{ .context = &context, .dispatchFn = Fake.dispatch },
    };

    const overview = try adapter.route(.GET, "/api/reviews/active");
    defer overview.deinit(std.testing.allocator);
    try std.testing.expectEqual(std.http.Status.ok, overview.status);
    try std.testing.expect(std.mem.indexOf(u8, overview.body, "\"name\":\"fake\"") != null);

    const file = try adapter.route(.GET, "/api/reviews/test/files?path=a%20b.zig");
    defer file.deinit(std.testing.allocator);
    try std.testing.expectEqual(std.http.Status.ok, file.status);
    try std.testing.expect(std.mem.indexOf(u8, file.body, "\"path\":\"a b.zig\"") != null);

    const bad_method = try adapter.route(.POST, "/api/reviews/active");
    defer bad_method.deinit(std.testing.allocator);
    try std.testing.expectEqual(std.http.Status.method_not_allowed, bad_method.status);

    const malformed = try adapter.route(.GET, "/api/reviews/test/files?path=%GG");
    defer malformed.deinit(std.testing.allocator);
    try std.testing.expectEqual(std.http.Status.bad_request, malformed.status);

    const missing = try adapter.route(.GET, "/api/reviews/test/files?path=missing");
    defer missing.deinit(std.testing.allocator);
    try std.testing.expectEqual(std.http.Status.not_found, missing.status);
}
