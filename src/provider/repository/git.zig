const std = @import("std");
const model = @import("../../app/model.zig");
const git_process = @import("../../util/git_process.zig");
const RepositoryProvider = @import("interface.zig").RepositoryProvider;
const metadata = @import("../diff/git/metadata.zig");

/// Each request owns its result. Repository data is not cached.
pub const GitProvider = struct {
    allocator: std.mem.Allocator,
    /// Null finds Git through PATH. Overrides must be absolute paths.
    executable: ?[]const u8 = null,

    pub fn interface(self: *GitProvider) RepositoryProvider {
        return .{ .context = self, .vtable = &.{ .listCommits = listCommits, .listWorkingTreeChanges = listWorkingTreeChanges } };
    }

    fn listWorkingTreeChanges(context: *anyopaque, io: std.Io, directory: []const u8) !model.WorkingTreeChangesResult {
        const self: *GitProvider = @ptrCast(@alignCast(context));
        var arena = std.heap.ArenaAllocator.init(self.allocator);
        errdefer arena.deinit();
        const allocator = arena.allocator();

        // A corrupt repository can make Git discover a parent worktree.
        const root = std.Io.Dir.cwd().realPathFileAlloc(io, directory, allocator) catch |err| switch (err) {
            error.OutOfMemory => return err,
            else => return error.WorkingTreeChangesFailed,
        };
        const reported = self.run(allocator, io, root, &.{ "rev-parse", "--show-toplevel" }, git_process.maximum_revision_size) catch |err| switch (err) {
            error.RepositoryFailed => return error.WorkingTreeChangesFailed,
            else => return err,
        };
        if (!git_process.exitedSuccessfully(reported.term) or !std.mem.eql(u8, root, std.mem.trimEnd(u8, reported.stdout, "\r\n"))) return error.WorkingTreeChangesFailed;

        const revision = self.run(allocator, io, directory, &.{ "rev-parse", "--verify", "--end-of-options", "HEAD^{commit}" }, git_process.maximum_revision_size) catch |err| switch (err) {
            error.RepositoryFailed => return error.WorkingTreeChangesFailed,
            else => return err,
        };
        if (!git_process.exitedSuccessfully(revision.term)) return error.InvalidRevision;
        const head = std.mem.trim(u8, revision.stdout, " \t\r\n");
        if (head.len == 0 or !std.unicode.utf8ValidateSlice(head)) return error.InvalidRevision;
        const changes = metadata.enumerateWithGit(allocator, io, directory, .{ .base = head }, self.executable orelse "git") catch |err| switch (err) {
            error.OutOfMemory, error.UnsupportedPath, error.MalformedGitOutput => return err,
            error.GitNotFound, error.AccessDenied, error.InvalidExe => return error.RepositoryUnavailable,
            else => return error.WorkingTreeChangesFailed,
        };
        return .{ .files = try metadata.summarize(allocator, changes), .arena = arena };
    }

    fn listCommits(context: *anyopaque, io: std.Io, directory: []const u8) !model.CommitListResult {
        const self: *GitProvider = @ptrCast(@alignCast(context));
        var arena = std.heap.ArenaAllocator.init(self.allocator);
        errdefer arena.deinit();
        const allocator = arena.allocator();

        const revision = try self.run(allocator, io, directory, &.{ "rev-parse", "--verify", "--quiet", "HEAD^{commit}" }, git_process.maximum_revision_size);
        if (!git_process.exitedSuccessfully(revision.term)) {
            // Only an absent branch ref is empty history. A bad repository,
            // corrupt ref, or invalid detached HEAD must remain an error.
            const symbolic = try self.run(allocator, io, directory, &.{ "symbolic-ref", "--quiet", "HEAD" }, git_process.maximum_revision_size);
            if (!git_process.exitedSuccessfully(symbolic.term)) return error.RepositoryFailed;
            const ref = std.mem.trimEnd(u8, symbolic.stdout, "\n");
            if (!std.mem.startsWith(u8, ref, "refs/") or std.mem.indexOfAny(u8, ref, "\x00\r\n") != null) return error.InvalidCommitHistory;
            const exists = try self.run(allocator, io, directory, &.{ "show-ref", "--verify", "--quiet", "--", ref }, git_process.maximum_revision_size);
            switch (exists.term) {
                .exited => |status| if (status == 1) return .{ .commits = &.{}, .arena = arena },
                else => {},
            }
            return error.RepositoryFailed;
        }
        const head = std.mem.trimEnd(u8, revision.stdout, "\n");

        const limit = std.fmt.comptimePrint("--max-count={d}", .{RepositoryProvider.maximum_commits});
        const history = try self.run(allocator, io, directory, &.{
            "log",                             "--no-patch",       "--no-notes",   "--no-show-signature", "--no-decorate",
            "--no-use-mailmap",                "--encoding=UTF-8", "--date-order", "-z",                  limit,
            "--format=%H%x00%B%x00%an%x00%cI", head,               "--",
        }, git_process.maximum_metadata_size);
        if (!git_process.exitedSuccessfully(history.term)) return error.RepositoryFailed;
        const commits = try parseHistory(allocator, history.stdout);
        if (commits.len == 0 or !std.mem.eql(u8, commits[0].sha, head)) return error.InvalidCommitHistory;
        return .{ .commits = commits, .arena = arena };
    }

    fn run(self: *GitProvider, allocator: std.mem.Allocator, io: std.Io, directory: []const u8, arguments: []const []const u8, limit: usize) !git_process.RunResult {
        const executable = self.executable orelse "git";
        if (self.executable != null and !std.fs.path.isAbsolute(executable)) return error.RepositoryUnavailable;
        var argv: std.ArrayList([]const u8) = .empty;
        try argv.appendSlice(allocator, &.{ executable, "--no-pager", "--no-optional-locks", "--no-replace-objects", "-C", directory });
        try argv.appendSlice(allocator, arguments);
        return git_process.runResult(allocator, io, argv.items, limit) catch |err| switch (err) {
            error.GitNotFound, error.AccessDenied, error.InvalidExe => error.RepositoryUnavailable,
            error.OutOfMemory => error.OutOfMemory,
            else => error.RepositoryFailed,
        };
    }
};

