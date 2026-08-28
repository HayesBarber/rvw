pub const clipboard = @import("output/clipboard.zig");
pub const markdown = @import("output/markdown.zig");

pub const Clipboard = clipboard.Clipboard;
pub const SystemClipboard = clipboard.SystemClipboard;
pub const copyToClipboard = clipboard.copy;

test "serialized Markdown can be passed directly to a clipboard" {
    const std = @import("std");
    const model = @import("app/model.zig");

    const comments = [_]model.Comment{.{
        .id = "comment-1",
        .body = "Handle this error.",
        .target = .{ .line = .{
            .path = "src/main.zig",
            .side = .new,
            .startLine = 7,
            .endLine = 7,
        } },
    }};
    const serialized = try markdown.serialize(std.testing.allocator, &comments);
    defer std.testing.allocator.free(serialized);

    const Fake = struct {
        expected: []const u8,
        copied: bool = false,

        fn copy(context: *anyopaque, _: std.Io, text: []const u8) !void {
            const self: *@This() = @ptrCast(@alignCast(context));
            try std.testing.expectEqualStrings(self.expected, text);
            self.copied = true;
        }
    };

    var fake: Fake = .{ .expected = serialized };
    const destination: Clipboard = .{
        .context = &fake,
        .vtable = &.{ .copy = Fake.copy },
    };
    var threaded: std.Io.Threaded = .init(std.testing.allocator, .{ .environ = .empty });
    defer threaded.deinit();

    try destination.copy(threaded.io(), serialized);
    try std.testing.expect(fake.copied);
}
