const std = @import("std");
const config = @import("../config/config.zig");
const core_module = @import("core.zig");
const model = @import("model.zig");
const provider = @import("../provider/provider.zig");
const output = @import("../output/output.zig");
const log = @import("../log/log.zig");
const snapshot = @import("../provider/diff/git/snapshot.zig");
const pull_request = @import("../util/pull_request.zig");

pub const Options = struct {
    directory: []const u8,
    source: model.DiffSource = .{ .working_tree = .{ .base = "HEAD" } },
    configuration: config.Snapshot,
    logger: log.Logger,
};

/// Owns Core and the providers referenced by Core. Keep this object at its
/// allocated address. The caller must keep Io, configuration, and logger alive
/// until destroy returns.
pub const Session = struct {
    allocator: std.mem.Allocator,
    arena: std.heap.ArenaAllocator,
    options: Options,
    review: provider.review.git.GitReviewProvider,
    repository: provider.repository.git.GitProvider,
    pull_requests: provider.pull_request.github_cli.GitHubCliProvider,
    comments: provider.comment.memory.MemoryProvider,
    clipboard: output.SystemClipboard,
    search_ignore_aware: provider.text_search.ripgrep.RipgrepProvider,
    search_all_files: provider.text_search.ripgrep.RipgrepProvider,
    core: core_module.Core,

    pub fn create(allocator: std.mem.Allocator, io: std.Io, options: Options) !*Session {
        const self = try allocator.create(Session);
        errdefer allocator.destroy(self);
        self.allocator = allocator;
        self.arena = .init(allocator);
        errdefer self.arena.deinit();
        const storage = self.arena.allocator();
        const source: model.DiffSource = switch (options.source) {
            .working_tree => |value| .{ .working_tree = .{ .base = try storage.dupe(u8, value.base) } },
            .commit_range => |value| .{ .commit_range = .{
                .base = try storage.dupe(u8, value.base),
                .head = try storage.dupe(u8, value.head),
            } },
            .pull_request => |value| .{ .pull_request = value },
        };
        const executables = config.Executables.fromSnapshot(options.configuration);
        const comparison: snapshot.Comparison = switch (source) {
            .working_tree => |value| .{ .working_tree = .{ .base = value.base } },
            .commit_range => |value| .{ .commit_range = .{ .base = value.base, .head = value.head } },
            .pull_request => |value| blk: {
                // Resolve from current remote refs for every session. A supplied
                // launch range is not a substitute for a successful fetch.
                const range = try pull_request.resolveRange(io, storage, options.directory, value.number, executables.git);
                break :blk try snapshot.comparisonFromRange(range);
            },
        };
        self.review = try provider.review.git.GitReviewProvider.initComparison(
            allocator,
            io,
            options.directory,
            comparison,
            if (source == .pull_request) source.pull_request.number else null,
            executables.git,
        );
        errdefer self.review.deinit();
        self.options = options;
        self.options.directory = try storage.dupe(u8, self.review.repository_path);
        self.options.source = source;
        self.repository = .{ .allocator = allocator, .executable = executables.git };
        self.pull_requests = .{ .allocator = allocator, .executable = executables.gh, .git_executable = executables.git };
        self.comments = .init(allocator);
        self.clipboard = .{};
        self.search_ignore_aware = .{ .allocator = allocator, .mode = .@"ignore-aware", .executable = executables.rg };
        self.search_all_files = .{ .allocator = allocator, .mode = .@"all-files", .executable = executables.rg };
        self.core = core_module.Core.init(
            allocator,
            io,
            self.review.interface(),
            self.repository.interface(),
            self.pull_requests.interface(),
            self.search_ignore_aware.interface(),
            self.search_all_files.interface(),
            self.comments.interface(),
            self.clipboard.interface(),
            options.logger,
            options.configuration,
        );
        return self;
    }

    /// Call only after all requests and response serialization have finished.
    pub fn destroy(self: *Session) void {
        const allocator = self.allocator;
        self.comments.deinit();
        self.review.deinit();
        self.arena.deinit();
        allocator.destroy(self);
    }
};

pub fn sourceFromArguments(range: ?[]const u8, pr: ?u32) !model.DiffSource {
    if (pr) |number| {
        if (number == 0) return error.InvalidPr;
        return .{ .pull_request = .{ .number = number } };
    }
    return switch (try snapshot.comparisonFromRange(range)) {
        .working_tree => |value| .{ .working_tree = .{ .base = value.base } },
        .commit_range => |value| .{ .commit_range = .{ .base = value.base, .head = value.head } },
    };
}