/// Fields refer to output, which must remain alive with the returned slice.
fn parseHistory(allocator: std.mem.Allocator, output: []const u8) ![]const model.Commit {
    if (!std.unicode.utf8ValidateSlice(output)) return error.InvalidCommitHistory;
    var commits: std.ArrayList(model.Commit) = .empty;
    var remaining = output;
    while (remaining.len > 0) {
        if (commits.items.len == RepositoryProvider.maximum_commits) return error.InvalidCommitHistory;
        var fields: [4][]const u8 = undefined;
        for (&fields) |*field| {
            const end = std.mem.indexOfScalar(u8, remaining, 0) orelse return error.InvalidCommitHistory;
            field.* = remaining[0..end];
            remaining = remaining[end + 1 ..];
        }
        const message = fields[1];
        const first_line = message[0 .. std.mem.indexOfScalar(u8, message, '\n') orelse message.len];
        try commits.append(allocator, .{
            .sha = fields[0],
            .subject = std.mem.trimEnd(u8, first_line, "\r"),
            .authorName = fields[2],
            .commitDate = fields[3],
        });
    }
    return commits.toOwnedSlice(allocator);
}

const TestRepository = @import("../../testing/repository.zig").Repository;

fn commitAt(repository: *TestRepository, message: []const u8, date: []const u8) !void {
    try repository.git(&.{ "add", "--all" });
    var environment = std.process.Environ.Map.init(std.testing.allocator);
    defer environment.deinit();
    try environment.put("GIT_AUTHOR_NAME", "Test Author 雪");
    try environment.put("GIT_AUTHOR_EMAIL", "author@example.invalid");
    try environment.put("GIT_AUTHOR_DATE", "2000-01-01T00:00:00+00:00");
    try environment.put("GIT_COMMITTER_NAME", "Test Committer");
    try environment.put("GIT_COMMITTER_EMAIL", "committer@example.invalid");
    try environment.put("GIT_COMMITTER_DATE", date);
    const result = try std.process.run(std.testing.allocator, std.testing.io, .{
        .argv = &.{ "git", "-C", repository.root, "-c", "core.hooksPath=/dev/null", "commit", "--quiet", "--allow-empty", "--no-gpg-sign", "-m", message },
        .environ_map = &environment,
    });
    defer std.testing.allocator.free(result.stdout);
    defer std.testing.allocator.free(result.stderr);
    try std.testing.expect(git_process.exitedSuccessfully(result.term));
}

