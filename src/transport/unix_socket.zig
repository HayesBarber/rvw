const std = @import("std");
const dispatcher_module = @import("../app/dispatcher.zig");
const json_protocol = @import("../app/json_protocol.zig");

const Allocator = std.mem.Allocator;
const frame_header_size = @sizeOf(u32);
const lock_file_suffix = ".lock";

pub const max_request_size: u32 = 1024 * 1024;

pub fn serve(
    allocator: Allocator,
    io: std.Io,
    dispatcher: dispatcher_module.Dispatcher,
    address: std.Io.net.UnixAddress,
) !void {
    if (address.isAbstract()) return error.AbstractSocketUnsupported;

    const lock_path = try std.mem.concat(allocator, u8, &.{ address.path, lock_file_suffix });
    defer allocator.free(lock_path);
    var lock_file = try acquireLock(io, .cwd(), lock_path);
    defer lock_file.close(io);

    try removeStaleSocket(io, .cwd(), address.path);
    var listener = try address.listen(io, .{});
    defer {
        listener.deinit(io);
        removeStaleSocket(io, .cwd(), address.path) catch |err| {
            std.log.warn("failed to remove Unix socket {s}: {t}", .{ address.path, err });
        };
    }
    var connections: std.Io.Group = .init;
    defer connections.cancel(io);

    std.log.info("rvw listening on Unix socket {s}", .{address.path});
    while (true) {
        const stream = try listener.accept(io);
        connections.async(io, serveConnection, .{ allocator, io, dispatcher, stream });
    }
}

fn acquireLock(io: std.Io, dir: std.Io.Dir, path: []const u8) !std.Io.File {
    return dir.createFile(io, path, .{
        .truncate = false,
        .lock = .exclusive,
        .lock_nonblocking = true,
    }) catch |err| switch (err) {
        error.WouldBlock => error.AlreadyRunning,
        else => err,
    };
}

fn removeStaleSocket(io: std.Io, dir: std.Io.Dir, path: []const u8) !void {
    const stat = dir.statFile(io, path, .{ .follow_symlinks = false }) catch |err| switch (err) {
        error.FileNotFound => return,
        else => return err,
    };
    if (stat.kind == .unix_domain_socket) try dir.deleteFile(io, path);
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

test "lock file prevents a second Unix socket server and is released on close" {
    const io = std.testing.io;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();

    {
        var first = try acquireLock(io, tmp.dir, "rvw.sock.lock");
        defer first.close(io);
        try std.testing.expectError(
            error.AlreadyRunning,
            acquireLock(io, tmp.dir, "rvw.sock.lock"),
        );
    }

    var reacquired = try acquireLock(io, tmp.dir, "rvw.sock.lock");
    reacquired.close(io);
    const stat = try tmp.dir.statFile(io, "rvw.sock.lock", .{});
    try std.testing.expectEqual(std.Io.File.Kind.file, stat.kind);
}

test "stale Unix socket is removed and can be rebound" {
    const io = std.testing.io;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();

    var directory_path_buffer: [std.fs.max_path_bytes]u8 = undefined;
    const directory_path_len = try tmp.dir.realPath(io, &directory_path_buffer);
    const socket_path = try std.fmt.allocPrint(
        std.testing.allocator,
        "{s}/rvw.sock",
        .{directory_path_buffer[0..directory_path_len]},
    );
    defer std.testing.allocator.free(socket_path);
    const address = try std.Io.net.UnixAddress.init(socket_path);

    var first = try address.listen(io, .{});
    first.deinit(io);
    try removeStaleSocket(io, .cwd(), socket_path);

    var rebound = try address.listen(io, .{});
    rebound.deinit(io);
    try removeStaleSocket(io, .cwd(), socket_path);
}

test "stale socket cleanup preserves non-socket files" {
    const io = std.testing.io;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();

    var file = try tmp.dir.createFile(io, "rvw.sock", .{});
    file.close(io);
    try removeStaleSocket(io, tmp.dir, "rvw.sock");

    const stat = try tmp.dir.statFile(io, "rvw.sock", .{});
    try std.testing.expectEqual(std.Io.File.Kind.file, stat.kind);
}
