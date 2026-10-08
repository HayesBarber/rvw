const std = @import("std");
const git = @import("git_process.zig");

pub fn errorMessage(err: anyerror) []const u8 {
    return switch (err) {
        error.MissingHead => "cannot resolve HEAD; last-commit review requires a repository with commits",
        error.MissingParent => "cannot resolve the first parent of HEAD; last-commit review requires a parent commit",
        error.GitNotFound => "git executable was not found",
        else => "cannot resolve the last commit",
    };
}

/// Returns an owned range with fixed commit IDs. Resolve the parent from the
/// fixed HEAD so that a concurrent HEAD change cannot change the review target.
pub fn resolveRange(io: std.Io, allocator: std.mem.Allocator, root: []const u8) ![]u8 {
    var arena = std.heap.ArenaAllocator.init(allocator);
    defer arena.deinit();
    const scratch = arena.allocator();
    const head = revision(io, scratch, root, "HEAD^{commit}") catch |err| switch (err) {
        error.GitCommandFailed => return error.MissingHead,
        else => return err,
    };
    const parent_ref = try std.fmt.allocPrint(scratch, "{s}^1", .{head});
    const parent = revision(io, scratch, root, parent_ref) catch |err| switch (err) {
        error.GitCommandFailed => return error.MissingParent,
        else => return err,
    };
    return std.fmt.allocPrint(allocator, "{s}..{s}", .{ parent, head });
}

fn revision(io: std.Io, allocator: std.mem.Allocator, root: []const u8, ref: []const u8) ![]const u8 {
    const result = try git.runResult(allocator, io, &.{ "git", "-C", root, "rev-parse", "--verify", "--end-of-options", ref }, git.maximum_revision_size);
    if (!git.exitedSuccessfully(result.term)) return error.GitCommandFailed;
    return std.mem.trim(u8, result.stdout, " \t\r\n");
}

test "last commit requires HEAD and a first parent" {
    const Repository = @import("../testing/repository.zig").Repository;
    var repo = try Repository.init(std.testing.allocator);
    defer repo.deinit();
    try std.testing.expectError(error.MissingHead, resolveRange(std.testing.io, std.testing.allocator, repo.root));
    try repo.write("root.txt", "root\n");
    try repo.commit("root");
    try std.testing.expectError(error.MissingParent, resolveRange(std.testing.io, std.testing.allocator, repo.root));
    try std.testing.expect(std.mem.indexOf(u8, errorMessage(error.MissingHead), "HEAD") != null);
    try std.testing.expect(std.mem.indexOf(u8, errorMessage(error.MissingParent), "first parent") != null);
}

test "last commit uses the first merge parent and excludes staged and unstaged changes" {
    const Repository = @import("../testing/repository.zig").Repository;
    var repo = try Repository.init(std.testing.allocator);
    defer repo.deinit();
    try repo.write("root.txt", "root\n");
    try repo.commit("root");
    const root = try repo.revision("HEAD");
    defer std.testing.allocator.free(root);
    try repo.git(&.{ "checkout", "-b", "feature" });
    try repo.write("feature.txt", "feature\n");
    try repo.commit("feature");
    try repo.git(&.{ "checkout", "--detach", root });
    try repo.write("parent.txt", "parent\n");
    try repo.commit("first parent");
    const parent = try repo.revision("HEAD");
    defer std.testing.allocator.free(parent);
    try repo.git(&.{ "-c", "user.name=tests", "-c", "user.email=tests@example.invalid", "-c", "commit.gpgSign=false", "merge", "--no-ff", "feature", "-m", "merge" });
    const head = try repo.revision("HEAD");
    defer std.testing.allocator.free(head);
    try repo.write("staged.txt", "staged\n");
    try repo.git(&.{ "add", "staged.txt" });
    try repo.write("root.txt", "unstaged\n");
    const range = try resolveRange(std.testing.io, std.testing.allocator, repo.root);
    defer std.testing.allocator.free(range);
    const expected = try std.fmt.allocPrint(std.testing.allocator, "{s}..{s}", .{ parent, head });
    defer std.testing.allocator.free(expected);
    try std.testing.expectEqualStrings(expected, range);
    var provider = try @import("../provider/diff/git.zig").GitProvider.init(std.testing.allocator, std.testing.io, repo.root, range, null);
    defer provider.deinit();
    try std.testing.expectEqual(@as(usize, 1), provider.overview.files.len);
    try std.testing.expectEqualStrings("feature.txt", provider.overview.files[0].path);
    try std.testing.expectEqualStrings(parent, provider.overview.source.commit_range.base);
    try std.testing.expectEqualStrings(head, provider.overview.source.commit_range.head);
}
