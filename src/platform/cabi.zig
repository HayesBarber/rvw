const std = @import("std");
const rvw = @import("rvw");

const allocator = std.heap.page_allocator;

const RvwCore = struct {
    threaded: std.Io.Threaded,
    fixture: rvw.fixture_provider.FixtureProvider,
    core: rvw.core.Core,
};

pub const RvwBuffer = extern struct {
    ptr: [*c]u8,
    len: usize,
};

pub export fn rvw_core_create() callconv(.c) ?*RvwCore {
    const handle = allocator.create(RvwCore) catch return null;
    handle.threaded = .init(allocator, .{});
    handle.fixture = .{};
    handle.core = rvw.core.Core.init(allocator, handle.threaded.io(), handle.fixture.interface());
    handle.core.start() catch {
        handle.threaded.deinit();
        allocator.destroy(handle);
        return null;
    };
    return handle;
}

pub export fn rvw_core_dispatch(
    handle: ?*RvwCore,
    request_ptr: [*c]const u8,
    request_len: usize,
) callconv(.c) RvwBuffer {
    const core = handle orelse return emptyBuffer();
    if (request_ptr == null and request_len != 0) return emptyBuffer();
    const request = request_ptr[0..request_len];
    const response = rvw.json_protocol.dispatchJson(allocator, core.core.dispatcher(), request) catch
        return emptyBuffer();
    return .{ .ptr = response.ptr, .len = response.len };
}

pub export fn rvw_buffer_free(_: ?*RvwCore, buffer: RvwBuffer) callconv(.c) void {
    if (buffer.ptr == null or buffer.len == 0) return;
    // The C ABI carries pointer and length separately. Zig allocators free the
    // slice returned by alloc, so reconstruct that same slice here.
    allocator.free(buffer.ptr[0..buffer.len]);
}

pub export fn rvw_core_destroy(handle: ?*RvwCore) callconv(.c) void {
    const core = handle orelse return;
    core.core.deinit();
    core.threaded.deinit();
    allocator.destroy(core);
}

fn emptyBuffer() RvwBuffer {
    return .{ .ptr = null, .len = 0 };
}

test "C ABI dispatches JSON and owns response buffers" {
    const handle = rvw_core_create() orelse return error.OutOfMemory;
    defer rvw_core_destroy(handle);

    const request = "{\"type\":\"get_review_overview\"}";
    const response = rvw_core_dispatch(handle, request.ptr, request.len);
    defer rvw_buffer_free(handle, response);
    try std.testing.expect(response.ptr != null);
    try std.testing.expect(std.mem.indexOf(u8, response.ptr[0..response.len], "\"ok\":true") != null);
    try std.testing.expect(std.mem.indexOf(u8, response.ptr[0..response.len], "\"repository\":{\"name\":\"rvw\"}") != null);

    const malformed_request = "nope";
    const malformed = rvw_core_dispatch(handle, malformed_request.ptr, malformed_request.len);
    defer rvw_buffer_free(handle, malformed);
    try std.testing.expect(std.mem.indexOf(u8, malformed.ptr[0..malformed.len], "malformed_request") != null);

    const unknown_request = "{\"type\":\"unknown\"}";
    const unknown = rvw_core_dispatch(handle, unknown_request.ptr, unknown_request.len);
    defer rvw_buffer_free(handle, unknown);
    try std.testing.expect(std.mem.indexOf(u8, unknown.ptr[0..unknown.len], "unknown_operation") != null);
}
