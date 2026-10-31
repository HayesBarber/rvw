const std = @import("std");
const default_executables = @import("../../config/executables.zig").defaults;
const model = @import("../../app/model.zig");
const diff = @import("../diff/git.zig");
const file = @import("../file/filesystem.zig");
const gitignore = @import("../filetree/gitignore.zig");
const walk = @import("../filetree/walk.zig");
const review = @import("interface.zig");

const Allocator = std.mem.Allocator;
const Io = std.Io;

/// Retains the source arguments and atomically replaces all repository-backed
/// caches after a complete new snapshot has been constructed.
pub const GitReviewProvider = struct {
    arena: std.heap.ArenaAllocator,
    backing_allocator: Allocator,
    repository_path: []const u8,
    range: ?[]const u8,
    pr: ?u32,
    executable: []const u8,
    active: *Snapshot,

    const Snapshot = struct {
        git: diff.GitProvider,
        all_files: walk.WalkFileTreeProvider,
        visible_files: gitignore.GitignoreFileTreeProvider,
        files: file.FilesystemFileProvider,

        fn init(allocator: Allocator, io: Io, path: []const u8, range: ?[]const u8, pr: ?u32, executable: []const u8) !*Snapshot {
            const snapshot = try allocator.create(Snapshot);
            errdefer allocator.destroy(snapshot);

            snapshot.git = try diff.GitProvider.init(allocator, io, path, range, pr, executable);
            errdefer snapshot.git.deinit();
            snapshot.all_files = try walk.WalkFileTreeProvider.init(allocator, io, path);
            errdefer snapshot.all_files.deinit();
            snapshot.visible_files = try gitignore.GitignoreFileTreeProvider.init(allocator, io, path, executable);
            errdefer snapshot.visible_files.deinit();
            snapshot.files = try file.FilesystemFileProvider.init(
                allocator,
                io,
                path,
                snapshot.all_files.interface(),
            );
            return snapshot;
        }

        fn deinit(self: *Snapshot, allocator: Allocator) void {
            self.files.deinit();
            self.visible_files.deinit();
            self.all_files.deinit();
            self.git.deinit();
            allocator.destroy(self);
        }
    };

    pub fn init(backing_allocator: Allocator, io: Io, path: []const u8, range: ?[]const u8, pr: ?u32, executable: []const u8) !GitReviewProvider {
        var arena = std.heap.ArenaAllocator.init(backing_allocator);
        errdefer arena.deinit();
        const active = try Snapshot.init(backing_allocator, io, path, range, pr, executable);
        errdefer active.deinit(backing_allocator);
        const repository_path = try arena.allocator().dupe(u8, active.git.repository_root);
        const owned_range = if (range) |value| try arena.allocator().dupe(u8, value) else null;
        const owned_executable = try arena.allocator().dupe(u8, executable);
        return .{
            .arena = arena,
            .backing_allocator = backing_allocator,
            .repository_path = repository_path,
            .range = owned_range,
            .pr = pr,
            .executable = owned_executable,
            .active = active,
        };
    }

    pub fn deinit(self: *GitReviewProvider) void {
        self.active.deinit(self.backing_allocator);
        self.arena.deinit();
        self.* = undefined;
    }

    pub fn interface(self: *GitReviewProvider) review.ReviewProvider {
        return .{ .context = self, .vtable = &vtable };
    }

    fn getDiffOverview(context: *anyopaque, io: Io) !model.DiffOverview {
        const self: *GitReviewProvider = @ptrCast(@alignCast(context));
        return self.active.git.interface().getDiffOverview(io);
    }

    fn getFileDiff(context: *anyopaque, io: Io, diff_id: []const u8, path: []const u8) !model.FileDiff {
        const self: *GitReviewProvider = @ptrCast(@alignCast(context));
        return self.active.git.interface().getFileDiff(io, diff_id, path);
    }

    fn getFiles(context: *anyopaque, io: Io) ![]const []const u8 {
        const self: *GitReviewProvider = @ptrCast(@alignCast(context));
        return self.active.all_files.interface().getFiles(io);
    }

    fn getFilesNotIgnored(context: *anyopaque, io: Io) ![]const []const u8 {
        const self: *GitReviewProvider = @ptrCast(@alignCast(context));
        return self.active.visible_files.interface().getFiles(io);
    }

    fn getFile(context: *anyopaque, io: Io, path: []const u8) !model.FileContent {
        const self: *GitReviewProvider = @ptrCast(@alignCast(context));
        return self.active.files.interface().getFile(io, path);
    }

    fn reload(context: *anyopaque, io: Io) !void {
        const self: *GitReviewProvider = @ptrCast(@alignCast(context));
        const replacement = try Snapshot.init(
            self.backing_allocator,
            io,
            self.repository_path,
            self.range,
            self.pr,
            self.executable,
        );
        const previous = self.active;
        self.active = replacement;
        previous.deinit(self.backing_allocator);
    }

    fn repositoryRoot(context: *anyopaque) []const u8 {
        const self: *GitReviewProvider = @ptrCast(@alignCast(context));
        return self.active.git.repository_root;
    }

    const vtable: review.ReviewProvider.VTable = .{
        .getDiffOverview = getDiffOverview,
        .getFileDiff = getFileDiff,
        .getFiles = getFiles,
        .getFilesNotIgnored = getFilesNotIgnored,
        .getFile = getFile,
        .reload = reload,
        .repositoryRoot = repositoryRoot,
    };
};