test "Git history limits results and returns newest commits with exact metadata" {
    var repository = try TestRepository.init(std.testing.allocator);
    defer repository.deinit();
    for (0..35) |i| {
        const message = try std.fmt.allocPrint(std.testing.allocator, "commit {d}\nsecond line\n\nbody", .{i});
        defer std.testing.allocator.free(message);
        // Increasing commit times make ordering independent of test speed.
        const date = try std.fmt.allocPrint(std.testing.allocator, "2026-10-27T18:{d:0>2}:00-04:00", .{i});
        defer std.testing.allocator.free(date);
        try commitAt(&repository, message, date);
    }
    var provider: GitProvider = .{ .allocator = std.testing.allocator };
    const result = try provider.interface().listCommits(std.testing.io, repository.root);
    defer result.deinit();
    try std.testing.expectEqual(@as(usize, 30), result.commits.len);
    for (result.commits, 0..) |commit, i| {
        const expected = try std.fmt.allocPrint(std.testing.allocator, "commit {d}", .{34 - i});
        defer std.testing.allocator.free(expected);
        try std.testing.expectEqualStrings(expected, commit.subject);
        try std.testing.expectEqualStrings("Test Author 雪", commit.authorName);
        const revision = try std.fmt.allocPrint(std.testing.allocator, "HEAD~{d}", .{i});
        defer std.testing.allocator.free(revision);
        const sha = try repository.revision(revision);
        defer std.testing.allocator.free(sha);
        try std.testing.expectEqualStrings(sha, commit.sha);
    }
    try std.testing.expectEqualStrings("2026-10-27T18:34:00-04:00", result.commits[0].commitDate);
}

test "Git history handles empty repositories, detached HEAD, and later HEAD changes" {
    var repository = try TestRepository.init(std.testing.allocator);
    defer repository.deinit();
    var provider: GitProvider = .{ .allocator = std.testing.allocator };
    const empty = try provider.interface().listCommits(std.testing.io, repository.root);
    defer empty.deinit();
    try std.testing.expectEqual(@as(usize, 0), empty.commits.len);
    try commitAt(&repository, "first", "2026-10-27T10:00:00+00:00");
    const first = try provider.interface().listCommits(std.testing.io, repository.root);
    defer first.deinit();
    try std.testing.expectEqual(@as(usize, 1), first.commits.len);
    try repository.git(&.{ "checkout", "--quiet", "--detach" });
    try commitAt(&repository, "second", "2026-10-27T11:00:00+00:00");
    const second = try provider.interface().listCommits(std.testing.io, repository.root);
    defer second.deinit();
    try std.testing.expectEqual(@as(usize, 2), second.commits.len);
    try std.testing.expectEqualStrings("second", second.commits[0].subject);
    try std.testing.expectEqualStrings(first.commits[0].sha, second.commits[1].sha);
    try repository.git(&.{ "reset", "--quiet", "--hard", "HEAD~1" });
    const reset = try provider.interface().listCommits(std.testing.io, repository.root);
    defer reset.deinit();
    try std.testing.expectEqual(@as(usize, 1), reset.commits.len);
    try std.testing.expectEqualStrings(first.commits[0].sha, reset.commits[0].sha);
}

