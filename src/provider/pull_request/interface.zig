const std = @import("std");
const model = @import("../../app/model.zig");

pub const PullRequestProvider = struct {
    context: *anyopaque,
    vtable: *const VTable,

    pub const Error = error{
        MissingOrigin,
        UnsupportedOrigin,
        RepositoryUnavailable,
        RepositoryFailed,
        PullRequestListUnavailable,
        PullRequestAuthenticationFailed,
        PullRequestListFailed,
        InvalidPullRequestList,
        OutOfMemory,
    };

    pub const VTable = struct {
        listOpenPullRequests: *const fn (*anyopaque, std.Io, []const u8) Error!model.PullRequestListResult,
    };

    /// List the current open PRs for the repository at directory.
    /// The caller must call result.deinit() after use.
    pub fn listOpenPullRequests(self: PullRequestProvider, io: std.Io, directory: []const u8) Error!model.PullRequestListResult {
        return self.vtable.listOpenPullRequests(self.context, io, directory);
    }
};

test "pull request provider forwards each request and defined failures" {
    const Stub = struct {
        calls: usize = 0,
        failure: ?PullRequestProvider.Error = null,

        fn listOpenPullRequests(context: *anyopaque, _: std.Io, directory: []const u8) PullRequestProvider.Error!model.PullRequestListResult {
            const self: *@This() = @ptrCast(@alignCast(context));
            self.calls += 1;
            std.debug.assert(std.mem.eql(u8, "/repository", directory));
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
    const failures = [_]PullRequestProvider.Error{
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
