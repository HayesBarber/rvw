const std = @import("std");

pub const maximum_metadata_size = 16 * 1024 * 1024;
pub const maximum_revision_size = 4096;
pub const maximum_stderr_size = 4096;

pub const RunResult = struct {
    stdout: []const u8,
    term: std.process.Child.Term,
};

pub fn runResult(
    allocator: std.mem.Allocator,
    io: std.Io,
    argv: []const []const u8,
    stdout_limit: usize,
) !RunResult {
    const result = std.process.run(allocator, io, .{
        .argv = argv,
        .stdout_limit = .limited(stdout_limit),
        .stderr_limit = .limited(maximum_stderr_size),
    }) catch |err| switch (err) {
        error.FileNotFound => return error.GitNotFound,
        error.StreamTooLong => return error.GitOutputTooLarge,
        else => |unexpected| return unexpected,
    };
    defer allocator.free(result.stderr);
    return .{ .stdout = result.stdout, .term = result.term };
}

/// Runs git and returns its standard output, classifying a failed command as
/// `error.GitCommandFailed`. The caller owns the returned memory.
pub fn run(
    allocator: std.mem.Allocator,
    io: std.Io,
    argv: []const []const u8,
    stdout_limit: usize,
) ![]const u8 {
    const result = try runResult(allocator, io, argv, stdout_limit);
    if (!exitedSuccessfully(result.term)) return error.GitCommandFailed;
    return result.stdout;
}

pub fn exitedSuccessfully(term: std.process.Child.Term) bool {
    return switch (term) {
        .exited => |status| status == 0,
        else => false,
    };
}

test "only a zero exit status is successful" {
    try std.testing.expect(exitedSuccessfully(.{ .exited = 0 }));
    try std.testing.expect(!exitedSuccessfully(.{ .exited = 1 }));
    try std.testing.expect(!exitedSuccessfully(.{ .signal = .KILL }));
}
