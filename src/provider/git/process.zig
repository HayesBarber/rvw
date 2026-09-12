const std = @import("std");

pub const maximum_metadata_size = 16 * 1024 * 1024;
pub const maximum_revision_size = 4096;
pub const maximum_stderr_size = 4096;

pub fn run(
    allocator: std.mem.Allocator,
    io: std.Io,
    argv: []const []const u8,
    stdout_limit: usize,
) ![]const u8 {
    const result = std.process.run(allocator, io, .{
        .argv = argv,
        .stdout_limit = .limited(stdout_limit),
        .stderr_limit = .limited(maximum_stderr_size),
    }) catch |err| switch (err) {
        error.FileNotFound => return error.GitNotFound,
        error.StreamTooLong => return error.GitOutputTooLarge,
        else => |unexpected| return unexpected,
    };
    if (!exitedSuccessfully(result.term)) return error.GitCommandFailed;
    return result.stdout;
}

fn exitedSuccessfully(term: std.process.Child.Term) bool {
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