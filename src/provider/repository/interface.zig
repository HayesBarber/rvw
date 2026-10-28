const std = @import("std");
const model = @import("../../app/model.zig");

pub const RepositoryProvider = struct {
    context: *anyopaque,
    vtable: *const VTable,

    pub const maximum_commits = 30;

    pub const VTable = struct {
        listCommits: *const fn (*anyopaque, std.Io, []const u8) anyerror!model.CommitListResult,
    };

    /// Read up to 30 commits reachable from current HEAD, most recent first.
    /// Include HEAD and merge history. An unborn HEAD returns an empty list.
    /// Do not retain selection state or change the repository or active review.
    /// Return RepositoryUnavailable when Git is absent, RepositoryFailed when
    /// execution fails, or InvalidCommitHistory when parsing fails.
    /// The caller must call result.deinit() after use or serialization failure.
    pub fn listCommits(self: RepositoryProvider, io: std.Io, directory: []const u8) !model.CommitListResult {
        return self.vtable.listCommits(self.context, io, directory);
    }
};

test "repository provider forwards each request and defined failures" {
    const Stub = struct {
        calls: usize = 0,
        failure: ?anyerror = null,

        fn listCommits(context: *anyopaque, _: std.Io, directory: []const u8) !model.CommitListResult {
            const self: *@This() = @ptrCast(@alignCast(context));
            self.calls += 1;
            try std.testing.expectEqualStrings("/repository", directory);
            if (self.failure) |failure| return failure;
            return .{ .commits = &.{} };
        }
    };
    var stub: Stub = .{};
    const provider: RepositoryProvider = .{ .context = &stub, .vtable = &.{ .listCommits = Stub.listCommits } };
    for (0..2) |_| {
        const result = try provider.listCommits(std.testing.io, "/repository");
        defer result.deinit();
        try std.testing.expectEqual(@as(usize, 0), result.commits.len);
    }
    const failures = [_]anyerror{ error.RepositoryUnavailable, error.RepositoryFailed, error.InvalidCommitHistory };
    const codes = [_]model.ErrorCode{ .repository_unavailable, .repository_failed, .invalid_commit_history };
    for (failures, codes) |failure, code| {
        stub.failure = failure;
        try std.testing.expectError(failure, provider.listCommits(std.testing.io, "/repository"));
        try std.testing.expectEqual(code, model.errorCode(failure));
        try std.testing.expect(model.errorMessage(code).len > 0);
    }
    try std.testing.expectEqual(@as(usize, 5), stub.calls);
}