pub fn errorMessage(err: anyerror) []const u8 {
    return switch (err) {
        error.InvalidPr, error.MissingOrigin, error.PullRequestUnavailable, error.InvalidPullRequestRefs => pull_request.errorMessage(err),
        else => provider.diff.git.errorMessage(err),
    };
}

test "session retains source arguments and creates independent comments and providers" {
    const Repository = @import("../testing/repository.zig").Repository;
    const allocator = std.testing.allocator;
    const io = std.testing.io;
    var repository = try Repository.init(allocator);
    defer repository.deinit();
    try repository.write("file.txt", "base\n");
    try repository.commit("base");
    const base = try repository.revision("HEAD");
    defer allocator.free(base);
    try repository.write("file.txt", "head\n");
    try repository.commit("head");
    const head = try repository.revision("HEAD");
    defer allocator.free(head);
    const first = blk: {
        var inputs = std.heap.ArenaAllocator.init(allocator);
        defer inputs.deinit();
        break :blk try Session.create(allocator, io, testOptions(
            try inputs.allocator().dupe(u8, repository.root),
            .{ .commit_range = .{
                .base = try inputs.allocator().dupe(u8, base),
                .head = try inputs.allocator().dupe(u8, head),
            } },
        ));
    };
    // The options remain valid after the caller releases its input storage.
    const second = blk: {
        defer first.destroy();
        const created = try first.core.dispatch(.{ .create_comment = .{ .body = "first session", .target = .review } });
        defer created.deinit();
        const comments = try first.core.dispatch(.get_comments);
        defer comments.deinit();
        try std.testing.expectEqual(@as(usize, 1), comments.comments.len);
        break :blk try Session.create(allocator, io, first.options);
    };
    defer second.destroy();
    const overview = (try second.core.dispatch(.get_diff_overview)).diff_overview;
    try std.testing.expectEqualStrings(base, overview.source.commit_range.base);
    try std.testing.expectEqualStrings(head, overview.source.commit_range.head);
    const file = (try second.core.dispatch(.{ .get_file_diff = .{ .diff_id = overview.id, .path = "file.txt" } })).file_diff;
    try std.testing.expectEqualStrings("base\n", file.content.diff.oldFile.?.contents);
    try std.testing.expectEqualStrings("head\n", file.content.diff.newFile.?.contents);
    const comments = try second.core.dispatch(.get_comments);
    defer comments.deinit();
    try std.testing.expectEqual(@as(usize, 0), comments.comments.len);
    const commits = try second.core.dispatch(.list_commits);
    defer commits.deinit();
    try std.testing.expectEqual(@as(usize, 2), commits.commit_list.commits.len);
}

test "incomplete session releases resources and leaves an existing session usable" {
    const Repository = @import("../testing/repository.zig").Repository;
    const allocator = std.testing.allocator;
    const io = std.testing.io;
    var repository = try Repository.init(allocator);
    defer repository.deinit();
    try repository.write("file.txt", "base\n");
    try repository.commit("base");
    const active = try Session.create(allocator, io, testOptions(repository.root, .{ .working_tree = .{ .base = "HEAD" } }));
    defer active.destroy();
    const comment = try active.core.dispatch(.{ .create_comment = .{ .body = "keep me", .target = .review } });
    defer comment.deinit();
    var invalid = active.options;
    invalid.source = .{ .working_tree = .{ .base = "missing-commit" } };
    try std.testing.expectError(error.InvalidRevision, Session.create(allocator, io, invalid));
    // Fail after diff creation, during another provider's initialization.
    const executable = try repository.writeExecutable(".git/failing git",
        \\#!/bin/sh
        \\case "$*" in *'ls-files --cached'*) exit 7;; esac
        \\exec git "$@"
        \\
    );
    defer allocator.free(executable);
    var arena = std.heap.ArenaAllocator.init(allocator);
    defer arena.deinit();
    const settings = try std.json.Stringify.valueAlloc(arena.allocator(), .{ .executables = .{ .git = executable } }, .{});
    invalid = active.options;
    invalid.configuration = .{
        .configuration = try std.json.parseFromSliceLeaky(std.json.Value, arena.allocator(), settings, .{}),
        .diagnostic = null,
    };
    try std.testing.expectError(error.GitCommandFailed, Session.create(allocator, io, invalid));
    const comments = try active.core.dispatch(.get_comments);
    defer comments.deinit();
    try std.testing.expectEqualStrings("keep me", comments.comments[0].body);
    const file = try active.core.dispatch(.{ .get_file = .{ .path = "file.txt" } });
    defer file.deinit();
    try std.testing.expectEqualStrings("base\n", file.file.content.file.file.contents);
}

