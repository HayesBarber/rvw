const std = @import("std");
const model = @import("../../../app/model.zig");
const snapshot_module = @import("snapshot.zig");
const process = @import("process.zig");
const limits = @import("limits.zig");
const content = @import("content.zig");

const Allocator = std.mem.Allocator;
const Io = std.Io;

pub const Change = struct {
    path: []const u8,
    previous_path: ?[]const u8 = null,
    status: model.FileStatus,
    additions: ?usize = 0,
    deletions: ?usize = 0,
    unavailable: ?model.UnavailableReason = null,
};

pub fn enumerate(
    allocator: Allocator,
    io: Io,
    root: []const u8,
    snapshot: snapshot_module.Snapshot,
) ![]const Change {
    var changes = try trackedChanges(allocator, io, root, snapshot);
    if (snapshot.head == null) try appendUntracked(allocator, io, root, &changes);
    std.mem.sort(Change, changes.items, {}, lessThanChange);
    return changes.toOwnedSlice(allocator);
}

fn trackedChanges(
    allocator: Allocator,
    io: Io,
    root: []const u8,
    snapshot: snapshot_module.Snapshot,
) !std.ArrayList(Change) {
    const output = if (snapshot.head) |head|
        try process.run(allocator, io, &.{ "git", "-C", root, "diff", "--no-ext-diff", "--no-textconv", "--raw", "--numstat", "-z", "--find-renames=50%", snapshot.base, head, "--" }, limits.maximum_metadata_size * 2)
    else
        try process.run(allocator, io, &.{ "git", "-C", root, "diff", "--no-ext-diff", "--no-textconv", "--raw", "--numstat", "-z", "--find-renames=50%", snapshot.base, "--" }, limits.maximum_metadata_size * 2);
    return parseChanges(allocator, output);
}

fn parseChanges(allocator: Allocator, output: []const u8) !std.ArrayList(Change) {
    var changes: std.ArrayList(Change) = .empty;
    errdefer changes.deinit(allocator);
    var cursor: usize = 0;
    while (cursor < output.len and output[cursor] == ':') {
        try changes.append(allocator, try parseRawChange(output, &cursor));
    }
    for (changes.items) |*change| try applyNumstat(change, output, &cursor);
    if (cursor != output.len) return error.MalformedGitOutput;
    return changes;
}

fn parseRawChange(output: []const u8, cursor: *usize) !Change {
    const raw = try nextZ(output, cursor);
    var fields = std.mem.tokenizeScalar(u8, raw[1..], ' ');
    const old_mode = std.fmt.parseInt(u32, fields.next() orelse return error.MalformedGitOutput, 8) catch return error.MalformedGitOutput;
    const new_mode = std.fmt.parseInt(u32, fields.next() orelse return error.MalformedGitOutput, 8) catch return error.MalformedGitOutput;
    _ = fields.next() orelse return error.MalformedGitOutput;
    _ = fields.next() orelse return error.MalformedGitOutput;
    const status_value = fields.next() orelse return error.MalformedGitOutput;
    if (fields.next() != null or status_value.len == 0) return error.MalformedGitOutput;

    const first_path = try validPath(try nextZ(output, cursor));
    const status_code = status_value[0];
    const previous_path: ?[]const u8 = if (status_code == 'R') first_path else null;
    const path = if (status_code == 'R') try validPath(try nextZ(output, cursor)) else first_path;
    return .{
        .path = path,
        .previous_path = previous_path,
        .status = switch (status_code) {
            'A' => .added,
            'D' => .deleted,
            'R' => .renamed,
            else => .modified,
        },
        .unavailable = content.unavailableMode(old_mode) orelse content.unavailableMode(new_mode),
    };
}

fn applyNumstat(change: *Change, output: []const u8, cursor: *usize) !void {
    const record = try nextZ(output, cursor);
    const first_tab = std.mem.indexOfScalar(u8, record, '\t') orelse return error.MalformedGitOutput;
    const second_relative = std.mem.indexOfScalar(u8, record[first_tab + 1 ..], '\t') orelse return error.MalformedGitOutput;
    const second_tab = first_tab + 1 + second_relative;
    const inline_path = record[second_tab + 1 ..];
    const previous_path: ?[]const u8 = if (inline_path.len == 0) try validPath(try nextZ(output, cursor)) else null;
    const path = if (inline_path.len == 0) try validPath(try nextZ(output, cursor)) else try validPath(inline_path);
    if (!std.mem.eql(u8, change.path, path)) return error.MalformedGitOutput;
    if (previous_path) |previous| {
        if (change.previous_path == null or !std.mem.eql(u8, change.previous_path.?, previous)) return error.MalformedGitOutput;
    }
    change.additions = try parseCount(record[0..first_tab]);
    change.deletions = try parseCount(record[first_tab + 1 .. second_tab]);
    if ((change.additions == null or change.deletions == null) and change.unavailable == null) change.unavailable = .binary;
}

