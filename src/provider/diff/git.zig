const std = @import("std");
const model = @import("../../app/model.zig");
const diff_provider = @import("interface.zig");
const repository = @import("../../util/repository.zig");
const snapshot_module = @import("git/snapshot.zig");
const metadata = @import("git/metadata.zig");
const file = @import("git/file.zig");

const Allocator = std.mem.Allocator;
const Io = std.Io;

pub const GitProvider = struct {
    arena: std.heap.ArenaAllocator,
    overview: model.DiffOverview,
    file_contents: []const model.FileContent,

    pub fn init(backing_allocator: Allocator, io: Io, path: []const u8, range: ?[]const u8) !GitProvider {
        var arena = std.heap.ArenaAllocator.init(backing_allocator);
        errdefer arena.deinit();
        const allocator = arena.allocator();

        const root = try repository.validateRoot(io, allocator, path);
        const snapshot = try snapshot_module.resolve(allocator, io, root, range);
        const changes = try metadata.enumerate(allocator, io, root, snapshot);

        const diff_id = if (snapshot.head) |head|
            try std.fmt.allocPrint(allocator, "{s}..{s}", .{ snapshot.base, head })
        else
            try std.fmt.allocPrint(allocator, "working-tree:{s}", .{snapshot.base});

        var summaries: std.ArrayList(model.FileSummary) = .empty;
        var file_contents: std.ArrayList(model.FileContent) = .empty;
        for (changes) |change| {
            try summaries.append(allocator, .{
                .path = change.path,
                .previousPath = change.previous_path,
                .status = change.status,
                .additions = change.additions,
                .deletions = change.deletions,
            });
            try file_contents.append(allocator, try file.buildContent(allocator, io, root, snapshot, change));
        }

        const source: model.DiffSource = if (snapshot.head) |head|
            .{ .commit_range = .{ .base = snapshot.base, .head = head } }
        else
            .{ .working_tree = .{ .base = snapshot.base } };
        const overview: model.DiffOverview = .{
            .id = diff_id,
            .repository = .{ .name = std.fs.path.basename(root) },
            .source = source,
            .initialPath = if (summaries.items.len == 0) null else summaries.items[0].path,
            .files = try summaries.toOwnedSlice(allocator),
        };

        return .{
            .arena = arena,
            .overview = overview,
            .file_contents = try file_contents.toOwnedSlice(allocator),
        };
    }

    pub fn deinit(self: *GitProvider) void {
        self.arena.deinit();
        self.* = undefined;
    }

    pub fn interface(self: *GitProvider) diff_provider.DiffProvider {
        return .{ .context = self, .vtable = &vtable };
    }

    fn getDiffOverview(context: *anyopaque, _: Io) !model.DiffOverview {
        const self: *GitProvider = @ptrCast(@alignCast(context));
        return self.overview;
    }

    fn getFileDiff(context: *anyopaque, _: Io, diff_id: []const u8, path: []const u8) !model.FileDiff {
        const self: *GitProvider = @ptrCast(@alignCast(context));
        if (!std.mem.eql(u8, diff_id, self.overview.id)) return error.UnknownDiff;
        for (self.overview.files, self.file_contents) |summary, content| {
            if (std.mem.eql(u8, summary.path, path)) return .{
                .path = summary.path,
                .previousPath = summary.previousPath,
                .status = summary.status,
                .content = content,
            };
        }
        return error.UnknownFile;
    }

    const vtable: diff_provider.DiffProvider.VTable = .{
        .getDiffOverview = getDiffOverview,
        .getFileDiff = getFileDiff,
    };
};

pub fn errorMessage(err: anyerror) []const u8 {
    return switch (err) {
        error.RepositoryPathMissing => "repository path does not exist",
        error.NotDirectory => "repository path is not a directory",
        error.NotGitRepository => "path is not a Git worktree",
        error.NotRepositoryRoot => "path must be the Git worktree root",
        error.GitNotFound => "git is not available on PATH",
        error.InvalidRange => "range must contain exactly two revisions separated by '..'",
        error.InvalidRevision => "range contains an unknown or non-commit revision",
        error.UnsupportedPath => "repository contains a changed path that is not valid UTF-8",
        error.GitOutputTooLarge => "Git change metadata exceeds the supported size",
        error.GitCommandFailed, error.MalformedGitOutput => "Git could not produce the diff snapshot",
        else => @errorName(err),
    };
}

test {
    _ = @import("git/snapshot.zig");
    _ = @import("git/metadata.zig");
    _ = @import("git/content.zig");
    _ = @import("git/process.zig");
}

