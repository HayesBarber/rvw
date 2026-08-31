const std = @import("std");
const model = @import("../../../app/model.zig");
const snapshot_module = @import("snapshot.zig");
const metadata = @import("metadata.zig");
const process = @import("process.zig");
const limits = @import("limits.zig");
const content = @import("content.zig");

const Allocator = std.mem.Allocator;
const Io = std.Io;

pub fn buildContent(
    allocator: Allocator,
    io: Io,
    root: []const u8,
    snapshot: snapshot_module.Snapshot,
    change: metadata.Change,
) !model.FileContent {
    if (change.unavailable) |reason| return content.unavailable(reason);

    const old: ?content.Loaded = if (change.status == .added)
        null
    else
        try loadCommitted(allocator, io, root, snapshot.base, change.previous_path orelse change.path);
    const new: ?content.Loaded = if (change.status == .deleted)
        null
    else if (snapshot.head) |head|
        try loadCommitted(allocator, io, root, head, change.path)
    else
        try loadWorkingTree(allocator, io, root, change.path);

    if (old) |loaded| switch (loaded) {
        .unavailable => |reason| return content.unavailable(reason),
        .contents => {},
    };
    if (new) |loaded| switch (loaded) {
        .unavailable => |reason| return content.unavailable(reason),
        .contents => {},
    };

    return .{ .diff = .{
        .oldFile = if (old) |loaded| loaded.contents else null,
        .newFile = if (new) |loaded| loaded.contents else null,
    } };
}

fn loadCommitted(
    allocator: Allocator,
    io: Io,
    root: []const u8,
    commit: []const u8,
    path: []const u8,
) !content.Loaded {
    const object = try std.fmt.allocPrint(allocator, "{s}:{s}", .{ commit, path });
    const contents = process.run(
        allocator,
        io,
        &.{ "git", "-C", root, "show", "--no-textconv", object },
        limits.maximum_text_size + 1,
    ) catch |err| switch (err) {
        error.GitOutputTooLarge => return .{ .unavailable = .too_large },
        else => return err,
    };
    return content.classify(path, contents);
}

fn loadWorkingTree(
    allocator: Allocator,
    io: Io,
    root: []const u8,
    path: []const u8,
) !content.Loaded {
    var directory = try std.Io.Dir.openDirAbsolute(io, root, .{});
    defer directory.close(io);
    const contents = directory.readFileAlloc(
        io,
        path,
        allocator,
        .limited(limits.maximum_text_size + 1),
    ) catch |err| switch (err) {
        error.StreamTooLong => return .{ .unavailable = .too_large },
        else => return err,
    };
    return content.classify(path, contents);
}
