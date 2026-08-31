const std = @import("std");
const process = @import("process.zig");
const limits = @import("limits.zig");

const Allocator = std.mem.Allocator;
const Io = std.Io;

pub const Snapshot = struct {
    base: []const u8,
    head: ?[]const u8 = null,
};

const Range = struct {
    base: []const u8,
    head: []const u8,
};

pub fn resolve(allocator: Allocator, io: Io, root: []const u8, range: ?[]const u8) !Snapshot {
    if (range) |value| {
        const revisions = try parseRange(value);
        return .{
            .base = try resolveCommit(allocator, io, root, revisions.base),
            .head = try resolveCommit(allocator, io, root, revisions.head),
        };
    }
    return .{ .base = try resolveCommit(allocator, io, root, "HEAD") };
}

fn parseRange(value: []const u8) !Range {
    const separator = std.mem.indexOf(u8, value, "..") orelse return error.InvalidRange;
    if (separator == 0 or separator + 2 == value.len) return error.InvalidRange;
    if (std.mem.indexOf(u8, value[separator + 2 ..], "..") != null) return error.InvalidRange;
    if (value[separator + 2] == '.') return error.InvalidRange;
    return .{ .base = value[0..separator], .head = value[separator + 2 ..] };
}

fn resolveCommit(allocator: Allocator, io: Io, root: []const u8, revision: []const u8) ![]const u8 {
    const commit = try std.fmt.allocPrint(allocator, "{s}^{{commit}}", .{revision});
    const output = process.run(
        allocator,
        io,
        &.{ "git", "-C", root, "rev-parse", "--verify", "--end-of-options", commit },
        limits.maximum_revision_size,
    ) catch |err| switch (err) {
        error.GitCommandFailed, error.GitOutputTooLarge => return error.InvalidRevision,
        else => return err,
    };
    const oid = std.mem.trim(u8, output, " \t\r\n");
    if (oid.len == 0 or !std.unicode.utf8ValidateSlice(oid)) return error.InvalidRevision;
    return oid;
}

test "range parser accepts exactly two non-empty revisions" {
    const range = try parseRange("main..feature");
    try std.testing.expectEqualStrings("main", range.base);
    try std.testing.expectEqualStrings("feature", range.head);

    const invalid = [_][]const u8{ "", "main", "..head", "base..", "base...head", "a..b..c" };
    for (invalid) |value| try std.testing.expectError(error.InvalidRange, parseRange(value));
}
