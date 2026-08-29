const std = @import("std");
const model = @import("../app/model.zig");

const Allocator = std.mem.Allocator;

/// Serializes review comments as a deterministic Markdown list.
///
/// The caller owns the returned memory. The input slice and the strings it
/// references are never modified.
pub fn serialize(allocator: Allocator, comments: []const model.Comment) ![]u8 {
    const sorted = try allocator.dupe(model.Comment, comments);
    defer allocator.free(sorted);
    std.mem.sort(model.Comment, sorted, {}, commentLessThan);

    var output: std.Io.Writer.Allocating = .init(allocator);
    defer output.deinit();

    for (sorted) |comment| {
        const writer = &output.writer;
        try writer.writeAll("- ");
        switch (comment.target) {
            .file => |target| try writer.writeAll(target.path),
            .line => |target| {
                try writer.print("{s}:{d}", .{ target.path, target.startLine });
                if (target.endLine != target.startLine) {
                    try writer.print("-{d}", .{target.endLine});
                }
            },
        }
        try writer.writeAll(" - ");
        try writeCommentBody(writer, comment.body);
        try writer.writeByte('\n');
    }

    return output.toOwnedSlice();
}

fn writeCommentBody(writer: *std.Io.Writer, body: []const u8) !void {
    var remaining = body;
    while (std.mem.indexOfScalar(u8, remaining, '\n')) |newline| {
        try writer.writeAll(remaining[0 .. newline + 1]);
        try writer.writeAll("  ");
        remaining = remaining[newline + 1 ..];
    }
    try writer.writeAll(remaining);
}

fn commentLessThan(_: void, lhs: model.Comment, rhs: model.Comment) bool {
    const path_order = std.mem.order(u8, targetPath(lhs.target), targetPath(rhs.target));
    if (path_order != .eq) return path_order == .lt;

    const target_order = compareTargets(lhs.target, rhs.target);
    if (target_order != .eq) return target_order == .lt;

    const body_order = std.mem.order(u8, lhs.body, rhs.body);
    if (body_order != .eq) return body_order == .lt;
    return std.mem.order(u8, lhs.id, rhs.id) == .lt;
}

fn targetPath(target: model.CommentTarget) []const u8 {
    return switch (target) {
        .file => |details| details.path,
        .line => |details| details.path,
    };
}

fn compareTargets(lhs: model.CommentTarget, rhs: model.CommentTarget) std.math.Order {
    return switch (lhs) {
        .file => switch (rhs) {
            .file => .eq,
            .line => .lt,
        },
        .line => |left| switch (rhs) {
            .file => .gt,
            .line => |right| blk: {
                if (left.startLine != right.startLine) {
                    break :blk if (left.startLine < right.startLine) .lt else .gt;
                }
                if (left.endLine != right.endLine) {
                    break :blk if (left.endLine < right.endLine) .lt else .gt;
                }
                const left_side: u1 = @intFromEnum(left.side);
                const right_side: u1 = @intFromEnum(right.side);
                if (left_side != right_side) {
                    break :blk if (left_side < right_side) .lt else .gt;
                }
                break :blk .eq;
            },
        },
    };
}
