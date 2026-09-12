const std = @import("std");
const model = @import("../../app/model.zig");
const file_provider = @import("interface.zig");
const filetree_provider = @import("../filetree/interface.zig");

const Allocator = std.mem.Allocator;
const Io = std.Io;

pub const maximum_text_size = 512 * 1024;

pub const FilesystemFileProvider = struct {
    arena: std.heap.ArenaAllocator,
    root: std.Io.Dir,
    io: Io,
    files: []const []const u8,
    mutex: std.Io.Mutex = .init,

    pub fn init(
        backing_allocator: Allocator,
        io: Io,
        path: []const u8,
        tree: filetree_provider.FileTreeProvider,
    ) !FilesystemFileProvider {
        var arena = std.heap.ArenaAllocator.init(backing_allocator);
        errdefer arena.deinit();

        var root = std.Io.Dir.cwd().openDir(io, path, .{ .iterate = true }) catch |err| switch (err) {
            error.FileNotFound => return error.RepositoryPathMissing,
            error.NotDir => return error.NotDirectory,
            else => |unexpected| return unexpected,
        };
        errdefer root.close(io);

        const files = try snapshotFiles(arena.allocator(), io, tree);
        return .{
            .arena = arena,
            .root = root,
            .io = io,
            .files = files,
        };
    }

    pub fn deinit(self: *FilesystemFileProvider) void {
        self.root.close(self.io);
        self.arena.deinit();
        self.* = undefined;
    }

    pub fn interface(self: *FilesystemFileProvider) file_provider.FileProvider {
        return .{ .context = self, .vtable = &vtable };
    }

    fn getFile(context: *anyopaque, io: Io, path: []const u8) !model.FileContent {
        const self: *FilesystemFileProvider = @ptrCast(@alignCast(context));
        if (!validRequestPath(path)) return error.UnknownFile;
        const known_path = findPath(self.files, path) orelse return error.UnknownFile;

        self.mutex.lockUncancelable(io);
        defer self.mutex.unlock(io);

        const metadata = self.root.statFile(io, known_path, .{ .follow_symlinks = false }) catch |err| switch (err) {
            error.FileNotFound, error.NotDir => return error.UnknownFile,
            else => |unexpected| return unexpected,
        };
        switch (metadata.kind) {
            .sym_link => return unavailable(.symlink),
            .file => {},
            else => return unavailable(.binary),
        }
        if (metadata.size > maximum_text_size) return unavailable(.too_large);

        var file = self.root.openFile(io, known_path, .{
            .allow_directory = false,
            .follow_symlinks = false,
            .resolve_beneath = true,
        }) catch |err| switch (err) {
            error.FileNotFound, error.NotDir, error.IsDir => return error.UnknownFile,
            error.SymLinkLoop => return unavailable(.symlink),
            else => |unexpected| return unexpected,
        };
        defer file.close(io);

        var reader = file.reader(io, &.{});
        const contents = reader.interface.allocRemaining(
            self.arena.allocator(),
            .limited(maximum_text_size),
        ) catch |err| switch (err) {
            error.StreamTooLong => return unavailable(.too_large),
            else => |unexpected| return unexpected,
        };
        if (std.mem.indexOfScalar(u8, contents, 0) != null) return unavailable(.binary);
        if (!std.unicode.utf8ValidateSlice(contents)) return unavailable(.invalid_utf8);
        return .{ .file = .{ .file = .{ .name = known_path, .contents = contents } } };
    }

    const vtable: file_provider.FileProvider.VTable = .{
        .getFile = getFile,
    };
};

pub const FileSystemProvider = FilesystemFileProvider;
pub const FilesystemProvider = FilesystemFileProvider;

fn snapshotFiles(
    allocator: Allocator,
    io: Io,
    tree: filetree_provider.FileTreeProvider,
) ![]const []const u8 {
    const source = try tree.getFiles(io);
    const owned = try allocator.alloc([]const u8, source.len);
    for (source, 0..) |path, index| {
        owned[index] = try allocator.dupe(u8, path);
    }
    return owned;
}

fn validRequestPath(path: []const u8) bool {
    if (path.len == 0 or !std.unicode.utf8ValidateSlice(path)) return false;
    if (std.fs.path.isAbsolute(path) or path[0] == '/' or std.mem.indexOfScalar(u8, path, '\\') != null) return false;

    var components = std.mem.splitScalar(u8, path, '/');
    while (components.next()) |component| {
        if (component.len == 0 or
            std.mem.eql(u8, component, ".") or
            std.mem.eql(u8, component, "..")) return false;
    }
    return true;
}

fn findPath(files: []const []const u8, path: []const u8) ?[]const u8 {
    for (files) |known| {
        if (std.mem.eql(u8, known, path)) return known;
    }
    return null;
}

fn unavailable(reason: model.UnavailableReason) model.FileContent {
    return .{ .unavailable = .{ .reason = reason } };
}

test "content provider classifies reads and rejects unsafe paths" {
    const TestRepository = @import("../../testing/repository.zig").Repository;
    const tree_provider = @import("../filetree/walk.zig");
    var repository = try TestRepository.init(std.testing.allocator);
    defer repository.deinit();

    try repository.write("nested/text.txt", "review me\n");
    try repository.write("binary.dat", "before\x00after");
    try repository.write("invalid.txt", "\xff");
    const too_large = try std.testing.allocator.alloc(u8, maximum_text_size + 1);
    defer std.testing.allocator.free(too_large);
    @memset(too_large, 'x');
    try repository.write("nested/too-large.txt", too_large);
    try repository.temporary.dir.symLink(
        std.testing.io,
        "nested/text.txt",
        "linked-text",
        .{},
    );

    var tree = try tree_provider.WalkFileTreeProvider.init(
        std.testing.allocator,
        std.testing.io,
        repository.root,
    );
    defer tree.deinit();
    var provider = try FilesystemFileProvider.init(
        std.testing.allocator,
        std.testing.io,
        repository.root,
        tree.interface(),
    );
    defer provider.deinit();
    const files = provider.interface();

    const text = (try files.getFile(std.testing.io, "nested/text.txt")).file.file;
    try std.testing.expectEqualStrings("nested/text.txt", text.name);
    try std.testing.expectEqualStrings("review me\n", text.contents);
    try std.testing.expectEqual(
        model.UnavailableReason.binary,
        (try files.getFile(std.testing.io, "binary.dat")).unavailable.reason,
    );
    try std.testing.expectEqual(
        model.UnavailableReason.invalid_utf8,
        (try files.getFile(std.testing.io, "invalid.txt")).unavailable.reason,
    );
    try std.testing.expectEqual(
        model.UnavailableReason.symlink,
        (try files.getFile(std.testing.io, "linked-text")).unavailable.reason,
    );
    try std.testing.expectEqual(
        model.UnavailableReason.too_large,
        (try files.getFile(std.testing.io, "nested/too-large.txt")).unavailable.reason,
    );

    for ([_][]const u8{ "", "missing.txt", "../nested/text.txt", "/nested/text.txt" }) |path| {
        try std.testing.expectError(error.UnknownFile, files.getFile(std.testing.io, path));
    }
}