test "selected Git handles every review stage and remains selected on reload" {
    const Repository = @import("../../testing/repository.zig").Repository;
    const allocator = std.testing.allocator;
    const io = std.testing.io;
    var repository = try Repository.init(allocator);
    defer repository.deinit();
    try repository.write(".gitignore", "ignored.txt\n");
    try repository.write("file.txt", "base\n");
    try repository.commit("base");
    try repository.write("file.txt", "head\n");
    try repository.commit("head");
    try repository.write("file.txt", "working\n");
    try repository.write("ignored.txt", "ignored\n");
    try repository.write("untracked.txt", "untracked\n");
    const executable = try repository.writeExecutable(".git/tools with spaces/custom git",
        \\#!/bin/sh
        \\printf '%s\n' "$*" >> "$0.calls"
        \\exec git "$@"
        \\
    );
    defer allocator.free(executable);
    var provider = try GitReviewProvider.init(allocator, io, repository.root, null, null, executable);
    defer provider.deinit();
    const reviews = provider.interface();
    const overview = try reviews.getDiffOverview(io);
    const initial = try reviews.getFileDiff(io, overview.id, "file.txt");
    try std.testing.expectEqualStrings("head\n", initial.content.diff.oldFile.?.contents);
    try std.testing.expectEqualStrings("working\n", initial.content.diff.newFile.?.contents);
    const files = try reviews.getFilesNotIgnored(io);
    for (files) |path| try std.testing.expect(!std.mem.eql(u8, path, "ignored.txt"));
    const calls = try repository.temporary.dir.readFileAlloc(io, ".git/tools with spaces/custom git.calls", allocator, .unlimited);
    defer allocator.free(calls);
    // Root discovery, HEAD, metadata, untracked files, old contents, visible files.
    try std.testing.expectEqual(@as(usize, 6), std.mem.count(u8, calls, "\n"));
    for ([_][]const u8{ "--show-toplevel", "HEAD^{commit}", " diff ", "ls-files --others", " show ", "ls-files --cached" }) |command| {
        try std.testing.expect(std.mem.indexOf(u8, calls, command) != null);
    }
    try repository.write("file.txt", "reloaded\n");
    try reviews.reload(io);
    const reloaded = try reviews.getFileDiff(io, overview.id, "file.txt");
    try std.testing.expectEqualStrings("reloaded\n", reloaded.content.diff.newFile.?.contents);
    try repository.temporary.dir.deleteFile(io, ".git/tools with spaces/custom git");
    try std.testing.expectError(error.GitNotFound, reviews.reload(io));
    const retained = try reviews.getFileDiff(io, overview.id, "file.txt");
    try std.testing.expectEqualStrings("reloaded\n", retained.content.diff.newFile.?.contents);

    const replacement = try repository.writeExecutable(".git/tools with spaces/custom git",
        \\#!/bin/sh
        \\printf '%s\n' "$*" >> "$0.range-calls"
        \\exec git "$@"
        \\
    );
    defer allocator.free(replacement);
    var ranged = try GitReviewProvider.init(allocator, io, repository.root, "HEAD~1..HEAD", null, executable);
    defer ranged.deinit();
    const ranged_overview = try ranged.interface().getDiffOverview(io);
    const committed = try ranged.interface().getFileDiff(io, ranged_overview.id, "file.txt");
    try std.testing.expectEqualStrings("base\n", committed.content.diff.oldFile.?.contents);
    try std.testing.expectEqualStrings("head\n", committed.content.diff.newFile.?.contents);
    const range_calls = try repository.temporary.dir.readFileAlloc(io, ".git/tools with spaces/custom git.range-calls", allocator, .unlimited);
    defer allocator.free(range_calls);
    // Root discovery, both revisions, metadata, both contents, visible files.
    try std.testing.expectEqual(@as(usize, 7), std.mem.count(u8, range_calls, "\n"));
}