test "PR sessions fetch current refs with configured Git and reject stale refs on failure" {
    const Repository = @import("../testing/repository.zig").Repository;
    const allocator = std.testing.allocator;
    const io = std.testing.io;
    var remote = try Repository.init(allocator);
    defer remote.deinit();
    try remote.write("file.txt", "base\n");
    try remote.commit("base");
    const base = try remote.revision("HEAD");
    defer allocator.free(base);
    try remote.write("file.txt", "first\n");
    try remote.commit("first head");
    const first_head = try remote.revision("HEAD");
    defer allocator.free(first_head);
    try remote.git(&.{ "update-ref", "refs/pull/100/head", first_head });
    // A single-parent merge ref is sufficient: its first parent is the base.
    try remote.git(&.{ "update-ref", "refs/pull/100/merge", first_head });
    var local = try Repository.init(allocator);
    defer local.deinit();
    try local.write("local.txt", "local\n");
    try local.commit("local");
    try local.git(&.{ "remote", "add", "origin", remote.root });
    const executable = try local.writeExecutable(".git/custom git",
        \\#!/bin/sh
        \\printf '%s\n' "$*" >> "$0.calls"
        \\exec git "$@"
        \\
    );
    defer allocator.free(executable);
    var arena = std.heap.ArenaAllocator.init(allocator);
    defer arena.deinit();
    const settings = try std.json.Stringify.valueAlloc(arena.allocator(), .{ .executables = .{ .git = executable } }, .{});
    var options = testOptions(local.root, try sourceFromArguments("stale..range", 100));
    options.configuration = .{
        .configuration = try std.json.parseFromSliceLeaky(std.json.Value, arena.allocator(), settings, .{}),
        .diagnostic = null,
    };
    const first = try Session.create(allocator, io, options);
    defer first.destroy();
    const first_overview = (try first.core.dispatch(.get_diff_overview)).diff_overview;
    try std.testing.expectEqual(@as(u32, 100), first_overview.source.pull_request.number);
    const first_file = (try first.core.dispatch(.{ .get_file_diff = .{ .diff_id = first_overview.id, .path = "file.txt" } })).file_diff;
    try std.testing.expectEqualStrings("base\n", first_file.content.diff.oldFile.?.contents);
    try std.testing.expectEqualStrings("first\n", first_file.content.diff.newFile.?.contents);
    // A force push changes the head without extending the previous head.
    try remote.git(&.{ "checkout", "--quiet", "--detach", base });
    try remote.write("file.txt", "rewritten\n");
    try remote.commit("rewritten head");
    try remote.git(&.{ "update-ref", "refs/pull/100/head", "HEAD" });
    try remote.git(&.{ "update-ref", "refs/pull/100/merge", "HEAD" });
    const second = try Session.create(allocator, io, first.options);
    defer second.destroy();
    const overview = (try second.core.dispatch(.get_diff_overview)).diff_overview;
    try std.testing.expect(!std.mem.eql(u8, first_overview.id, overview.id));
    const file = (try second.core.dispatch(.{ .get_file_diff = .{ .diff_id = overview.id, .path = "file.txt" } })).file_diff;
    try std.testing.expectEqualStrings("rewritten\n", file.content.diff.newFile.?.contents);
    const calls = try local.temporary.dir.readFileAlloc(io, ".git/custom git.calls", allocator, .unlimited);
    defer allocator.free(calls);
    try std.testing.expectEqual(@as(usize, 2), std.mem.count(u8, calls, "fetch --atomic origin"));
    try local.git(&.{ "remote", "set-url", "origin", "/nonexistent/rvw-test-remote" });
    try std.testing.expectError(error.PullRequestUnavailable, Session.create(allocator, io, second.options));
    try std.testing.expectEqualStrings(overview.id, (try second.core.dispatch(.get_diff_overview)).diff_overview.id);
}

fn testOptions(directory: []const u8, source: model.DiffSource) Options {
    return .{
        .directory = directory,
        .source = source,
        .configuration = .{ .configuration = .{ .object = .empty }, .diagnostic = null },
        .logger = log.stderrLogger(std.testing.allocator),
    };
}
