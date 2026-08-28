const std = @import("std");
const model = @import("../app/model.zig");
const provider = @import("interface.zig");
const repository = @import("../repository.zig");

const Allocator = std.mem.Allocator;
const Io = std.Io;

const maximum_text_size = 512 * 1024;
const maximum_metadata_size = 16 * 1024 * 1024;

const Change = struct {
    path: []const u8,
    previous_path: ?[]const u8 = null,
    status: model.FileStatus,
    additions: ?usize = 0,
    deletions: ?usize = 0,
    unavailable: ?model.UnavailableReason = null,
};

const Snapshot = struct {
    base: []const u8,
    head: ?[]const u8 = null,
};

const Loaded = union(enum) {
    contents: model.FileContents,
    unavailable: model.UnavailableReason,
};

pub const GitProvider = struct {
    arena: std.heap.ArenaAllocator,
    overview: model.ReviewOverview,
    file_contents: []const model.FileContent,

    pub fn init(backing_allocator: Allocator, io: Io, path: []const u8, range: ?[]const u8) !GitProvider {
        var arena = std.heap.ArenaAllocator.init(backing_allocator);
        errdefer arena.deinit();
        const allocator = arena.allocator();

        const root = try repository.validateRoot(io, allocator, path);
        const snapshot = if (range) |value|
            try parseRange(allocator, io, root, value)
        else
            Snapshot{ .base = try resolveCommit(allocator, io, root, "HEAD") };

        var changes = try trackedChanges(allocator, io, root, snapshot);
        if (snapshot.head == null) try appendUntracked(allocator, io, root, &changes);
        std.mem.sort(Change, changes.items, {}, lessThanChange);

        const review_id = if (snapshot.head) |head|
            try std.fmt.allocPrint(allocator, "{s}..{s}", .{ snapshot.base, head })
        else
            try std.fmt.allocPrint(allocator, "working-tree:{s}", .{snapshot.base});

        var summaries: std.ArrayList(model.FileSummary) = .empty;
        var file_contents: std.ArrayList(model.FileContent) = .empty;
        for (changes.items) |change| {
            try summaries.append(allocator, .{
                .path = change.path,
                .previousPath = change.previous_path,
                .status = change.status,
                .additions = change.additions,
                .deletions = change.deletions,
                .commentCount = 0,
            });
            try file_contents.append(allocator, try buildFileContent(allocator, io, root, snapshot, change));
        }

        const source: model.ReviewSource = if (snapshot.head) |head|
            .{ .commit_range = .{ .base = snapshot.base, .head = head } }
        else
            .{ .working_tree = .{ .base = snapshot.base } };
        const overview: model.ReviewOverview = .{
            .review = .{
                .id = review_id,
                .repository = .{ .name = std.fs.path.basename(root) },
                .source = source,
            },
            .initialPath = if (summaries.items.len == 0) null else summaries.items[0].path,
            .files = try summaries.toOwnedSlice(allocator),
            .comments = &.{},
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

    pub fn interface(self: *GitProvider) provider.ReviewProvider {
        return .{ .context = self, .vtable = &vtable };
    }

    fn getOverview(context: *anyopaque, _: Io) !model.ReviewOverview {
        const self: *GitProvider = @ptrCast(@alignCast(context));
        return self.overview;
    }

    fn getFileReview(context: *anyopaque, _: Io, review_id: []const u8, path: []const u8) !model.FileReview {
        const self: *GitProvider = @ptrCast(@alignCast(context));
        if (!std.mem.eql(u8, review_id, self.overview.review.id)) return error.UnknownReview;
        for (self.overview.files, self.file_contents) |file, content| {
            if (std.mem.eql(u8, file.path, path)) return .{
                .path = file.path,
                .previousPath = file.previousPath,
                .status = file.status,
                .content = content,
            };
        }
        return error.UnknownFile;
    }

    const vtable: provider.ReviewProvider.VTable = .{
        .getOverview = getOverview,
        .getFileReview = getFileReview,
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
        error.GitCommandFailed, error.MalformedGitOutput => "Git could not produce the review snapshot",
        else => @errorName(err),
    };
}

fn parseRange(allocator: Allocator, io: Io, root: []const u8, value: []const u8) !Snapshot {
    const separator = std.mem.indexOf(u8, value, "..") orelse return error.InvalidRange;
    if (separator == 0 or separator + 2 == value.len) return error.InvalidRange;
    if (std.mem.indexOf(u8, value[separator + 2 ..], "..") != null) return error.InvalidRange;
    if (value[separator + 2] == '.') return error.InvalidRange;

    const base = try resolveCommit(allocator, io, root, value[0..separator]);
    const head = try resolveCommit(allocator, io, root, value[separator + 2 ..]);
    return .{ .base = base, .head = head };
}

fn resolveCommit(allocator: Allocator, io: Io, root: []const u8, revision: []const u8) ![]const u8 {
    const commit = try std.fmt.allocPrint(allocator, "{s}^{{commit}}", .{revision});
    const output = runGit(allocator, io, &.{ "git", "-C", root, "rev-parse", "--verify", "--end-of-options", commit }, 4096) catch |err| switch (err) {
        error.GitCommandFailed, error.GitOutputTooLarge => return error.InvalidRevision,
        else => return err,
    };
    const oid = std.mem.trim(u8, output, " \t\r\n");
    if (oid.len == 0 or !std.unicode.utf8ValidateSlice(oid)) return error.InvalidRevision;
    return oid;
}

fn trackedChanges(allocator: Allocator, io: Io, root: []const u8, snapshot: Snapshot) !std.ArrayList(Change) {
    const output = if (snapshot.head) |head|
        try runGit(allocator, io, &.{ "git", "-C", root, "diff", "--no-ext-diff", "--no-textconv", "--raw", "--numstat", "-z", "--find-renames=50%", snapshot.base, head, "--" }, maximum_metadata_size * 2)
    else
        try runGit(allocator, io, &.{ "git", "-C", root, "diff", "--no-ext-diff", "--no-textconv", "--raw", "--numstat", "-z", "--find-renames=50%", snapshot.base, "--" }, maximum_metadata_size * 2);
    return parseChanges(allocator, output);
}

fn parseChanges(allocator: Allocator, output: []const u8) !std.ArrayList(Change) {
    var changes: std.ArrayList(Change) = .empty;
    var cursor: usize = 0;
    while (cursor < output.len and output[cursor] == ':') {
        try changes.append(allocator, try parseRawChange(output, &cursor));
    }
    for (changes.items) |*change| {
        try applyNumstat(change, output, &cursor);
    }
    if (cursor != output.len) return error.MalformedGitOutput;
    return changes;
}

fn parseRawChange(output: []const u8, cursor: *usize) !Change {
    const metadata = try nextZ(output, cursor);
    var fields = std.mem.tokenizeScalar(u8, metadata[1..], ' ');
    const old_mode = std.fmt.parseInt(u32, fields.next() orelse return error.MalformedGitOutput, 8) catch return error.MalformedGitOutput;
    const new_mode = std.fmt.parseInt(u32, fields.next() orelse return error.MalformedGitOutput, 8) catch return error.MalformedGitOutput;
    _ = fields.next() orelse return error.MalformedGitOutput;
    _ = fields.next() orelse return error.MalformedGitOutput;
    const status_value = fields.next() orelse return error.MalformedGitOutput;
    if (fields.next() != null or status_value.len == 0) return error.MalformedGitOutput;

    const first_path = try validPath(try nextZ(output, cursor));
    const status_code = status_value[0];
    const previous_path: ?[]const u8 = if (status_code == 'R') first_path else null;
    const path = if (status_code == 'R') try validPath(try nextZ(output, cursor)) else first_path;
    return .{
        .path = path,
        .previous_path = previous_path,
        .status = switch (status_code) {
            'A' => .added,
            'D' => .deleted,
            'R' => .renamed,
            else => .modified,
        },
        .unavailable = unavailableMode(old_mode) orelse unavailableMode(new_mode),
    };
}

fn applyNumstat(change: *Change, output: []const u8, cursor: *usize) !void {
    const record = try nextZ(output, cursor);
    const first_tab = std.mem.indexOfScalar(u8, record, '\t') orelse return error.MalformedGitOutput;
    const second_relative = std.mem.indexOfScalar(u8, record[first_tab + 1 ..], '\t') orelse return error.MalformedGitOutput;
    const second_tab = first_tab + 1 + second_relative;
    const inline_path = record[second_tab + 1 ..];
    const previous_path: ?[]const u8 = if (inline_path.len == 0) try validPath(try nextZ(output, cursor)) else null;
    const path = if (inline_path.len == 0) try validPath(try nextZ(output, cursor)) else try validPath(inline_path);
    if (!std.mem.eql(u8, change.path, path)) return error.MalformedGitOutput;
    if (previous_path) |previous| {
        if (change.previous_path == null or !std.mem.eql(u8, change.previous_path.?, previous)) return error.MalformedGitOutput;
    }
    change.additions = try parseCount(record[0..first_tab]);
    change.deletions = try parseCount(record[first_tab + 1 .. second_tab]);
    if ((change.additions == null or change.deletions == null) and change.unavailable == null) change.unavailable = .binary;
}

fn appendUntracked(allocator: Allocator, io: Io, root: []const u8, changes: *std.ArrayList(Change)) !void {
    const output = try runGit(allocator, io, &.{ "git", "-C", root, "ls-files", "--others", "--exclude-standard", "-z", "--" }, maximum_metadata_size);
    var cursor: usize = 0;
    var directory = try std.Io.Dir.openDirAbsolute(io, root, .{});
    defer directory.close(io);
    while (cursor < output.len) {
        const path = try validPath(try nextZ(output, &cursor));
        const stat = try directory.statFile(io, path, .{ .follow_symlinks = false });
        var additions: ?usize = null;
        if (stat.kind == .file and stat.size <= maximum_text_size) {
            const contents = try directory.readFileAlloc(io, path, allocator, .limited(maximum_text_size + 1));
            if (std.mem.indexOfScalar(u8, contents, 0) == null and std.unicode.utf8ValidateSlice(contents)) {
                additions = lineCount(contents);
            }
        }
        const unavailable_reason: ?model.UnavailableReason = switch (stat.kind) {
            .file => null,
            .sym_link => .symlink,
            else => .binary,
        };
        var replaced_deletion = false;
        for (changes.items) |*change| {
            if (change.status != .deleted or !std.mem.eql(u8, change.path, path)) continue;
            change.status = .modified;
            change.additions = additions;
            change.unavailable = change.unavailable orelse unavailable_reason;
            replaced_deletion = true;
            break;
        }
        if (replaced_deletion) continue;
        try changes.append(allocator, .{
            .path = path,
            .status = .added,
            .additions = additions,
            .deletions = if (additions == null) null else 0,
            .unavailable = unavailable_reason,
        });
    }
}

fn buildFileContent(allocator: Allocator, io: Io, root: []const u8, snapshot: Snapshot, change: Change) !model.FileContent {
    if (change.unavailable) |reason| return unavailable(reason);

    const old: ?Loaded = if (change.status == .added) null else try loadFile(allocator, io, root, snapshot.base, change.previous_path orelse change.path);
    const new: ?Loaded = if (change.status == .deleted)
        null
    else
        try loadFile(allocator, io, root, snapshot.head, change.path);

    if (old) |loaded| switch (loaded) {
        .unavailable => |reason| return unavailable(reason),
        .contents => {},
    };
    if (new) |loaded| switch (loaded) {
        .unavailable => |reason| return unavailable(reason),
        .contents => {},
    };

    return .{ .diff = .{
        .oldFile = if (old) |loaded| loaded.contents else null,
        .newFile = if (new) |loaded| loaded.contents else null,
    } };
}

fn loadFile(allocator: Allocator, io: Io, root: []const u8, commit: ?[]const u8, path: []const u8) !Loaded {
    const contents = if (commit) |oid| blk: {
        const object = try std.fmt.allocPrint(allocator, "{s}:{s}", .{ oid, path });
        break :blk runGit(allocator, io, &.{ "git", "-C", root, "show", "--no-textconv", object }, maximum_text_size + 1) catch |err| switch (err) {
            error.GitOutputTooLarge => return .{ .unavailable = .too_large },
            else => return err,
        };
    } else blk: {
        var directory = try std.Io.Dir.openDirAbsolute(io, root, .{});
        defer directory.close(io);
        break :blk directory.readFileAlloc(io, path, allocator, .limited(maximum_text_size + 1)) catch |err| switch (err) {
            error.StreamTooLong => return .{ .unavailable = .too_large },
            else => return err,
        };
    };
    return classifyContents(path, contents);
}

fn classifyContents(path: []const u8, contents: []const u8) Loaded {
    if (std.mem.indexOfScalar(u8, contents, 0) != null) return .{ .unavailable = .binary };
    if (!std.unicode.utf8ValidateSlice(contents)) return .{ .unavailable = .invalid_utf8 };
    return .{ .contents = .{ .name = path, .contents = contents } };
}

fn unavailable(reason: model.UnavailableReason) model.FileContent {
    return .{ .unavailable = .{ .reason = reason } };
}

fn unavailableMode(mode: u32) ?model.UnavailableReason {
    return switch (mode) {
        0, 0o100644, 0o100755 => null,
        0o120000 => .symlink,
        0o160000 => .submodule,
        else => .binary,
    };
}

fn runGit(allocator: Allocator, io: Io, argv: []const []const u8, limit: usize) ![]const u8 {
    const result = std.process.run(allocator, io, .{
        .argv = argv,
        .stdout_limit = .limited(limit),
        .stderr_limit = .limited(4096),
    }) catch |err| switch (err) {
        error.FileNotFound => return error.GitNotFound,
        error.StreamTooLong => return error.GitOutputTooLarge,
        else => |unexpected| return unexpected,
    };
    if (!exitedSuccessfully(result.term)) return error.GitCommandFailed;
    return result.stdout;
}

fn exitedSuccessfully(term: std.process.Child.Term) bool {
    return switch (term) {
        .exited => |status| status == 0,
        else => false,
    };
}

fn nextZ(output: []const u8, cursor: *usize) ![]const u8 {
    if (cursor.* >= output.len) return error.MalformedGitOutput;
    const relative_end = std.mem.indexOfScalar(u8, output[cursor.*..], 0) orelse return error.MalformedGitOutput;
    const value = output[cursor.* .. cursor.* + relative_end];
    cursor.* += relative_end + 1;
    return value;
}

fn validPath(path: []const u8) ![]const u8 {
    if (path.len == 0 or !std.unicode.utf8ValidateSlice(path)) return error.UnsupportedPath;
    return path;
}

fn parseCount(value: []const u8) !?usize {
    if (std.mem.eql(u8, value, "-")) return null;
    return std.fmt.parseInt(usize, value, 10) catch error.MalformedGitOutput;
}

fn lineCount(contents: []const u8) usize {
    if (contents.len == 0) return 0;
    var count = std.mem.count(u8, contents, "\n");
    if (contents[contents.len - 1] != '\n') count += 1;
    return count;
}

fn lessThanChange(_: void, left: Change, right: Change) bool {
    return std.mem.lessThan(u8, left.path, right.path);
}
