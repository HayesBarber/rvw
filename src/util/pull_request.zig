const std = @import("std");
const git = @import("git_process.zig");

pub fn parseNumber(value: []const u8) error{InvalidPr}!u32 {
    if (value.len == 0) return error.InvalidPr;
    for (value) |byte| if (byte < '0' or byte > '9') return error.InvalidPr;
    const number = std.fmt.parseInt(u32, value, 10) catch return error.InvalidPr;
    if (number == 0) return error.InvalidPr;
    return number;
}

pub fn errorMessage(err: anyerror) []const u8 {
    return switch (err) {
        error.InvalidPr => "PR number must be a positive integer",
        error.MissingOrigin => "PR review requires an origin remote",
        error.PullRequestUnavailable => "unable to fetch PR head and merge refs from origin; check the PR number, access, and mergeability",
        error.InvalidPullRequestRefs => "PR refs do not contain a valid head and merge base",
        error.GitNotFound => "git executable was not found",
        else => "unable to resolve pull request",
    };
}

/// Uses cached mirror refs when available, otherwise fetches both GitHub refs.
/// The returned range is owned by the caller; the worktree is never checked out.
pub fn resolveRange(io: std.Io, allocator: std.mem.Allocator, root: []const u8, number: u32) ![]u8 {
    if (number == 0) return error.InvalidPr;
    var arena = std.heap.ArenaAllocator.init(allocator);
    defer arena.deinit();
    const scratch = arena.allocator();
    _ = command(io, scratch, root, &.{ "remote", "get-url", "origin" }) catch |err| switch (err) {
        error.GitCommandFailed => return error.MissingOrigin,
        else => return err,
    };
    const head_ref = try std.fmt.allocPrint(scratch, "refs/rvw/pr/{d}/head", .{number});
    const merge_ref = try std.fmt.allocPrint(scratch, "refs/rvw/pr/{d}/merge", .{number});
    const head_revision = try std.fmt.allocPrint(scratch, "{s}^{{commit}}", .{head_ref});
    const merge_revision = try std.fmt.allocPrint(scratch, "{s}^{{commit}}", .{merge_ref});
    const cached_head = try revision(io, scratch, root, head_revision);
    const cached_merge = try revision(io, scratch, root, merge_revision);
    if (cached_head == null or cached_merge == null) {
        const head_spec = try std.fmt.allocPrint(scratch, "+refs/pull/{d}/head:{s}", .{ number, head_ref });
        const merge_spec = try std.fmt.allocPrint(scratch, "+refs/pull/{d}/merge:{s}", .{ number, merge_ref });
        _ = command(io, scratch, root, &.{ "fetch", "--atomic", "origin", head_spec, merge_spec }) catch |err| switch (err) {
            error.GitCommandFailed => return error.PullRequestUnavailable,
            else => return err,
        };
    }
    const head = (try revision(io, scratch, root, head_revision)) orelse return error.InvalidPullRequestRefs;
    const parent = try std.fmt.allocPrint(scratch, "{s}^1", .{merge_ref});
    const base = command(io, scratch, root, &.{ "merge-base", parent, head }) catch |err| switch (err) {
        error.GitCommandFailed => return error.InvalidPullRequestRefs,
        else => return err,
    };
    return std.fmt.allocPrint(allocator, "{s}..{s}", .{ base, head });
}

fn revision(io: std.Io, allocator: std.mem.Allocator, root: []const u8, ref: []const u8) !?[]const u8 {
    return command(io, allocator, root, &.{ "rev-parse", "--verify", ref }) catch |err| switch (err) {
        error.GitCommandFailed => null,
        else => return err,
    };
}

fn command(io: std.Io, allocator: std.mem.Allocator, root: []const u8, args: []const []const u8) ![]const u8 {
    var argv: std.ArrayList([]const u8) = .empty;
    defer argv.deinit(allocator);
    try argv.appendSlice(allocator, &.{ "git", "-C", root });
    try argv.appendSlice(allocator, args);
    const result = try git.runResult(allocator, io, argv.items, git.maximum_revision_size);
    if (!git.exitedSuccessfully(result.term)) return error.GitCommandFailed;
    return std.mem.trim(u8, result.stdout, " \t\r\n");
}

test "PR numbers are positive decimal integers" {
    try std.testing.expectEqual(@as(u32, 100), try parseNumber("100"));
    for ([_][]const u8{ "", "0", "-1", "+1", "1_0", " 1", "abc", "4294967296" }) |value| {
        try std.testing.expectError(error.InvalidPr, parseNumber(value));
    }
}

test "PR resolution fetches mirror refs and uses the merge base, then works offline" {
    const Repository = @import("../testing/repository.zig").Repository;
    var remote = try Repository.init(std.testing.allocator);
    defer remote.deinit();
    try remote.write("base.txt", "base\n");
    try remote.commit("base");
    const base = try remote.revision("HEAD");
    defer std.testing.allocator.free(base);
    try remote.git(&.{ "checkout", "-b", "feature" });
    try remote.write("feature.txt", "feature\n");
    try remote.commit("feature");
    const head = try remote.revision("HEAD");
    defer std.testing.allocator.free(head);
    try remote.git(&.{ "update-ref", "refs/pull/100/head", head });
    try remote.git(&.{ "checkout", "--detach", base });
    try remote.write("upstream.txt", "upstream\n");
    try remote.commit("upstream advanced");
    try remote.git(&.{ "-c", "user.name=tests", "-c", "user.email=tests@example.invalid", "-c", "commit.gpgSign=false", "merge", "--no-ff", "feature", "-m", "merge" });
    try remote.git(&.{ "update-ref", "refs/pull/100/merge", "HEAD" });

    var local = try Repository.init(std.testing.allocator);
    defer local.deinit();
    try std.testing.expectError(error.MissingOrigin, resolveRange(std.testing.io, std.testing.allocator, local.root, 100));
    try local.git(&.{ "remote", "add", "origin", remote.root });
    const expected = try std.fmt.allocPrint(std.testing.allocator, "{s}..{s}", .{ base, head });
    defer std.testing.allocator.free(expected);
    const fetched = try resolveRange(std.testing.io, std.testing.allocator, local.root, 100);
    defer std.testing.allocator.free(fetched);
    try std.testing.expectEqualStrings(expected, fetched);
    try std.testing.expectError(error.PullRequestUnavailable, resolveRange(std.testing.io, std.testing.allocator, local.root, 101));
    try local.git(&.{ "remote", "set-url", "origin", "/nonexistent/rvw-test-remote" });
    const cached = try resolveRange(std.testing.io, std.testing.allocator, local.root, 100);
    defer std.testing.allocator.free(cached);
    try std.testing.expectEqualStrings(expected, cached);
    try local.git(&.{ "update-ref", "refs/rvw/pr/100/merge", base });
    try std.testing.expectError(error.InvalidPullRequestRefs, resolveRange(std.testing.io, std.testing.allocator, local.root, 100));
}
