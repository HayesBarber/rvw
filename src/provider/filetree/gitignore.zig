const std = @import("std");
const filetree_provider = @import("interface.zig");
const walk = @import("walk.zig");
const process = @import("../../util/git_process.zig");

const Allocator = std.mem.Allocator;
const Io = std.Io;

pub const GitignoreFileTreeProvider = struct {
    arena: std.heap.ArenaAllocator,
    root: std.Io.Dir,
    io: Io,
    files: []const []const u8,

    pub fn init(backing_allocator: Allocator, io: Io, path: []const u8) !GitignoreFileTreeProvider {
        var arena = std.heap.ArenaAllocator.init(backing_allocator);
        errdefer arena.deinit();

        var root = std.Io.Dir.cwd().openDir(io, path, .{ .iterate = true }) catch |err| switch (err) {
            error.FileNotFound => return error.RepositoryPathMissing,
            error.NotDir => return error.NotDirectory,
            else => |unexpected| return unexpected,
        };
        errdefer root.close(io);

        const files = try resolveFiles(arena.allocator(), io, root, path);
        return .{
            .arena = arena,
            .root = root,
            .io = io,
            .files = files,
        };
    }

    pub fn deinit(self: *GitignoreFileTreeProvider) void {
        self.root.close(self.io);
        self.arena.deinit();
        self.* = undefined;
    }

    pub fn interface(self: *GitignoreFileTreeProvider) filetree_provider.FileTreeProvider {
        return .{ .context = self, .vtable = &vtable };
    }

    fn getFiles(context: *anyopaque, _: Io) ![]const []const u8 {
        const self: *GitignoreFileTreeProvider = @ptrCast(@alignCast(context));
        return self.files;
    }

    const vtable: filetree_provider.FileTreeProvider.VTable = .{
        .getFiles = getFiles,
    };
};

fn resolveFiles(allocator: Allocator, io: Io, root: std.Io.Dir, path: []const u8) ![]const []const u8 {
    const candidates = gitLsFiles(allocator, io, root, path) catch |err| switch (err) {
        error.GitNotFound, error.GitOutputTooLarge, error.GitCommandFailed => return walk.enumerateFiles(allocator, io, root),
        else => |unexpected| return unexpected,
    };

    std.mem.sort([]const u8, candidates, {}, lessThanPath);
    return candidates;
}

/// Enumerates the Git working set (tracked files plus untracked, not-ignored
/// files) and prunes entries that no longer exist on disk or are not plain
/// files. Falls back to a full walk when Git is unavailable.
fn gitLsFiles(allocator: Allocator, io: Io, root: std.Io.Dir, path: []const u8) ![][]const u8 {
    const output = try process.run(
        allocator,
        io,
        &.{ "git", "-C", path, "ls-files", "--cached", "--others", "--exclude-standard", "-z", "--" },
        process.maximum_metadata_size,
    );
    defer allocator.free(output);

    var files: std.ArrayList([]const u8) = .empty;
    var entries = std.mem.splitScalar(u8, output, 0);
    while (entries.next()) |entry| {
        if (entry.len == 0) continue;
        if (!std.unicode.utf8ValidateSlice(entry)) return error.UnsupportedPath;

        const metadata = root.statFile(io, entry, .{ .follow_symlinks = false }) catch continue;
        if (metadata.kind != .file and metadata.kind != .sym_link) continue;

        const owned_path = try allocator.dupe(u8, entry);
        for (owned_path) |*byte| {
            if (byte.* == std.fs.path.sep) byte.* = '/';
        }
        try files.append(allocator, owned_path);
    }
    return files.toOwnedSlice(allocator);
}

fn lessThanPath(_: void, left: []const u8, right: []const u8) bool {
    return std.mem.lessThan(u8, left, right);
}

fn containsPath(files: []const []const u8, path: []const u8) bool {
    for (files) |known| {
        if (std.mem.eql(u8, known, path)) return true;
    }
    return false;
}

