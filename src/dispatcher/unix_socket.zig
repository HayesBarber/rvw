const std = @import("std");
const dispatcher_module = @import("../app/dispatcher.zig");
const json_protocol = @import("../app/json_protocol.zig");

const Allocator = std.mem.Allocator;
const frame_header_size = @sizeOf(u32);

pub const max_request_size: u32 = 1024 * 1024;

pub fn serve(
    allocator: Allocator,
    io: std.Io,
    dispatcher: dispatcher_module.Dispatcher,
    address: std.Io.net.UnixAddress,
) !void {
    var listener = try address.listen(io, .{});
    defer listener.deinit(io);
    var connections: std.Io.Group = .init;
    defer connections.cancel(io);

    std.log.info("rvw listening on Unix socket {s}", .{address.path});
    while (true) {
        const stream = try listener.accept(io);
        connections.async(io, serveConnection, .{ allocator, io, dispatcher, stream });
    }
}

fn serveConnection(
    allocator: Allocator,
    io: std.Io,
    dispatcher: dispatcher_module.Dispatcher,
    stream: std.Io.net.Stream,
) void {
    defer stream.close(io);
    var recv_buffer: [frame_header_size]u8 = undefined;
    var send_buffer: [frame_header_size]u8 = undefined;
    var reader = stream.reader(io, &recv_buffer);
    var writer = stream.writer(io, &send_buffer);

    dispatchFrame(allocator, dispatcher, &reader.interface, &writer.interface) catch |err| {
        std.log.warn("Unix socket connection failed: {t}", .{err});
    };
}

fn dispatchFrame(
    allocator: Allocator,
    dispatcher: dispatcher_module.Dispatcher,
    reader: *std.Io.Reader,
    writer: *std.Io.Writer,
) !void {
    const request_len = try reader.takeInt(u32, .big);
    if (request_len > max_request_size) return error.RequestTooLarge;

    const request = try allocator.alloc(u8, request_len);
    defer allocator.free(request);
    try reader.readSliceAll(request);

    const response = try json_protocol.dispatchJson(allocator, dispatcher, request);
    defer allocator.free(response);

    try writer.writeInt(u32, @intCast(response.len), .big);
    try writer.writeAll(response);
    try writer.flush();
}
