const std = @import("std");
const model = @import("../app/model.zig");

const Allocator = std.mem.Allocator;

/// Serializes review comments as a deterministic Markdown list.
///
/// The caller owns the returned memory. The input slice and the strings it
/// references are never modified.
pub fn serialize(allocator: Allocator, comments: []const model.Comment, intro: []const u8, outro: []const u8, repository_name: []const u8, source_label: []const u8) ![]u8 {
    const sorted = try allocator.dupe(model.Comment, comments);
    defer allocator.free(sorted);
    std.mem.sort(model.Comment, sorted, {}, commentLessThan);

    var output: std.Io.Writer.Allocating = .init(allocator);
    defer output.deinit();
    const writer = &output.writer;
    const intro_text = std.mem.trim(u8, intro, "\r\n");
    const outro_text = std.mem.trim(u8, outro, "\r\n");

    if (intro_text.len > 0) {
        try writer.writeAll(intro_text);
        try writer.writeAll("\n\n");
    }

    if (source_label.len > 0) {
        try writer.print("{s}: {s}\n\n", .{ repository_name, source_label });
    }

    const has_review_comments = sorted.len > 0 and sorted[0].target == .review;
    if (has_review_comments) try writer.writeAll("Review comments:\n\n");
    var wrote_location_heading = false;
    for (sorted) |comment| {
        if (has_review_comments and comment.target != .review and !wrote_location_heading) {
            try writer.writeAll("\nFile and line comments:\n\n");
            wrote_location_heading = true;
        }
        try writer.writeAll("- ");
        switch (comment.target) {
            .review => {},
            .file => |target| try writer.writeAll(target.path),
            .line => |target| {
                try writer.print("{s}:{d}", .{ target.path, target.startLine });
                if (target.endLine != target.startLine) {
                    try writer.print("-{d}", .{target.endLine});
                }
            },
        }
        if (comment.target != .review) try writer.writeAll(" - ");
        if (comment.commentType) |comment_type| {
            try writer.writeByte('[');
            try writeCommentType(writer, comment_type);
            try writer.writeAll("] ");
        }
        try writeCommentBody(writer, comment.body);
        try writer.writeByte('\n');
    }

    if (outro_text.len > 0) {
        try writer.writeByte('\n');
        try writer.writeAll(outro_text);
        try writer.writeByte('\n');
    }

    return output.toOwnedSlice();
}

fn writeCommentType(writer: *std.Io.Writer, comment_type: []const u8) !void {
    for (comment_type) |character| {
        if (character == '\\' or character == '[' or character == ']') try writer.writeByte('\\');
        try writer.writeByte(character);
    }
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
        .review => "",
        .file => |details| details.path,
        .line => |details| details.path,
    };
}

fn compareTargets(lhs: model.CommentTarget, rhs: model.CommentTarget) std.math.Order {
    return switch (lhs) {
        .review => if (rhs == .review) .eq else .lt,
        .file => switch (rhs) {
            .review => .gt,
            .file => .eq,
            .line => .lt,
        },
        .line => |left| switch (rhs) {
            .review => .gt,
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

test "typed and untyped comments retain location and body formatting" {
    const comments = [_]model.Comment{
        .{ .id = "1", .body = "Handle expiry", .commentType = "ISSUE", .target = .{ .line = .{
            .path = "src/auth.zig",
            .side = .new,
            .startLine = 42,
            .endLine = 42,
        } } },
        .{ .id = "2", .body = "Plain", .target = .{ .file = .{ .path = "README.md" } } },
        .{ .id = "3", .body = "Safe", .commentType = "A[B]\\C", .target = .{ .line = .{
            .path = "src/auth.zig",
            .side = .new,
            .startLine = 58,
            .endLine = 61,
        } } },
    };
    const markdown = try serialize(std.testing.allocator, &comments, "", "", "", "");
    defer std.testing.allocator.free(markdown);
    try std.testing.expectEqualStrings(
        "- README.md - Plain\n- src/auth.zig:42 - [ISSUE] Handle expiry\n- src/auth.zig:58-61 - [A\\[B\\]\\\\C] Safe\n",
        markdown,
    );
}

test "intro and outro surround sorted comments with one blank line" {
    const comments = [_]model.Comment{
        .{ .id = "2", .body = "Second", .target = .{ .file = .{ .path = "b.txt" } } },
        .{ .id = "1", .body = "First", .target = .{ .file = .{ .path = "a.txt" } } },
    };
    const cases = [_]struct { intro: []const u8, outro: []const u8, expected: []const u8 }{
        .{ .intro = "", .outro = "", .expected = "- a.txt - First\n- b.txt - Second\n" },
        .{ .intro = "Intro", .outro = "", .expected = "Intro\n\n- a.txt - First\n- b.txt - Second\n" },
        .{ .intro = "", .outro = "Outro", .expected = "- a.txt - First\n- b.txt - Second\n\nOutro\n" },
        .{ .intro = "First line\nSecond line\n", .outro = "\nLast line\nDone", .expected = "First line\nSecond line\n\n- a.txt - First\n- b.txt - Second\n\nLast line\nDone\n" },
    };
    for (cases) |case| {
        const markdown = try serialize(std.testing.allocator, &comments, case.intro, case.outro, "", "");
        defer std.testing.allocator.free(markdown);
        try std.testing.expectEqualStrings(case.expected, markdown);
    }
}

test "review header follows intro and precedes sorted comments" {
    const comments = [_]model.Comment{
        .{ .id = "2", .body = "Second", .target = .{ .file = .{ .path = "b.txt" } } },
        .{ .id = "1", .body = "First", .target = .{ .file = .{ .path = "a.txt" } } },
    };
    const markdown = try serialize(std.testing.allocator, &comments, "Intro", "Outro", "rvw", "PR #100");
    defer std.testing.allocator.free(markdown);
    try std.testing.expectEqualStrings(
        "Intro\n\nrvw: PR #100\n\n- a.txt - First\n- b.txt - Second\n\nOutro\n",
        markdown,
    );
}

test "review comments precede mixed locations and retain configured text and types" {
    const comments = [_]model.Comment{
        .{ .id = "line", .body = "Line note", .target = .{ .line = .{ .path = "a.txt", .side = .old, .startLine = 2, .endLine = 4 } } },
        .{ .id = "review-2", .body = "Summary\nNext step", .target = .review },
        .{ .id = "file", .body = "File note", .target = .{ .file = .{ .path = "a.txt" } } },
        .{ .id = "review-1", .body = "Design question", .commentType = "CUSTOM", .target = .review },
    };
    const markdown = try serialize(std.testing.allocator, &comments, "Intro", "Outro", "rvw", "PR #233");
    defer std.testing.allocator.free(markdown);
    try std.testing.expectEqualStrings(
        "Intro\n\nrvw: PR #233\n\nReview comments:\n\n- [CUSTOM] Design question\n- Summary\n  Next step\n\nFile and line comments:\n\n- a.txt - File note\n- a.txt:2-4 - Line note\n\nOutro\n",
        markdown,
    );
}

test "review-only Markdown has no location references or empty location section" {
    const comments = [_]model.Comment{
        .{ .id = "1", .body = "Summary", .target = .review },
        .{ .id = "2", .body = "Question", .commentType = "QUESTION", .target = .review },
    };
    const markdown = try serialize(std.testing.allocator, &comments, "", "", "", "");
    defer std.testing.allocator.free(markdown);
    try std.testing.expectEqualStrings("Review comments:\n\n- [QUESTION] Question\n- Summary\n", markdown);
}
