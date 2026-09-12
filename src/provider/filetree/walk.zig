const std = @import("std");
const filetree_provider = @import("interface.zig");

const Allocator = std.mem.Allocator;
const Io = std.Io;

pub const WalkFileTreeProvider = struct {
    arena: std.heap.ArenaAllocator,
    root: std.Io.Dir,
    io: Io,
    files: []const []const u8,

    pub fn init(backing_allocator: Allocator, io: Io, path: []const u8) !WalkFileTreeProvider {
        var arena = std.heap.ArenaAllocator.init(backing_allocator);
        errdefer arena.deinit();

        var root = std.Io.Dir.cwd().openDir(io, path, .{ .iterate = true }) catch |err| switch (err) {
            error.FileNotFound => return error.RepositoryPathMissing,
            error.NotDir => return error.NotDirectory,
            else => |unexpected| return unexpected,
        };
        errdefer root.close(io);

        const files = try enumerateFiles(arena.allocator(), io, root);
        return .{
            .arena = arena,
            .root = root,
            .io = io,
            .files = files,
        };
    }

    pub fn deinit(self: *WalkFileTreeProvider) void {
        self.root.close(self.io);
        self.arena.deinit();
        self.* = undefined;
    }

    pub fn interface(self: *WalkFileTreeProvider) filetree_provider.FileTreeProvider {
        return .{ .context = self, .vtable = &vtable };
    }

    fn getFiles(context: *anyopaque, _: Io) ![]const []const u8 {
        const self: *WalkFileTreeProvider = @ptrCast(@alignCast(context));
        return self.files;
    }

    const vtable: filetree_provider.FileTreeProvider.VTable = .{
        .getFiles = getFiles,
    };
};

pub fn enumerateFiles(allocator: Allocator, io: Io, root: std.Io.Dir) ![]const []const u8 {
    var files: std.ArrayList([]const u8) = .empty;
    var walker = try root.walkSelectively(allocator);
    defer walker.deinit();

    while (try walker.next(io)) |entry| {
        if (entry.depth() == 1 and std.mem.eql(u8, entry.basename, ".git")) continue;
        if (entry.kind == .directory) {
            if (!std.mem.eql(u8, entry.basename, ".git")) try walker.enter(io, entry);
            continue;
        }
        if (entry.kind != .file and entry.kind != .sym_link) continue;
        if (!std.unicode.utf8ValidateSlice(entry.path)) return error.UnsupportedPath;

        const owned_path = try allocator.dupe(u8, entry.path);
        for (owned_path) |*byte| {
            if (byte.* == std.fs.path.sep) byte.* = '/';
        }
        try files.append(allocator, owned_path);
    }

    std.mem.sort([]const u8, files.items, {}, lessThanPath);
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

test "walk tree enumerates repository files without traversing Git or symlinks" {
    const TestRepository = @import("../../testing/repository.zig").Repository;
    var repository = try TestRepository.init(std.testing.allocator);
    defer repository.deinit();

    try repository.write(".gitignore", "ignored.cache\n");
    try repository.write(".hidden", "hidden\n");
    try repository.write("ignored.cache", "local cache\n");
    try repository.write("nested/file.txt", "nested\n");
    try repository.temporary.dir.symLink(
        std.testing.io,
        "nested/file.txt",
        "linked-file",
        .{},
    );
    try repository.temporary.dir.symLink(
        std.testing.io,
        "nested",
        "linked-directory",
        .{ .is_directory = true },
    );

    var provider = try WalkFileTreeProvider.init(
        std.testing.allocator,
        std.testing.io,
        repository.root,
    );
    defer provider.deinit();
    const files = try provider.interface().getFiles(std.testing.io);

    const expected = [_][]const u8{
        ".gitignore",
        ".hidden",
        "ignored.cache",
        "linked-directory",
        "linked-file",
        "nested/file.txt",
    };
    try std.testing.expectEqual(expected.len, files.len);
    for (expected, files) |expected_path, actual_path| {
        try std.testing.expectEqualStrings(expected_path, actual_path);
    }
    try std.testing.expect(!containsPath(files, ".git/HEAD"));
    try std.testing.expect(!containsPath(files, "linked-directory/file.txt"));
}
