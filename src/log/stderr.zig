const std = @import("std");
const interface = @import("interface.zig");

const Io = std.Io;

pub fn logger(allocator: std.mem.Allocator) interface.Logger {
    return .{
        .allocator = allocator,
        .context = &context,
        .vtable = &vtable,
    };
}

fn write(_: *anyopaque, io: Io, event: interface.Event) !void {
    const encoded = try interface.encodeEvent(std.heap.page_allocator, io, event);
    defer std.heap.page_allocator.free(encoded);
    try Io.File.stderr().writeStreamingAll(io, encoded);
    try Io.File.stderr().writeStreamingAll(io, "\n");
}

var context: u8 = 0;
const vtable: interface.Logger.VTable = .{ .write = write };
