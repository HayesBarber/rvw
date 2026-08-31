const std = @import("std");
const model = @import("../../../app/model.zig");

pub const Loaded = union(enum) {
    contents: model.FileContents,
    unavailable: model.UnavailableReason,
};

pub fn classify(path: []const u8, contents: []const u8) Loaded {
    if (std.mem.indexOfScalar(u8, contents, 0) != null) return .{ .unavailable = .binary };
    if (!std.unicode.utf8ValidateSlice(contents)) return .{ .unavailable = .invalid_utf8 };
    return .{ .contents = .{ .name = path, .contents = contents } };
}

pub fn unavailable(reason: model.UnavailableReason) model.FileContent {
    return .{ .unavailable = .{ .reason = reason } };
}

pub fn unavailableMode(mode: u32) ?model.UnavailableReason {
    return switch (mode) {
        0, 0o100644, 0o100755 => null,
        0o120000 => .symlink,
        0o160000 => .submodule,
        else => .binary,
    };
}

pub fn lineCount(contents: []const u8) usize {
    if (contents.len == 0) return 0;
    var count = std.mem.count(u8, contents, "\n");
    if (contents[contents.len - 1] != '\n') count += 1;
    return count;
}

test "content classification preserves text and identifies unavailable content" {
    const text = classify("src/main.zig", "const x = 1;\n");
    try std.testing.expectEqualStrings("src/main.zig", text.contents.name);
    try std.testing.expectEqualStrings("const x = 1;\n", text.contents.contents);
    try std.testing.expectEqual(model.UnavailableReason.binary, classify("image", "a\x00b").unavailable);
    try std.testing.expectEqual(model.UnavailableReason.invalid_utf8, classify("bad", "\xff").unavailable);
}

test "file modes and line counts are classified deterministically" {
    try std.testing.expectEqual(@as(?model.UnavailableReason, null), unavailableMode(0o100644));
    try std.testing.expectEqual(model.UnavailableReason.symlink, unavailableMode(0o120000).?);
    try std.testing.expectEqual(model.UnavailableReason.submodule, unavailableMode(0o160000).?);
    try std.testing.expectEqual(model.UnavailableReason.binary, unavailableMode(0o040000).?);
    try std.testing.expectEqual(@as(usize, 0), lineCount(""));
    try std.testing.expectEqual(@as(usize, 1), lineCount("one"));
    try std.testing.expectEqual(@as(usize, 2), lineCount("one\ntwo\n"));
}