test "Git provider builds a deterministic working-tree review from a temporary repository" {
    const TestRepository = @import("../../testing/repository.zig").Repository;
    var fixture = try TestRepository.init(std.testing.allocator);
    defer fixture.deinit();

    try fixture.write("deleted.txt", "removed\n");
    try fixture.write("modified.txt", "before\n");
    try fixture.commit("initial snapshot");
    try fixture.temporary.dir.deleteFile(std.testing.io, "deleted.txt");
    try fixture.write("modified.txt", "after\n");
    try fixture.write("untracked.txt", "one\ntwo\n");

    var provider = try GitProvider.init(
        std.testing.allocator,
        std.testing.io,
        fixture.root,
        null,
    );
    defer provider.deinit();
    const diffs = provider.interface();
    const overview = try diffs.getDiffOverview(std.testing.io);

    try std.testing.expect(std.mem.startsWith(u8, overview.id, "working-tree:"));
    try std.testing.expectEqualStrings(std.fs.path.basename(fixture.root), overview.repository.name);
    try std.testing.expectEqualStrings("deleted.txt", overview.initialPath.?);
    try std.testing.expectEqual(@as(usize, 3), overview.files.len);
    try expectSummary(overview.files[0], "deleted.txt", .deleted, 0, 1);
    try expectSummary(overview.files[1], "modified.txt", .modified, 1, 1);
    try expectSummary(overview.files[2], "untracked.txt", .added, 2, 0);

    const deleted = try diffs.getFileDiff(std.testing.io, overview.id, "deleted.txt");
    try std.testing.expectEqualStrings("removed\n", deleted.content.diff.oldFile.?.contents);
    try std.testing.expect(deleted.content.diff.newFile == null);

    const modified = try diffs.getFileDiff(std.testing.io, overview.id, "modified.txt");
    try std.testing.expectEqualStrings("before\n", modified.content.diff.oldFile.?.contents);
    try std.testing.expectEqualStrings("after\n", modified.content.diff.newFile.?.contents);

    const untracked = try diffs.getFileDiff(std.testing.io, overview.id, "untracked.txt");
    try std.testing.expect(untracked.content.diff.oldFile == null);
    try std.testing.expectEqualStrings("one\ntwo\n", untracked.content.diff.newFile.?.contents);
    try std.testing.expectError(
        error.UnknownDiff,
        diffs.getFileDiff(std.testing.io, "stale-diff", "modified.txt"),
    );
    try std.testing.expectError(
        error.UnknownFile,
        diffs.getFileDiff(std.testing.io, overview.id, "missing.txt"),
    );
}

test "Git provider resolves explicit commit ranges independently of the working tree" {
    const TestRepository = @import("../../testing/repository.zig").Repository;
    var fixture = try TestRepository.init(std.testing.allocator);
    defer fixture.deinit();

    try fixture.write("renamed.txt", "base\n");
    try fixture.commit("base snapshot");
    const base = try fixture.revision("HEAD");
    defer std.testing.allocator.free(base);

    try fixture.git(&.{ "mv", "renamed.txt", "current.txt" });
    try fixture.write("current.txt", "base\nhead\n");
    try fixture.commit("head snapshot");
    const head = try fixture.revision("HEAD");
    defer std.testing.allocator.free(head);
    try fixture.write("current.txt", "uncommitted content must not leak\n");

    const range = try std.fmt.allocPrint(std.testing.allocator, "{s}..{s}", .{ base, head });
    defer std.testing.allocator.free(range);
    var provider = try GitProvider.init(
        std.testing.allocator,
        std.testing.io,
        fixture.root,
        range,
    );
    defer provider.deinit();
    const diffs = provider.interface();
    const overview = try diffs.getDiffOverview(std.testing.io);

    try std.testing.expectEqualStrings(range, overview.id);
    try std.testing.expectEqualStrings(base, overview.source.commit_range.base);
    try std.testing.expectEqualStrings(head, overview.source.commit_range.head);
    try std.testing.expectEqual(@as(usize, 1), overview.files.len);
    try std.testing.expectEqual(model.FileStatus.renamed, overview.files[0].status);
    try std.testing.expectEqualStrings("renamed.txt", overview.files[0].previousPath.?);
    try std.testing.expectEqualStrings("current.txt", overview.files[0].path);

    const renamed = try diffs.getFileDiff(std.testing.io, overview.id, "current.txt");
    try std.testing.expectEqualStrings("renamed.txt", renamed.previousPath.?);
    try std.testing.expectEqualStrings("base\n", renamed.content.diff.oldFile.?.contents);
    try std.testing.expectEqualStrings("base\nhead\n", renamed.content.diff.newFile.?.contents);
}

fn expectSummary(
    summary: model.FileSummary,
    path: []const u8,
    status: model.FileStatus,
    additions: ?usize,
    deletions: ?usize,
) !void {
    try std.testing.expectEqualStrings(path, summary.path);
    try std.testing.expectEqual(status, summary.status);
    try std.testing.expectEqual(additions, summary.additions);
    try std.testing.expectEqual(deletions, summary.deletions);
}
