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