test "selected Git failures at each review stage do not use another executable" {
    const Repository = @import("../../testing/repository.zig").Repository;
    const allocator = std.testing.allocator;
    const io = std.testing.io;
    var repository = try Repository.init(allocator);
    defer repository.deinit();
    try repository.write("file.txt", "before\n");
    try repository.commit("base");
    try repository.write("file.txt", "after\n");
    for ([_]struct { pattern: []const u8, expected: anyerror }{
        .{ .pattern = "*--show-toplevel*", .expected = error.NotGitRepository },
        .{ .pattern = "*HEAD*", .expected = error.InvalidRevision },
        .{ .pattern = "*' diff '*", .expected = error.GitCommandFailed },
        .{ .pattern = "*'ls-files --others'*", .expected = error.GitCommandFailed },
        .{ .pattern = "*' show '*", .expected = error.GitCommandFailed },
        .{ .pattern = "*'ls-files --cached'*", .expected = error.GitCommandFailed },
    }) |case| {
        const script = try std.fmt.allocPrint(allocator, "#!/bin/sh\ncase \"$*\" in {s}) exit 7;; esac\nexec git \"$@\"\n", .{case.pattern});
        defer allocator.free(script);
        const executable = try repository.writeExecutable(".git/failing git", script);
        defer allocator.free(executable);
        try std.testing.expectError(case.expected, GitReviewProvider.init(allocator, io, repository.root, null, null, executable));
    }
    try std.testing.expectError(error.GitNotFound, GitReviewProvider.init(allocator, io, repository.root, null, null, "/rvw-missing-git"));
    try repository.write(".git/not executable", "not executable\n");
    const not_executable = try std.fs.path.join(allocator, &.{ repository.root, ".git/not executable" });
    defer allocator.free(not_executable);
    try std.testing.expectError(error.AccessDenied, GitReviewProvider.init(allocator, io, repository.root, null, null, not_executable));
}

test "reload swaps in new working-tree contents" {
    const TestRepository = @import("../../testing/repository.zig").Repository;
    var repository = try TestRepository.init(std.testing.allocator);
    defer repository.deinit();

    try repository.write("changed.txt", "original\n");
    try repository.commit("initial");
    try repository.write("changed.txt", "first\n");

    var provider = try GitReviewProvider.init(
        std.testing.allocator,
        std.testing.io,
        repository.root,
        null,
        null,
        default_executables.git,
    );
    defer provider.deinit();
    const reviews = provider.interface();
    const initial = try reviews.getDiffOverview(std.testing.io);
    const first = try reviews.getFileDiff(std.testing.io, initial.id, "changed.txt");
    try std.testing.expectEqualStrings("first\n", first.content.diff.newFile.?.contents);

    try repository.write("changed.txt", "second\n");
    try reviews.reload(std.testing.io);
    const refreshed = try reviews.getDiffOverview(std.testing.io);
    const second = try reviews.getFileDiff(std.testing.io, refreshed.id, "changed.txt");
    try std.testing.expectEqualStrings("second\n", second.content.diff.newFile.?.contents);
}

