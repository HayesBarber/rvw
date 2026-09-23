const std = @import("std");
const model = @import("../../app/model.zig");
const TextSearchProvider = @import("interface.zig").TextSearchProvider;

/// No filesystem access or external executable is required.
pub const StubProvider = struct {
    pub fn interface(self: *StubProvider) TextSearchProvider {
        return .{ .context = self, .vtable = &.{ .search = search } };
    }

    fn search(_: *anyopaque, _: std.Io, _: []const u8, _: model.TextSearchRequest) !model.TextSearchResult {
        return error.SearchNotImplemented;
    }
};

test "both search modes have deterministic stubs without filesystem access" {
    var stub: StubProvider = .{};
    for (std.enums.values(model.TextSearchMode)) |mode| {
        const provider = stub.interface();
        try std.testing.expectError(error.SearchNotImplemented, provider.search(std.testing.io, "/does-not-exist", .{ .query = "雪", .mode = mode }));
        const empty = try provider.search(std.testing.io, "/does-not-exist", .{ .query = "", .mode = mode });
        try std.testing.expectEqual(@as(usize, 0), empty.matches.len);
        try std.testing.expect(!empty.truncated);
        for ([_][]const u8{ "a\nb", "a\rb", "a\x00b", "\xff" }) |invalid| {
            try std.testing.expectError(error.InvalidSearchQuery, provider.search(std.testing.io, "/does-not-exist", .{ .query = invalid, .mode = mode }));
        }
    }
}