fn appendUntracked(
    allocator: Allocator,
    io: Io,
    root: []const u8,
    changes: *std.ArrayList(Change),
) !void {
    const output = try process.run(allocator, io, &.{ "git", "-C", root, "ls-files", "--others", "--exclude-standard", "-z", "--" }, limits.maximum_metadata_size);
    var cursor: usize = 0;
    var directory = try std.Io.Dir.openDirAbsolute(io, root, .{});
    defer directory.close(io);
    while (cursor < output.len) {
        const path = try validPath(try nextZ(output, &cursor));
        const stat = try directory.statFile(io, path, .{ .follow_symlinks = false });
        var additions: ?usize = null;
        if (stat.kind == .file and stat.size <= limits.maximum_text_size) {
            const contents = try directory.readFileAlloc(io, path, allocator, .limited(limits.maximum_text_size + 1));
            if (std.mem.indexOfScalar(u8, contents, 0) == null and std.unicode.utf8ValidateSlice(contents)) {
                additions = content.lineCount(contents);
            }
        }
        const unavailable_reason: ?model.UnavailableReason = switch (stat.kind) {
            .file => null,
            .sym_link => .symlink,
            else => .binary,
        };
        var replaced_deletion = false;
        for (changes.items) |*change| {
            if (change.status != .deleted or !std.mem.eql(u8, change.path, path)) continue;
            change.status = .modified;
            change.additions = additions;
            change.unavailable = change.unavailable orelse unavailable_reason;
            replaced_deletion = true;
            break;
        }
        if (replaced_deletion) continue;
        try changes.append(allocator, .{
            .path = path,
            .status = .added,
            .additions = additions,
            .deletions = if (additions == null) null else 0,
            .unavailable = unavailable_reason,
        });
    }
}

fn nextZ(output: []const u8, cursor: *usize) ![]const u8 {
    if (cursor.* >= output.len) return error.MalformedGitOutput;
    const relative_end = std.mem.indexOfScalar(u8, output[cursor.*..], 0) orelse return error.MalformedGitOutput;
    const value = output[cursor.* .. cursor.* + relative_end];
    cursor.* += relative_end + 1;
    return value;
}

fn validPath(path: []const u8) ![]const u8 {
    if (path.len == 0 or !std.unicode.utf8ValidateSlice(path)) return error.UnsupportedPath;
    return path;
}

fn parseCount(value: []const u8) !?usize {
    if (std.mem.eql(u8, value, "-")) return null;
    return std.fmt.parseInt(usize, value, 10) catch error.MalformedGitOutput;
}

fn lessThanChange(_: void, left: Change, right: Change) bool {
    return std.mem.lessThan(u8, left.path, right.path);
}

test "raw and numstat metadata produce counts and binary classification" {
    const output =
        ":100644 100644 aaaaaaa bbbbbbb M\x00src/main.zig\x00" ++
        ":000000 100644 0000000 ccccccc A\x00assets/logo.png\x00" ++
        "4\t2\tsrc/main.zig\x00-\t-\tassets/logo.png\x00";
    var changes = try parseChanges(std.testing.allocator, output);
    defer changes.deinit(std.testing.allocator);

    try std.testing.expectEqual(@as(usize, 2), changes.items.len);
    try std.testing.expectEqual(model.FileStatus.modified, changes.items[0].status);
    try std.testing.expectEqual(@as(?usize, 4), changes.items[0].additions);
    try std.testing.expectEqual(@as(?usize, 2), changes.items[0].deletions);
    try std.testing.expectEqual(model.UnavailableReason.binary, changes.items[1].unavailable.?);
}

test "rename metadata preserves both paths and numstat counts" {
    const output =
        ":100644 100644 aaaaaaa bbbbbbb R100\x00old name.zig\x00new name.zig\x00" ++
        "3\t1\t\x00old name.zig\x00new name.zig\x00";
    var changes = try parseChanges(std.testing.allocator, output);
    defer changes.deinit(std.testing.allocator);

    try std.testing.expectEqual(@as(usize, 1), changes.items.len);
    try std.testing.expectEqual(model.FileStatus.renamed, changes.items[0].status);
    try std.testing.expectEqualStrings("old name.zig", changes.items[0].previous_path.?);
    try std.testing.expectEqualStrings("new name.zig", changes.items[0].path);
    try std.testing.expectEqual(@as(?usize, 3), changes.items[0].additions);
    try std.testing.expectEqual(@as(?usize, 1), changes.items[0].deletions);
}

test "metadata rejects mismatched paths and sorts changes by current path" {
    const mismatched = ":100644 100644 a b M\x00first\x001\t1\tsecond\x00";
    try std.testing.expectError(error.MalformedGitOutput, parseChanges(std.testing.allocator, mismatched));

    var changes = [_]Change{
        .{ .path = "z-last", .status = .modified },
        .{ .path = "a-first", .status = .added },
    };
    std.mem.sort(Change, &changes, {}, lessThanChange);
    try std.testing.expectEqualStrings("a-first", changes[0].path);
    try std.testing.expectEqualStrings("z-last", changes[1].path);
}
