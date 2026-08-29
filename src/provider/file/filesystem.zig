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
