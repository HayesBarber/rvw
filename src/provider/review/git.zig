const std = @import("std");
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
    active: *Snapshot,

    const Snapshot = struct {
        git: diff.GitProvider,
        all_files: walk.WalkFileTreeProvider,
        visible_files: gitignore.GitignoreFileTreeProvider,
        files: file.FilesystemFileProvider,

        fn init(allocator: Allocator, io: Io, path: []const u8, range: ?[]const u8) !*Snapshot {
            const snapshot = try allocator.create(Snapshot);
            errdefer allocator.destroy(snapshot);

            snapshot.git = try diff.GitProvider.init(allocator, io, path, range);
            errdefer snapshot.git.deinit();
            snapshot.all_files = try walk.WalkFileTreeProvider.init(allocator, io, path);
            errdefer snapshot.all_files.deinit();
            snapshot.visible_files = try gitignore.GitignoreFileTreeProvider.init(allocator, io, path);
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

    pub fn init(backing_allocator: Allocator, io: Io, path: []const u8, range: ?[]const u8) !GitReviewProvider {
        var arena = std.heap.ArenaAllocator.init(backing_allocator);
        errdefer arena.deinit();
        const active = try Snapshot.init(backing_allocator, io, path, range);
        errdefer active.deinit(backing_allocator);
        const repository_path = try arena.allocator().dupe(u8, active.git.repository_root);
        const owned_range = if (range) |value| try arena.allocator().dupe(u8, value) else null;
        return .{
            .arena = arena,
            .backing_allocator = backing_allocator,
            .repository_path = repository_path,
            .range = owned_range,
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