test "gitignore tree excludes ignored untracked files but keeps tracked ones" {
    const TestRepository = @import("../../testing/repository.zig").Repository;
    var repository = try TestRepository.init(std.testing.allocator);
    defer repository.deinit();

    try repository.write(".gitignore", "ignored.cache\n");
    try repository.write("tracked.txt", "tracked\n");
    try repository.commit("initial snapshot");
    try repository.write("ignored.cache", "local cache\n");
    try repository.write("tracked-does-not-match-gitignore.txt", "visible\n");
    try repository.write("visible.txt", "visible\n");

    var provider = try GitignoreFileTreeProvider.init(
        std.testing.allocator,
        std.testing.io,
        repository.root,
    );
    defer provider.deinit();
    const files = try provider.interface().getFiles(std.testing.io);

    try std.testing.expect(containsPath(files, ".gitignore"));
    try std.testing.expect(containsPath(files, "tracked.txt"));
    try std.testing.expect(containsPath(files, "visible.txt"));
    try std.testing.expect(!containsPath(files, "ignored.cache"));
}

test "gitignore tree lists tracked files that are gitignored" {
    const TestRepository = @import("../../testing/repository.zig").Repository;
    var repository = try TestRepository.init(std.testing.allocator);
    defer repository.deinit();

    try repository.write("generated.dat", "generated\n");
    try repository.commit("initial snapshot");
    try repository.write(".gitignore", "generated.dat\n");

    var provider = try GitignoreFileTreeProvider.init(
        std.testing.allocator,
        std.testing.io,
        repository.root,
    );
    defer provider.deinit();
    const files = try provider.interface().getFiles(std.testing.io);

    try std.testing.expect(containsPath(files, "generated.dat"));
    try std.testing.expect(containsPath(files, ".gitignore"));
}

test "gitignore tree prunes deleted-but-tracked index entries" {
    const TestRepository = @import("../../testing/repository.zig").Repository;
    var repository = try TestRepository.init(std.testing.allocator);
    defer repository.deinit();

    try repository.write("deleted.txt", "removed\n");
    try repository.write("kept.txt", "kept\n");
    try repository.commit("initial snapshot");
    try repository.temporary.dir.deleteFile(std.testing.io, "deleted.txt");

    var provider = try GitignoreFileTreeProvider.init(
        std.testing.allocator,
        std.testing.io,
        repository.root,
    );
    defer provider.deinit();
    const files = try provider.interface().getFiles(std.testing.io);

    try std.testing.expect(containsPath(files, "kept.txt"));
    try std.testing.expect(!containsPath(files, "deleted.txt"));
}

test "gitignore tree falls back to a full walk outside a Git repository" {
    const io = std.testing.io;
    const os_tmp = std.mem.span(std.c.getenv("TMPDIR") orelse "/tmp");
    var parent = try std.Io.Dir.cwd().openDir(io, os_tmp, .{ .iterate = true });
    defer parent.close(io);

    var random_bytes: [9]u8 = undefined;
    io.random(&random_bytes);
    var name_buffer: [16]u8 = undefined;
    const name = std.base64.url_safe.Encoder.encode(&name_buffer, &random_bytes);
    var dir = try parent.createDirPathOpen(io, name, .{ .open_options = .{ .iterate = true } });
    defer dir.close(io);
    defer parent.deleteTree(io, name) catch {};

    try dir.createDirPath(io, "nested");
    try dir.writeFile(io, .{
        .sub_path = "nested/file.txt",
        .data = "nested\n",
    });
    try dir.writeFile(io, .{
        .sub_path = "top.txt",
        .data = "top\n",
    });

    const root = try parent.realPathFileAlloc(io, name, std.testing.allocator);
    defer std.testing.allocator.free(root);
    var provider = try GitignoreFileTreeProvider.init(
        std.testing.allocator,
        std.testing.io,
        root,
    );
    defer provider.deinit();

    const files = try provider.interface().getFiles(std.testing.io);
    try std.testing.expect(containsPath(files, "nested/file.txt"));
    try std.testing.expect(containsPath(files, "top.txt"));
}