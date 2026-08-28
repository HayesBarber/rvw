const std = @import("std");
const model = @import("../../app/model.zig");
const file_provider = @import("interface.zig");

const Allocator = std.mem.Allocator;
const Io = std.Io;

pub const maximum_text_size = 512 * 1024;

pub const FilesystemProvider = struct {
    arena: std.heap.ArenaAllocator,
    root: std.Io.Dir,
    io: Io,
    files: []const []const u8,
    mutex: std.Io.Mutex = .init,

    pub fn init(backing_allocator: Allocator, io: Io, path: []const u8) !FilesystemProvider {
        var arena = std.heap.ArenaAllocator.init(backing_allocator);
        errdefer arena.deinit();

        var root = std.Io.Dir.cwd().openDir(io, path, .{ .iterate = true }) catch |err| switch (err) {
            error.FileNotFound => return error.RepositoryPathMissing,
            error.NotDir => return error.NotDirectory,
            else => |unexpected| return unexpected,
        };
        errdefer root.close(io);

        return .{
            .arena = arena,
            .root = root,
            .io = io,
            .files = try enumerateFiles(arena.allocator(), io, root),
        };
    }

    pub fn deinit(self: *FilesystemProvider) void {
        self.root.close(self.io);
        self.arena.deinit();
        self.* = undefined;
    }

    pub fn interface(self: *FilesystemProvider) file_provider.FileProvider {
        return .{ .context = self, .vtable = &vtable };
    }

    fn getFiles(context: *anyopaque, _: Io) ![]const []const u8 {
        const self: *FilesystemProvider = @ptrCast(@alignCast(context));
        return self.files;
    }

    fn getFile(context: *anyopaque, io: Io, path: []const u8) !model.FileContent {
        const self: *FilesystemProvider = @ptrCast(@alignCast(context));
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
        .getFiles = getFiles,
        .getFile = getFile,
    };
};

pub const FileSystemProvider = FilesystemProvider;

