const std = @import("std");

/// Validates that `path` identifies a Git worktree root and returns its
/// canonical path. The caller owns the returned memory.
pub fn validateRoot(io: std.Io, allocator: std.mem.Allocator, path: []const u8) ![:0]u8 {
    const metadata = std.Io.Dir.cwd().statFile(io, path, .{}) catch |err| switch (err) {
        error.FileNotFound => return error.RepositoryPathMissing,
        else => |unexpected| return unexpected,
    };
    if (metadata.kind != .directory) return error.NotDirectory;
    const canonical = try std.Io.Dir.cwd().realPathFileAlloc(io, path, allocator);
    errdefer allocator.free(canonical);

    const result = std.process.run(allocator, io, .{
        .argv = &.{ "git", "-C", canonical, "rev-parse", "--show-toplevel" },
        .stdout_limit = .limited(4 * 1024),
        .stderr_limit = .limited(4 * 1024),
    }) catch |err| switch (err) {
        error.FileNotFound => return error.GitNotFound,
        else => |unexpected| return unexpected,
    };
    defer allocator.free(result.stdout);
    defer allocator.free(result.stderr);
    switch (result.term) {
        .exited => |status| if (status != 0) return error.NotGitRepository,
        else => return error.NotGitRepository,
    }
    const reported_root = std.mem.trim(u8, result.stdout, " \t\r\n");
    if (!std.mem.eql(u8, canonical, reported_root)) return error.NotRepositoryRoot;
    return canonical;
}

test "validation accepts only the worktree root" {
    var temporary = std.testing.tmpDir(.{});
    defer temporary.cleanup();
    try temporary.dir.createDir(std.testing.io, "nested", .default_dir);

    const initialization = try std.process.run(std.testing.allocator, std.testing.io, .{
        .argv = &.{ "git", "init", "--quiet" },
        .cwd = .{ .dir = temporary.dir },
    });
    defer std.testing.allocator.free(initialization.stdout);
    defer std.testing.allocator.free(initialization.stderr);
    try std.testing.expectEqual(std.process.Child.Term{ .exited = 0 }, initialization.term);

    const canonical_root = try temporary.dir.realPathFileAlloc(std.testing.io, ".", std.testing.allocator);
    defer std.testing.allocator.free(canonical_root);
    const validated = try validateRoot(std.testing.io, std.testing.allocator, canonical_root);
    defer std.testing.allocator.free(validated);
    try std.testing.expectEqualStrings(canonical_root, validated);

    const nested = try std.fs.path.join(std.testing.allocator, &.{ canonical_root, "nested" });
    defer std.testing.allocator.free(nested);
    try std.testing.expectError(
        error.NotRepositoryRoot,
        validateRoot(std.testing.io, std.testing.allocator, nested),
    );
}

test "validation rejects missing, file, and non-Git paths" {
    var temporary = std.testing.tmpDir(.{});
    defer temporary.cleanup();
    try temporary.dir.writeFile(std.testing.io, .{ .sub_path = "plain.txt", .data = "not a directory" });
    // Stop Git discovery from walking up into the rvw checkout containing the test temp directory.
    try temporary.dir.writeFile(std.testing.io, .{ .sub_path = ".git", .data = "invalid gitfile\n" });

    const canonical_root = try temporary.dir.realPathFileAlloc(std.testing.io, ".", std.testing.allocator);
    defer std.testing.allocator.free(canonical_root);
    const file_path = try std.fs.path.join(std.testing.allocator, &.{ canonical_root, "plain.txt" });
    defer std.testing.allocator.free(file_path);
    const missing_path = try std.fs.path.join(std.testing.allocator, &.{ canonical_root, "missing" });
    defer std.testing.allocator.free(missing_path);

    try std.testing.expectError(
        error.NotGitRepository,
        validateRoot(std.testing.io, std.testing.allocator, canonical_root),
    );
    try std.testing.expectError(
        error.NotDirectory,
        validateRoot(std.testing.io, std.testing.allocator, file_path),
    );
    try std.testing.expectError(
        error.RepositoryPathMissing,
        validateRoot(std.testing.io, std.testing.allocator, missing_path),
    );
}
