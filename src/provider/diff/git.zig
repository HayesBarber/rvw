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