test "Git history includes both merge parents in date order and excludes other branches" {
    var repository = try TestRepository.init(std.testing.allocator);
    defer repository.deinit();
    try commitAt(&repository, "root", "2026-10-27T10:00:00+00:00");
    try repository.git(&.{ "checkout", "--quiet", "-b", "side" });
    try commitAt(&repository, "side", "2026-10-27T12:00:00+00:00");
    const side = try repository.revision("HEAD");
    defer std.testing.allocator.free(side);
    try repository.git(&.{ "checkout", "--quiet", "-b", "other", "HEAD~1" });
    try commitAt(&repository, "unreachable", "2026-10-27T14:00:00+00:00");
    try repository.git(&.{ "checkout", "--quiet", "-b", "review", "HEAD~1" });
    try commitAt(&repository, "main", "2026-10-27T11:00:00+00:00");
    try repository.git(&.{ "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "merge", "--quiet", "--no-ff", "--no-commit", "side" });
    try commitAt(&repository, "merge", "2026-10-27T13:00:00+00:00");
    var provider: GitProvider = .{ .allocator = std.testing.allocator };
    const result = try provider.interface().listCommits(std.testing.io, repository.root);
    defer result.deinit();
    try std.testing.expectEqual(@as(usize, 4), result.commits.len);
    for (result.commits, [_][]const u8{ "merge", "side", "main", "root" }) |commit, subject| {
        try std.testing.expectEqualStrings(subject, commit.subject);
    }
    try std.testing.expectEqualStrings(side, result.commits[1].sha);
}

test "Git history reports missing Git, failed commands, invalid repositories, and corrupt HEAD" {
    var repository = try TestRepository.init(std.testing.allocator);
    defer repository.deinit();
    var provider: GitProvider = .{ .allocator = std.testing.allocator, .executable = "/rvw-missing-git" };
    try std.testing.expectError(error.RepositoryUnavailable, provider.interface().listCommits(std.testing.io, repository.root));
    provider.executable = "relative-git";
    try std.testing.expectError(error.RepositoryUnavailable, provider.interface().listCommits(std.testing.io, repository.root));
    provider.executable = "/usr/bin/false";
    try std.testing.expectError(error.RepositoryFailed, provider.interface().listCommits(std.testing.io, repository.root));
    provider.executable = "/usr/bin/true";
    try std.testing.expectError(error.InvalidCommitHistory, provider.interface().listCommits(std.testing.io, repository.root));
    provider.executable = null;
    try std.testing.expectError(error.RepositoryFailed, provider.interface().listCommits(std.testing.io, "/rvw-missing-repository"));
    var temporary = std.testing.tmpDir(.{});
    defer temporary.cleanup();
    // Block Git discovery of the repository above .zig-cache/tmp.
    try temporary.dir.writeFile(std.testing.io, .{ .sub_path = ".git", .data = "gitdir: missing\n" });
    const non_repository = try temporary.dir.realPathFileAlloc(std.testing.io, ".", std.testing.allocator);
    defer std.testing.allocator.free(non_repository);
    try std.testing.expectError(error.RepositoryFailed, provider.interface().listCommits(std.testing.io, non_repository));
    try repository.write(".git/HEAD", "ref: refs/heads/broken\n");
    try repository.write(".git/refs/heads/broken", "invalid object ID\n");
    try std.testing.expectError(error.RepositoryFailed, provider.interface().listCommits(std.testing.io, repository.root));
    try repository.write(".git/HEAD", "0123456789abcdef0123456789abcdef01234567\n");
    try std.testing.expectError(error.RepositoryFailed, provider.interface().listCommits(std.testing.io, repository.root));
}

test "Git history releases request storage after log failures" {
    var repository = try TestRepository.init(std.testing.allocator);
    defer repository.deinit();
    const path = try std.fs.path.join(std.testing.allocator, &.{ repository.root, "fake-git" });
    defer std.testing.allocator.free(path);
    var provider: GitProvider = .{ .allocator = std.testing.allocator, .executable = path };
    const prefix =
        "#!/bin/sh\ncase \"$*\" in\n*rev-parse*) printf '%s\\n' '0123456789abcdef0123456789abcdef01234567';;\n";
    for ([_]struct { script: []const u8, failure: anyerror }{
        .{ .script = prefix ++ "*) exit 2;;\nesac\n", .failure = error.RepositoryFailed },
        .{ .script = prefix ++ "*) printf 'malformed history';;\nesac\n", .failure = error.InvalidCommitHistory },
        .{ .script = prefix ++ "*) exit 0;;\nesac\n", .failure = error.InvalidCommitHistory },
    }) |case| {
        try repository.write("fake-git", case.script);
        var file = try repository.temporary.dir.openFile(std.testing.io, "fake-git", .{});
        defer file.close(std.testing.io);
        try file.setPermissions(std.testing.io, .executable_file);
        try std.testing.expectError(case.failure, provider.interface().listCommits(std.testing.io, repository.root));
    }
}

test "Git history parser rejects incomplete records, invalid UTF-8, and excess results" {
    const sha = "0123456789abcdef0123456789abcdef01234567";
    const date = "2026-10-27T18:00:00-04:00";
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();
    for ([_][]const u8{
        "missing delimiters",
        sha ++ "\x00subject\x00author\x00" ++ date,
        sha ++ "\x00subject\x00\xff\x00" ++ date ++ "\x00",
        sha ++ "\x00subject\x00author\x00" ++ date ++ "\x00extra",
    }) |invalid| {
        try std.testing.expectError(error.InvalidCommitHistory, parseHistory(allocator, invalid));
    }
    const valid = sha ++ "\x00\x00author\x00" ++ date ++ "\x00";
    try std.testing.expectError(error.InvalidCommitHistory, parseHistory(allocator, valid ** 31));
}

test "working-tree summaries match ordinary reviews for all change types without writes" {
    var repository = try TestRepository.init(std.testing.allocator);
    defer repository.deinit();
    try repository.write(".gitignore", "ignored.txt\n");
    try repository.write("binary.dat", "before\x00\n");
    try repository.write("deleted.txt", "removed\n");
    try repository.write("mixed.txt", "base\n");
    try repository.write("old.txt", "rename content\n");
    try repository.write("staged.txt", "base\n");
    try repository.write("unstaged.txt", "base\n");
    try repository.commit("base");
    try repository.write("staged.txt", "staged\n");
    try repository.write("mixed.txt", "staged\n");
    try repository.git(&.{ "add", "staged.txt", "mixed.txt" });
    try repository.write("mixed.txt", "final\nextra\n");
    try repository.write("unstaged.txt", "unstaged\n");
    try repository.write("binary.dat", "after\x00\n");
    try repository.temporary.dir.deleteFile(std.testing.io, "deleted.txt");
    try repository.git(&.{ "mv", "old.txt", "renamed.txt" });
    try repository.write("untracked.txt", "one\ntwo\n");
    try repository.write("untracked-binary.dat", "\x00data");
    try repository.write("ignored.txt", "ignored\n");

    const index_before = try repository.temporary.dir.readFileAlloc(std.testing.io, ".git/index", std.testing.allocator, .limited(1024 * 1024));
    defer std.testing.allocator.free(index_before);
    var provider: GitProvider = .{ .allocator = std.testing.allocator };
    const result = try provider.interface().listWorkingTreeChanges(std.testing.io, repository.root);
    defer result.deinit();
    const expected = [_]model.FileSummary{
        .{ .path = "binary.dat", .status = .modified, .additions = null, .deletions = null },
        .{ .path = "deleted.txt", .status = .deleted, .additions = 0, .deletions = 1 },
        .{ .path = "mixed.txt", .status = .modified, .additions = 2, .deletions = 1 },
        .{ .path = "renamed.txt", .previousPath = "old.txt", .status = .renamed, .additions = 0, .deletions = 0 },
        .{ .path = "staged.txt", .status = .modified, .additions = 1, .deletions = 1 },
        .{ .path = "unstaged.txt", .status = .modified, .additions = 1, .deletions = 1 },
        .{ .path = "untracked-binary.dat", .status = .added, .additions = null, .deletions = null },
        .{ .path = "untracked.txt", .status = .added, .additions = 2, .deletions = 0 },
    };
    try std.testing.expectEqualDeep(@as([]const model.FileSummary, &expected), result.files);
    const index_after = try repository.temporary.dir.readFileAlloc(std.testing.io, ".git/index", std.testing.allocator, .limited(1024 * 1024));
    defer std.testing.allocator.free(index_after);
    try std.testing.expectEqualSlices(u8, index_before, index_after);

    var review = try @import("../diff/git.zig").GitProvider.init(std.testing.allocator, std.testing.io, repository.root, null, null);
    defer review.deinit();
    try std.testing.expectEqualDeep(review.overview.files, result.files);
    const mixed = try repository.temporary.dir.readFileAlloc(std.testing.io, "mixed.txt", std.testing.allocator, .limited(1024));
    defer std.testing.allocator.free(mixed);
    try std.testing.expectEqualStrings("final\nextra\n", mixed);
}

test "working-tree summaries read current HEAD and changes on each request" {
    var repository = try TestRepository.init(std.testing.allocator);
    defer repository.deinit();
    try repository.write("tracked.txt", "base\n");
    try repository.commit("base");
    var provider: GitProvider = .{ .allocator = std.testing.allocator };
    const clean = try provider.interface().listWorkingTreeChanges(std.testing.io, repository.root);
    defer clean.deinit();
    try std.testing.expectEqual(@as(usize, 0), clean.files.len);
    try repository.write("tracked.txt", "changed\n");
    const first = try provider.interface().listWorkingTreeChanges(std.testing.io, repository.root);
    defer first.deinit();
    try std.testing.expectEqual(@as(usize, 1), first.files.len);
    try repository.commit("new HEAD");
    const next = try provider.interface().listWorkingTreeChanges(std.testing.io, repository.root);
    defer next.deinit();
    try std.testing.expectEqual(@as(usize, 0), next.files.len);
    try repository.write("later.txt", "new\n");
    const later = try provider.interface().listWorkingTreeChanges(std.testing.io, repository.root);
    defer later.deinit();
    try std.testing.expectEqual(@as(usize, 1), later.files.len);
    try std.testing.expectEqualStrings("later.txt", later.files[0].path);
    // Earlier results keep their storage until the caller releases them.
    try std.testing.expectEqualStrings("tracked.txt", first.files[0].path);
}

test "working-tree summaries define errors for Git failures and absent HEAD" {
    var repository = try TestRepository.init(std.testing.allocator);
    defer repository.deinit();
    var provider: GitProvider = .{ .allocator = std.testing.allocator };
    try std.testing.expectError(error.InvalidRevision, provider.interface().listWorkingTreeChanges(std.testing.io, repository.root));
    try std.testing.expectError(error.InvalidRevision, @import("../diff/git.zig").GitProvider.init(std.testing.allocator, std.testing.io, repository.root, null, null));
    provider.executable = "/rvw-missing-git";
    try std.testing.expectError(error.RepositoryUnavailable, provider.interface().listWorkingTreeChanges(std.testing.io, repository.root));
    provider.executable = "relative-git";
    try std.testing.expectError(error.RepositoryUnavailable, provider.interface().listWorkingTreeChanges(std.testing.io, repository.root));
    provider.executable = "/usr/bin/false";
    try std.testing.expectError(error.WorkingTreeChangesFailed, provider.interface().listWorkingTreeChanges(std.testing.io, repository.root));
    provider.executable = "/usr/bin/true";
    try std.testing.expectError(error.WorkingTreeChangesFailed, provider.interface().listWorkingTreeChanges(std.testing.io, repository.root));
    provider.executable = null;
    try std.testing.expectError(error.WorkingTreeChangesFailed, provider.interface().listWorkingTreeChanges(std.testing.io, "/rvw-missing-repository"));
    try repository.write(".git/HEAD", "invalid HEAD\n");
    try std.testing.expectError(error.WorkingTreeChangesFailed, provider.interface().listWorkingTreeChanges(std.testing.io, repository.root));
}

test "working-tree summaries release storage after command, path, and parsing failures" {
    var repository = try TestRepository.init(std.testing.allocator);
    defer repository.deinit();
    const executable = try std.fs.path.join(std.testing.allocator, &.{ repository.root, "fake-git" });
    defer std.testing.allocator.free(executable);
    var provider: GitProvider = .{ .allocator = std.testing.allocator, .executable = executable };
    const prefix = "#!/bin/sh\ncase \"$*\" in\n*--show-toplevel*) printf '%s\\n' \"$5\";;\n*rev-parse*) printf '%s\\n' '0123456789abcdef0123456789abcdef01234567';;\n";
    for ([_]struct { script: []const u8, failure: anyerror }{
        .{ .script = prefix ++ "*) exit 2;;\nesac\n", .failure = error.WorkingTreeChangesFailed },
        .{ .script = prefix ++ "*) printf 'malformed metadata';;\nesac\n", .failure = error.MalformedGitOutput },
        .{ .script = prefix ++ "*) printf ':100644 100644 a b M\\000\\377\\0001\\t1\\t\\377\\000';;\nesac\n", .failure = error.UnsupportedPath },
        .{ .script = prefix ++ "*) printf ':100644 100644 a b M\\000file\\000bad\\t1\\tfile\\000';;\nesac\n", .failure = error.MalformedGitOutput },
        .{ .script = prefix ++ "*diff*) exit 0;;\n*) exit 2;;\nesac\n", .failure = error.WorkingTreeChangesFailed },
        .{ .script = prefix ++ "*diff*) exit 0;;\n*) printf 'missing-file\\000';;\nesac\n", .failure = error.WorkingTreeChangesFailed },
    }) |case| {
        try repository.write("fake-git", case.script);
        var file = try repository.temporary.dir.openFile(std.testing.io, "fake-git", .{});
        defer file.close(std.testing.io);
        try file.setPermissions(std.testing.io, .executable_file);
        try std.testing.expectError(case.failure, provider.interface().listWorkingTreeChanges(std.testing.io, repository.root));
    }
}

test "working-tree summaries release request and serialization storage on allocation failures" {
    var repository = try TestRepository.init(std.testing.allocator);
    defer repository.deinit();
    try repository.write("tracked.txt", "base\n");
    try repository.commit("base");
    try repository.write("tracked.txt", "changed\n");
    try repository.write("new.txt", "untracked\n");
    const Test = struct {
        fn run(allocator: std.mem.Allocator, directory: []const u8) !void {
            var provider: GitProvider = .{ .allocator = allocator };
            const result = try provider.interface().listWorkingTreeChanges(std.testing.io, directory);
            defer result.deinit();
            const encoded = try std.json.Stringify.valueAlloc(allocator, result, .{});
            defer allocator.free(encoded);
        }
    };
    try std.testing.checkAllAllocationFailures(std.testing.allocator, Test.run, .{repository.root});
}
