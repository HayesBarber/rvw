const std = @import("std");
const model = @import("../../app/model.zig");
const TextSearchProvider = @import("interface.zig").TextSearchProvider;

/// No filesystem access or external executable is required.
pub const StubProvider = struct {
    pub fn interface(self: *StubProvider) TextSearchProvider {
        return .{ .context = self, .vtable = &.{ .search = search } };
    }

    fn search(_: *anyopaque, _: std.Io, _: []const u8, _: []const u8) !model.TextSearchResult {
        return .{ .matches = &.{}, .truncated = false };
    }
};

test "stub returns empty results without filesystem access" {
    var stub: StubProvider = .{};
    const provider = stub.interface();
    for ([_][]const u8{ "雪", "" }) |query| {
        const result = try provider.search(std.testing.io, "/does-not-exist", query);
        try std.testing.expectEqual(@as(usize, 0), result.matches.len);
        try std.testing.expect(!result.truncated);
    }
    for ([_][]const u8{ "a\nb", "a\rb", "a\x00b", "\xff" }) |invalid| {
        try std.testing.expectError(error.InvalidSearchQuery, provider.search(std.testing.io, "/does-not-exist", invalid));
    }
}
