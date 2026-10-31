const std = @import("std");
const Snapshot = @import("interface.zig").Snapshot;

/// Selected command names or absolute paths. Selection does not start a tool.
/// Paths borrow storage from the configuration snapshot.
pub const Executables = struct {
    git: []const u8 = "git",
    gh: []const u8 = "gh",
    rg: []const u8 = "rg",

    pub fn fromSnapshot(snapshot: Snapshot) Executables {
        var selected: Executables = .{};
        // Invalid configuration uses the same defaults as an absent file.
        if (snapshot.diagnostic != null) return selected;
        const configured = snapshot.configuration.object.get("executables") orelse return selected;
        inline for (std.meta.fields(Executables)) |field| {
            if (configured.object.get(field.name)) |value| @field(selected, field.name) = value.string;
        }
        return selected;
    }
};

pub const defaults: Executables = .{};

test "executable selection keeps each omitted tool on process PATH" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    for ([_][]const u8{ "git", "gh", "rg" }) |tool| {
        const input = try std.fmt.allocPrint(arena.allocator(), "{{\"executables\":{{\"{s}\":\"/tools with spaces/custom\"}}}}", .{tool});
        const value = try std.json.parseFromSliceLeaky(std.json.Value, arena.allocator(), input, .{});
        const selected = Executables.fromSnapshot(.{ .configuration = value, .diagnostic = null });
        inline for (std.meta.fields(Executables)) |field| {
            try std.testing.expectEqualStrings(
                if (std.mem.eql(u8, field.name, tool)) "/tools with spaces/custom" else @field(defaults, field.name),
                @field(selected, field.name),
            );
        }
    }
    const empty = Snapshot{ .configuration = .{ .object = .empty }, .diagnostic = null };
    try std.testing.expectEqualDeep(defaults, Executables.fromSnapshot(empty));
    var invalid = empty;
    invalid.diagnostic = .{ .code = .invalid_schema, .message = "invalid configuration", .path = "config.json" };
    try std.testing.expectEqualDeep(defaults, Executables.fromSnapshot(invalid));
}
