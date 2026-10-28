const std = @import("std");
const model = @import("../../app/model.zig");

pub const PullRequestProvider = struct {
    context: *anyopaque,
    vtable: *const VTable,

    pub const maximum_pull_requests = 30;

    pub const VTable = struct {
        listOpenPullRequests: *const fn (*anyopaque, std.Io, []const u8) anyerror!model.PullRequestListResult,
    };

    /// Read the current open PRs for the repository's origin on each call.
    /// Use the default limit of 30. Include drafts and preserve GitHub CLI order.
    /// Return an empty list if the repository has no open PRs.
    /// Do not retain selection state or change the active review or comments.
    /// Do not fetch Git refs or change the index or working-tree files.
    /// Return MissingOrigin or UnsupportedOrigin for an invalid origin.
    /// Return RepositoryUnavailable or RepositoryFailed for Git failures.
    /// Return PullRequestListUnavailable if gh is absent,
    /// PullRequestAuthenticationFailed for authentication failures,
    /// PullRequestListFailed for request failures, or InvalidPullRequestList
    /// for invalid response data. Propagate allocation failures.
    /// The caller must call result.deinit() after use or serialization failure.
    pub fn listOpenPullRequests(self: PullRequestProvider, io: std.Io, directory: []const u8) !model.PullRequestListResult {
        return self.vtable.listOpenPullRequests(self.context, io, directory);
    }
};

test "pull request provider forwards each request and defined failures" {
    const Stub = struct {
        calls: usize = 0,
        failure: ?anyerror = null,

        fn listOpenPullRequests(context: *anyopaque, _: std.Io, directory: []const u8) !model.PullRequestListResult {
            const self: *@This() = @ptrCast(@alignCast(context));
            self.calls += 1;
            try std.testing.expectEqualStrings("/repository", directory);
            if (self.failure) |failure| return failure;
            return .{ .pullRequests = &.{} };
        }
    };
    var stub: Stub = .{};
    const provider: PullRequestProvider = .{ .context = &stub, .vtable = &.{ .listOpenPullRequests = Stub.listOpenPullRequests } };
    for (0..2) |_| {
        const result = try provider.listOpenPullRequests(std.testing.io, "/repository");
        defer result.deinit();
        try std.testing.expectEqual(@as(usize, 0), result.pullRequests.len);
    }
    const failures = [_]anyerror{
        error.MissingOrigin,
        error.UnsupportedOrigin,
        error.RepositoryUnavailable,
        error.RepositoryFailed,
        error.PullRequestListUnavailable,
        error.PullRequestAuthenticationFailed,
        error.PullRequestListFailed,
        error.InvalidPullRequestList,
        error.OutOfMemory,
    };
    const codes = [_]model.ErrorCode{
        .missing_origin,
        .unsupported_origin,
        .repository_unavailable,
        .repository_failed,
        .pull_request_list_unavailable,
        .pull_request_authentication_failed,
        .pull_request_list_failed,
        .invalid_pull_request_list,
        .internal_error,
    };
    for (failures, codes) |failure, code| {
        stub.failure = failure;
        try std.testing.expectError(failure, provider.listOpenPullRequests(std.testing.io, "/repository"));
        try std.testing.expectEqual(code, model.errorCode(failure));
        try std.testing.expect(model.errorMessage(code).len > 0);
    }
    try std.testing.expectEqual(@as(usize, 2 + failures.len), stub.calls);
}