test "failed reload leaves the prior snapshot usable" {
    const TestRepository = @import("../../testing/repository.zig").Repository;
    var repository = try TestRepository.init(std.testing.allocator);
    defer repository.deinit();

    try repository.write("changed.txt", "original\n");
    try repository.commit("initial");
    try repository.write("changed.txt", "changed\n");

    var provider = try GitReviewProvider.init(
        std.testing.allocator,
        std.testing.io,
        repository.root,
        null,
        null,
        default_executables.git,
    );
    defer provider.deinit();
    const reviews = provider.interface();
    const original_id = (try reviews.getDiffOverview(std.testing.io)).id;

    try repository.temporary.dir.deleteTree(std.testing.io, ".git");
    try std.testing.expectError(error.NotRepositoryRoot, reviews.reload(std.testing.io));
    try std.testing.expectEqualStrings(
        original_id,
        (try reviews.getDiffOverview(std.testing.io)).id,
    );
}

test "reload re-resolves symbolic ranges while explicit commit ranges stay fixed" {
    const TestRepository = @import("../../testing/repository.zig").Repository;
    var repository = try TestRepository.init(std.testing.allocator);
    defer repository.deinit();

    try repository.write("file.txt", "one\n");
    try repository.commit("one");
    const first_commit = try repository.revision("HEAD");
    defer std.testing.allocator.free(first_commit);
    try repository.write("file.txt", "two\n");
    try repository.commit("two");
    const second_commit = try repository.revision("HEAD");
    defer std.testing.allocator.free(second_commit);

    var symbolic = try GitReviewProvider.init(
        std.testing.allocator,
        std.testing.io,
        repository.root,
        "HEAD~1..HEAD",
        null,
        default_executables.git,
    );
    defer symbolic.deinit();
    const explicit_range = try std.fmt.allocPrint(
        std.testing.allocator,
        "{s}..{s}",
        .{ first_commit, second_commit },
    );
    defer std.testing.allocator.free(explicit_range);
    var explicit = try GitReviewProvider.init(
        std.testing.allocator,
        std.testing.io,
        repository.root,
        explicit_range,
        null,
        default_executables.git,
    );
    defer explicit.deinit();
    const explicit_id = (try explicit.interface().getDiffOverview(std.testing.io)).id;

    try repository.write("file.txt", "three\n");
    try repository.commit("three");
    const third_commit = try repository.revision("HEAD");
    defer std.testing.allocator.free(third_commit);
    try symbolic.interface().reload(std.testing.io);
    try explicit.interface().reload(std.testing.io);

    const symbolic_source = (try symbolic.interface().getDiffOverview(std.testing.io)).source.commit_range;
    try std.testing.expectEqualStrings(second_commit, symbolic_source.base);
    try std.testing.expectEqualStrings(third_commit, symbolic_source.head);
    try std.testing.expectEqualStrings(
        explicit_id,
        (try explicit.interface().getDiffOverview(std.testing.io)).id,
    );
}

test "PR source survives snapshot reload and serializes for transports" {
    const Repository = @import("../../testing/repository.zig").Repository;
    var repository = try Repository.init(std.testing.allocator);
    defer repository.deinit();
    try repository.write("file.txt", "base\n");
    try repository.commit("base");
    try repository.write("file.txt", "head\n");
    try repository.commit("head");
    var provider = try GitReviewProvider.init(std.testing.allocator, std.testing.io, repository.root, "HEAD~1..HEAD", 100, default_executables.git);
    defer provider.deinit();
    for (0..2) |_| {
        const overview = try provider.interface().getDiffOverview(std.testing.io);
        try std.testing.expectEqual(@as(u32, 100), overview.source.pull_request.number);
        try std.testing.expectEqualStrings("PR #100", overview.sourceLabel);
        try std.testing.expectEqualStrings("PR #100", overview.compactSourceLabel);
        try std.testing.expectEqual(@as(usize, 1), overview.files.len);
        const json = try std.json.Stringify.valueAlloc(std.testing.allocator, overview.source, .{});
        defer std.testing.allocator.free(json);
        const parsed = try std.json.parseFromSlice(struct { kind: []const u8, number: u32 }, std.testing.allocator, json, .{});
        defer parsed.deinit();
        try std.testing.expectEqualStrings("pull-request", parsed.value.kind);
        try std.testing.expectEqual(@as(u32, 100), parsed.value.number);
        try provider.interface().reload(std.testing.io);
    }
}