fn enumerateFiles(allocator: Allocator, io: Io, root: std.Io.Dir) ![]const []const u8 {
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

fn containsPath(files: []const []const u8, path: []const u8) bool {
    return findPath(files, path) != null;
}

fn unavailable(reason: model.UnavailableReason) model.FileContent {
    return .{ .unavailable = .{ .reason = reason } };
}

fn lessThanPath(_: void, left: []const u8, right: []const u8) bool {
    return std.mem.lessThan(u8, left, right);
}

test "filesystem provider lists repository files recursively in deterministic order" {
    var tmp = std.testing.tmpDir(.{ .iterate = true });
    defer tmp.cleanup();
    const io = std.testing.io;

    try tmp.dir.createDirPath(io, "nested/deeper");
    try tmp.dir.createDirPath(io, ".git/objects");
    try tmp.dir.writeFile(io, .{ .sub_path = "z.txt", .data = "z" });
    try tmp.dir.writeFile(io, .{ .sub_path = ".ignored", .data = "hidden" });
    try tmp.dir.writeFile(io, .{ .sub_path = "nested/a.txt", .data = "a" });
    try tmp.dir.writeFile(io, .{ .sub_path = "nested/deeper/b.txt", .data = "b" });
    try tmp.dir.writeFile(io, .{ .sub_path = ".git/config", .data = "excluded" });

    const root_path = try tmp.dir.realPathFileAlloc(io, ".", std.testing.allocator);
    defer std.testing.allocator.free(root_path);
    var provider = try FilesystemProvider.init(std.testing.allocator, io, root_path);
    defer provider.deinit();

    const expected: []const []const u8 = &.{
        ".ignored",
        "nested/a.txt",
        "nested/deeper/b.txt",
        "z.txt",
    };
    const actual = try provider.interface().getFiles(io);
    try std.testing.expectEqual(expected.len, actual.len);
    for (expected, actual) |expected_path, actual_path| {
        try std.testing.expectEqualStrings(expected_path, actual_path);
    }
}

test "filesystem provider does not traverse directory symlinks and reports file symlinks" {
    var tmp = std.testing.tmpDir(.{ .iterate = true });
    defer tmp.cleanup();
    const io = std.testing.io;

    try tmp.dir.createDirPath(io, "target");
    try tmp.dir.writeFile(io, .{ .sub_path = "target/inside.txt", .data = "inside" });
    try tmp.dir.symLink(io, "target", "linked-directory", .{ .is_directory = true });
    try tmp.dir.symLink(io, "target/inside.txt", "linked-file", .{});

    const root_path = try tmp.dir.realPathFileAlloc(io, ".", std.testing.allocator);
    defer std.testing.allocator.free(root_path);
    var provider = try FilesystemProvider.init(std.testing.allocator, io, root_path);
    defer provider.deinit();

    const paths = try provider.interface().getFiles(io);
    try std.testing.expect(containsPath(paths, "linked-directory"));
    try std.testing.expect(!containsPath(paths, "linked-directory/inside.txt"));
    try std.testing.expect(containsPath(paths, "linked-file"));
    try expectUnavailable(.symlink, try provider.interface().getFile(io, "linked-file"));
}

test "filesystem provider loads known text and rejects unsafe or unknown paths" {
    var tmp = std.testing.tmpDir(.{ .iterate = true });
    defer tmp.cleanup();
    const io = std.testing.io;

    try tmp.dir.createDirPath(io, "src");
    try tmp.dir.writeFile(io, .{ .sub_path = "src/main.zig", .data = "pub fn main() void {}\n" });

    const root_path = try tmp.dir.realPathFileAlloc(io, ".", std.testing.allocator);
    defer std.testing.allocator.free(root_path);
    var provider = try FilesystemProvider.init(std.testing.allocator, io, root_path);
    defer provider.deinit();
    const interface = provider.interface();

    const loaded = try interface.getFile(io, "src/main.zig");
    switch (loaded) {
        .file => |content| {
            try std.testing.expectEqualStrings("src/main.zig", content.file.name);
            try std.testing.expectEqualStrings("pub fn main() void {}\n", content.file.contents);
        },
        else => return error.UnexpectedFileContent,
    }

    try std.testing.expectError(error.UnknownFile, interface.getFile(io, ""));
    try std.testing.expectError(error.UnknownFile, interface.getFile(io, "missing.txt"));
    try std.testing.expectError(error.UnknownFile, interface.getFile(io, "/etc/passwd"));
    try std.testing.expectError(error.UnknownFile, interface.getFile(io, "../outside.txt"));
    try std.testing.expectError(error.UnknownFile, interface.getFile(io, "src/../src/main.zig"));
    try std.testing.expectError(error.UnknownFile, interface.getFile(io, "src\\main.zig"));
}

test "filesystem provider classifies unsupported file contents" {
    var tmp = std.testing.tmpDir(.{ .iterate = true });
    defer tmp.cleanup();
    const io = std.testing.io;

    try tmp.dir.writeFile(io, .{ .sub_path = "binary", .data = "before\x00after" });
    try tmp.dir.writeFile(io, .{ .sub_path = "invalid-utf8", .data = "\xff" });
    const oversized = try std.testing.allocator.alloc(u8, maximum_text_size + 1);
    defer std.testing.allocator.free(oversized);
    @memset(oversized, 'a');
    try tmp.dir.writeFile(io, .{ .sub_path = "oversized", .data = oversized });

    const root_path = try tmp.dir.realPathFileAlloc(io, ".", std.testing.allocator);
    defer std.testing.allocator.free(root_path);
    var provider = try FilesystemProvider.init(std.testing.allocator, io, root_path);
    defer provider.deinit();
    const interface = provider.interface();

    try expectUnavailable(.binary, try interface.getFile(io, "binary"));
    try expectUnavailable(.invalid_utf8, try interface.getFile(io, "invalid-utf8"));
    try expectUnavailable(.too_large, try interface.getFile(io, "oversized"));
}

fn expectUnavailable(expected: model.UnavailableReason, content: model.FileContent) !void {
    switch (content) {
        .unavailable => |details| try std.testing.expectEqual(expected, details.reason),
        else => return error.ExpectedUnavailable,
    }
}
