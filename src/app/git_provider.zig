const std = @import("std");
const model = @import("model.zig");
const provider = @import("provider.zig");
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
    old_mode: u32 = 0,
    new_mode: u32 = 0,
    git_binary: bool = false,
};

const Snapshot = union(enum) {
    working_tree: struct { base: []const u8 },
    commit_range: struct { base: []const u8, head: []const u8 },
};

const Loaded = union(enum) {
    contents: model.FileContents,
    unavailable: model.UnavailableReason,
};

pub const GitProvider = struct {
    arena: std.heap.ArenaAllocator,
    overview: model.ReviewOverview,
    file_reviews: []const model.FileReview,

    pub fn init(backing_allocator: Allocator, io: Io, path: []const u8, range: ?[]const u8) !GitProvider {
        var arena = std.heap.ArenaAllocator.init(backing_allocator);
        errdefer arena.deinit();
        const allocator = arena.allocator();

        const root = try repository.validateRoot(io, allocator, path);
        const snapshot = if (range) |value|
            try parseRange(allocator, io, root, value)
        else
            Snapshot{ .working_tree = .{ .base = try resolveCommit(allocator, io, root, "HEAD") } };

        var changes = try trackedChanges(allocator, io, root, snapshot);
        if (snapshot == .working_tree) try appendUntracked(allocator, io, root, &changes);
        std.mem.sort(Change, changes.items, {}, lessThanChange);

        const review_id = switch (snapshot) {
            .working_tree => |details| try std.fmt.allocPrint(allocator, "working-tree:{s}", .{details.base}),
            .commit_range => |details| try std.fmt.allocPrint(allocator, "{s}..{s}", .{ details.base, details.head }),
        };

        var summaries: std.ArrayList(model.FileSummary) = .empty;
        var file_reviews: std.ArrayList(model.FileReview) = .empty;
        for (changes.items) |change| {
            try summaries.append(allocator, .{
                .path = change.path,
                .previousPath = change.previous_path,
                .status = change.status,
                .additions = change.additions,
                .deletions = change.deletions,
                .commentCount = 0,
            });
            try file_reviews.append(allocator, try buildFileReview(allocator, io, root, snapshot, change));
        }

        const source: model.ReviewSource = switch (snapshot) {
            .working_tree => |details| .{ .working_tree = .{ .base = details.base } },
            .commit_range => |details| .{ .commit_range = .{ .base = details.base, .head = details.head } },
        };
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
            .file_reviews = try file_reviews.toOwnedSlice(allocator),
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
        for (self.file_reviews) |review| {
            if (std.mem.eql(u8, review.path, path)) return review;
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
    return .{ .commit_range = .{ .base = base, .head = head } };
}

fn resolveCommit(allocator: Allocator, io: Io, root: []const u8, revision: []const u8) ![]const u8 {
    const commit = try std.fmt.allocPrint(allocator, "{s}^{{commit}}", .{revision});
    const result = std.process.run(allocator, io, .{
        .argv = &.{ "git", "-C", root, "rev-parse", "--verify", "--end-of-options", commit },
        .stdout_limit = .limited(4096),
        .stderr_limit = .limited(4096),
    }) catch |err| switch (err) {
        error.FileNotFound => return error.GitNotFound,
        else => |unexpected| return unexpected,
    };
    if (!exitedSuccessfully(result.term)) return error.InvalidRevision;
    const oid = std.mem.trim(u8, result.stdout, " \t\r\n");
    if (oid.len == 0 or !std.unicode.utf8ValidateSlice(oid)) return error.InvalidRevision;
    return oid;
}

fn trackedChanges(allocator: Allocator, io: Io, root: []const u8, snapshot: Snapshot) !std.ArrayList(Change) {
    const raw = switch (snapshot) {
        .working_tree => |details| try runGit(allocator, io, &.{ "git", "-C", root, "diff", "--no-ext-diff", "--no-textconv", "--raw", "-z", "--find-renames=50%", details.base, "--" }, maximum_metadata_size),
        .commit_range => |details| try runGit(allocator, io, &.{ "git", "-C", root, "diff", "--no-ext-diff", "--no-textconv", "--raw", "-z", "--find-renames=50%", details.base, details.head, "--" }, maximum_metadata_size),
    };
    const changes = try parseRawChanges(allocator, raw);

    const numstat = switch (snapshot) {
        .working_tree => |details| try runGit(allocator, io, &.{ "git", "-C", root, "diff", "--no-ext-diff", "--no-textconv", "--numstat", "-z", "--find-renames=50%", details.base, "--" }, maximum_metadata_size),
        .commit_range => |details| try runGit(allocator, io, &.{ "git", "-C", root, "diff", "--no-ext-diff", "--no-textconv", "--numstat", "-z", "--find-renames=50%", details.base, details.head, "--" }, maximum_metadata_size),
    };
    try applyNumstat(changes.items, numstat);
    return changes;
}

fn parseRawChanges(allocator: Allocator, output: []const u8) !std.ArrayList(Change) {
    var changes: std.ArrayList(Change) = .empty;
    var cursor: usize = 0;
    while (cursor < output.len) {
        const metadata = try nextZ(output, &cursor);
        if (metadata.len == 0 or metadata[0] != ':') return error.MalformedGitOutput;
        var fields = std.mem.tokenizeScalar(u8, metadata[1..], ' ');
        const old_mode = std.fmt.parseInt(u32, fields.next() orelse return error.MalformedGitOutput, 8) catch return error.MalformedGitOutput;
        const new_mode = std.fmt.parseInt(u32, fields.next() orelse return error.MalformedGitOutput, 8) catch return error.MalformedGitOutput;
        _ = fields.next() orelse return error.MalformedGitOutput;
        _ = fields.next() orelse return error.MalformedGitOutput;
        const status_value = fields.next() orelse return error.MalformedGitOutput;
        if (fields.next() != null or status_value.len == 0) return error.MalformedGitOutput;

        const first_path = try validPath(try nextZ(output, &cursor));
        const status_code = status_value[0];
        const previous_path: ?[]const u8 = if (status_code == 'R') first_path else null;
        const path = if (status_code == 'R') try validPath(try nextZ(output, &cursor)) else first_path;
        const status: model.FileStatus = switch (status_code) {
            'A' => .added,
            'D' => .deleted,
            'R' => .renamed,
            else => .modified,
        };
        try changes.append(allocator, .{
            .path = path,
            .previous_path = previous_path,
            .status = status,
            .old_mode = old_mode,
            .new_mode = new_mode,
        });
    }
    return changes;
}

fn applyNumstat(changes: []Change, output: []const u8) !void {
    var cursor: usize = 0;
    while (cursor < output.len) {
        const record = try nextZ(output, &cursor);
        const first_tab = std.mem.indexOfScalar(u8, record, '\t') orelse return error.MalformedGitOutput;
        const second_relative = std.mem.indexOfScalar(u8, record[first_tab + 1 ..], '\t') orelse return error.MalformedGitOutput;
        const second_tab = first_tab + 1 + second_relative;
        const additions = try parseCount(record[0..first_tab]);
        const deletions = try parseCount(record[first_tab + 1 .. second_tab]);
        const inline_path = record[second_tab + 1 ..];
        const previous_path: ?[]const u8 = if (inline_path.len == 0) try validPath(try nextZ(output, &cursor)) else null;
        const path = if (inline_path.len == 0) try validPath(try nextZ(output, &cursor)) else try validPath(inline_path);

        var matched = false;
        for (changes) |*change| {
            if (!std.mem.eql(u8, change.path, path)) continue;
            if (previous_path) |previous| {
                if (change.previous_path == null or !std.mem.eql(u8, change.previous_path.?, previous)) continue;
            }
            change.additions = additions;
            change.deletions = deletions;
            change.git_binary = additions == null or deletions == null;
            matched = true;
            break;
        }
        if (!matched) return error.MalformedGitOutput;
    }
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
        const new_mode: u32 = switch (stat.kind) {
            .file => 0o100644,
            .sym_link => 0o120000,
            else => 1,
        };
        var replaced_deletion = false;
        for (changes.items) |*change| {
            if (change.status != .deleted or !std.mem.eql(u8, change.path, path)) continue;
            change.status = .modified;
            change.additions = additions;
            change.new_mode = new_mode;
            replaced_deletion = true;
            break;
        }
        if (replaced_deletion) continue;
        try changes.append(allocator, .{
            .path = path,
            .status = .added,
            .additions = additions,
            .deletions = if (additions == null) null else 0,
            .new_mode = new_mode,
        });
    }
}

fn buildFileReview(allocator: Allocator, io: Io, root: []const u8, snapshot: Snapshot, change: Change) !model.FileReview {
    const mode_reason = unavailableMode(change.old_mode) orelse unavailableMode(change.new_mode);
    if (mode_reason) |reason| return unavailableReview(change, reason);
    if (change.git_binary) return unavailableReview(change, .binary);

    const old: ?Loaded = if (change.status == .added)
        null
    else switch (snapshot) {
        .working_tree => |details| try loadBlob(allocator, io, root, details.base, change.previous_path orelse change.path),
        .commit_range => |details| try loadBlob(allocator, io, root, details.base, change.previous_path orelse change.path),
    };
    const new: ?Loaded = if (change.status == .deleted)
        null
    else switch (snapshot) {
        .working_tree => try loadWorkingFile(allocator, io, root, change.path),
        .commit_range => |details| try loadBlob(allocator, io, root, details.head, change.path),
    };

    if (old) |loaded| switch (loaded) {
        .unavailable => |reason| return unavailableReview(change, reason),
        .contents => {},
    };
    if (new) |loaded| switch (loaded) {
        .unavailable => |reason| return unavailableReview(change, reason),
        .contents => {},
    };

    return .{
        .path = change.path,
        .previousPath = change.previous_path,
        .status = change.status,
        .content = .{ .diff = .{
            .oldFile = if (old) |loaded| loaded.contents else null,
            .newFile = if (new) |loaded| loaded.contents else null,
        } },
    };
}

fn loadBlob(allocator: Allocator, io: Io, root: []const u8, commit: []const u8, path: []const u8) !Loaded {
    const object = try std.fmt.allocPrint(allocator, "{s}:{s}", .{ commit, path });
    const result = std.process.run(allocator, io, .{
        .argv = &.{ "git", "-C", root, "show", "--no-textconv", object },
        .stdout_limit = .limited(maximum_text_size + 1),
        .stderr_limit = .limited(4096),
    }) catch |err| switch (err) {
        error.StreamTooLong => return .{ .unavailable = .too_large },
        error.FileNotFound => return error.GitNotFound,
        else => |unexpected| return unexpected,
    };
    if (!exitedSuccessfully(result.term)) return error.GitCommandFailed;
    return classifyContents(path, result.stdout);
}

fn loadWorkingFile(allocator: Allocator, io: Io, root: []const u8, path: []const u8) !Loaded {
    var directory = try std.Io.Dir.openDirAbsolute(io, root, .{});
    defer directory.close(io);
    const contents = directory.readFileAlloc(io, path, allocator, .limited(maximum_text_size + 1)) catch |err| switch (err) {
        error.StreamTooLong => return .{ .unavailable = .too_large },
        else => |unexpected| return unexpected,
    };
    return classifyContents(path, contents);
}

fn classifyContents(path: []const u8, contents: []const u8) Loaded {
    if (std.mem.indexOfScalar(u8, contents, 0) != null) return .{ .unavailable = .binary };
    if (!std.unicode.utf8ValidateSlice(contents)) return .{ .unavailable = .invalid_utf8 };
    return .{ .contents = .{ .name = path, .contents = contents } };
}

fn unavailableReview(change: Change, reason: model.UnavailableReason) model.FileReview {
    return .{
        .path = change.path,
        .previousPath = change.previous_path,
        .status = change.status,
        .content = .{ .unavailable = .{ .reason = reason } },
    };
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

test "working tree snapshot includes tracked untracked and renamed files" {
    var fixture = try TestRepository.init();
    defer fixture.deinit();
    try fixture.write("modified.txt", "old\n");
    try fixture.write("deleted.txt", "deleted\n");
    try fixture.write("rename-old.txt", "rename\n");
    try fixture.write("replaced.txt", "old replacement\n");
    try fixture.write(".gitignore", "*.ignored\n");
    try fixture.commit("base");

    try fixture.write("modified.txt", "new\nline\n");
    try fixture.directory.deleteFile(std.testing.io, "deleted.txt");
    try fixture.git(&.{ "mv", "rename-old.txt", "rename-new.txt" });
    try fixture.write("staged.txt", "staged\n");
    try fixture.git(&.{ "add", "staged.txt" });
    try fixture.write("untracked.txt", "untracked\n");
    try fixture.git(&.{ "rm", "replaced.txt" });
    try fixture.write("replaced.txt", "new replacement\n");
    try fixture.write("hidden.ignored", "ignored\n");

    var git = try GitProvider.init(std.testing.allocator, std.testing.io, fixture.root, null);
    defer git.deinit();
    try std.testing.expectEqual(@as(usize, 6), git.overview.files.len);
    try expectStatus(git.overview.files, "deleted.txt", .deleted);
    try expectStatus(git.overview.files, "modified.txt", .modified);
    try expectStatus(git.overview.files, "rename-new.txt", .renamed);
    try expectStatus(git.overview.files, "replaced.txt", .modified);
    try expectStatus(git.overview.files, "staged.txt", .added);
    try expectStatus(git.overview.files, "untracked.txt", .added);
    try std.testing.expectEqualStrings("rename-old.txt", findSummary(git.overview.files, "rename-new.txt").previousPath.?);
    try std.testing.expectEqual(@as(?usize, 2), findSummary(git.overview.files, "modified.txt").additions);
    try std.testing.expectEqual(@as(?usize, 1), findSummary(git.overview.files, "modified.txt").deletions);

    try fixture.write("untracked.txt", "changed after initialization\n");
    const review = try git.interface().getFileReview(std.testing.io, git.overview.review.id, "untracked.txt");
    try std.testing.expectEqualStrings("untracked\n", review.content.diff.newFile.?.contents);
}

test "commit range resolves endpoints and ignores the dirty worktree" {
    var fixture = try TestRepository.init();
    defer fixture.deinit();
    try fixture.write("file.txt", "base\n");
    try fixture.commit("base");
    const base = try fixture.head(std.testing.allocator);
    defer std.testing.allocator.free(base);
    try fixture.write("file.txt", "committed\n");
    try fixture.commit("head");
    const head = try fixture.head(std.testing.allocator);
    defer std.testing.allocator.free(head);
    try fixture.write("file.txt", "dirty\n");

    const range = try std.fmt.allocPrint(std.testing.allocator, "{s}..{s}", .{ base, head });
    defer std.testing.allocator.free(range);
    var git = try GitProvider.init(std.testing.allocator, std.testing.io, fixture.root, range);
    defer git.deinit();
    try std.testing.expectEqual(@as(usize, 1), git.overview.files.len);
    const review = try git.interface().getFileReview(std.testing.io, git.overview.review.id, "file.txt");
    try std.testing.expectEqualStrings("base\n", review.content.diff.oldFile.?.contents);
    try std.testing.expectEqualStrings("committed\n", review.content.diff.newFile.?.contents);
    try std.testing.expectError(error.InvalidRange, GitProvider.init(std.testing.allocator, std.testing.io, fixture.root, "HEAD...HEAD"));
    try std.testing.expectError(error.InvalidRange, GitProvider.init(std.testing.allocator, std.testing.io, fixture.root, "HEAD"));

    var empty = try GitProvider.init(std.testing.allocator, std.testing.io, fixture.root, "HEAD..HEAD");
    defer empty.deinit();
    try std.testing.expectEqual(@as(usize, 0), empty.overview.files.len);
    try std.testing.expectEqual(@as(?[]const u8, null), empty.overview.initialPath);
}

test "unrenderable working tree files stay visible" {
    var fixture = try TestRepository.init();
    defer fixture.deinit();
    try fixture.write("base.txt", "base\n");
    try fixture.commit("base");
    try fixture.write("binary.dat", &.{ 1, 0, 2 });
    try fixture.write("invalid.txt", &.{ 0xc3, 0x28 });
    const oversized = try std.testing.allocator.alloc(u8, maximum_text_size + 1);
    defer std.testing.allocator.free(oversized);
    @memset(oversized, 'x');
    try fixture.write("large.txt", oversized);
    try fixture.directory.symLink(std.testing.io, "base.txt", "linked.txt", .{});

    var git = try GitProvider.init(std.testing.allocator, std.testing.io, fixture.root, null);
    defer git.deinit();
    try std.testing.expectEqual(@as(usize, 4), git.overview.files.len);
    try expectUnavailable(&git, "binary.dat", .binary);
    try expectUnavailable(&git, "invalid.txt", .invalid_utf8);
    try expectUnavailable(&git, "large.txt", .too_large);
    try expectUnavailable(&git, "linked.txt", .symlink);
}

test "Git mode classification recognizes submodules" {
    try std.testing.expectEqual(model.UnavailableReason.submodule, unavailableMode(0o160000).?);
}

const TestRepository = struct {
    temporary: std.testing.TmpDir,
    directory: std.Io.Dir,
    root: []u8,

    fn init() !TestRepository {
        var temporary = std.testing.tmpDir(.{});
        errdefer temporary.cleanup();
        const root = try temporary.dir.realPathFileAlloc(std.testing.io, ".", std.testing.allocator);
        errdefer std.testing.allocator.free(root);
        var directory = try std.Io.Dir.openDirAbsolute(std.testing.io, root, .{});
        errdefer directory.close(std.testing.io);
        var fixture: TestRepository = .{ .temporary = temporary, .directory = directory, .root = root };
        try fixture.git(&.{ "init", "--quiet", "--initial-branch=main" });
        return fixture;
    }

    fn deinit(self: *TestRepository) void {
        self.directory.close(std.testing.io);
        std.testing.allocator.free(self.root);
        self.temporary.cleanup();
        self.* = undefined;
    }

    fn write(self: *TestRepository, path: []const u8, contents: []const u8) !void {
        try self.directory.writeFile(std.testing.io, .{ .sub_path = path, .data = contents });
    }

    fn commit(self: *TestRepository, message: []const u8) !void {
        try self.git(&.{ "add", "-A" });
        try self.git(&.{ "-c", "user.name=Rvw Test", "-c", "user.email=rvw@example.invalid", "commit", "--quiet", "-m", message });
    }

    fn head(self: *TestRepository, allocator: Allocator) ![]u8 {
        var argv: std.ArrayList([]const u8) = .empty;
        defer argv.deinit(std.testing.allocator);
        try argv.appendSlice(std.testing.allocator, &.{ "git", "-C", self.root, "rev-parse", "HEAD" });
        const result = try std.process.run(std.testing.allocator, std.testing.io, .{ .argv = argv.items });
        defer std.testing.allocator.free(result.stdout);
        defer std.testing.allocator.free(result.stderr);
        try std.testing.expect(exitedSuccessfully(result.term));
        return allocator.dupe(u8, std.mem.trim(u8, result.stdout, " \t\r\n"));
    }

    fn git(self: *TestRepository, arguments: []const []const u8) !void {
        var argv: std.ArrayList([]const u8) = .empty;
        defer argv.deinit(std.testing.allocator);
        try argv.appendSlice(std.testing.allocator, &.{ "git", "-C", self.root });
        try argv.appendSlice(std.testing.allocator, arguments);
        const result = try std.process.run(std.testing.allocator, std.testing.io, .{ .argv = argv.items });
        defer std.testing.allocator.free(result.stdout);
        defer std.testing.allocator.free(result.stderr);
        if (!exitedSuccessfully(result.term)) {
            std.debug.print("git failed: {s}\n", .{result.stderr});
            return error.TestGitFailed;
        }
    }
};

fn findSummary(files: []const model.FileSummary, path: []const u8) model.FileSummary {
    for (files) |file| if (std.mem.eql(u8, file.path, path)) return file;
    return undefined;
}

fn expectStatus(files: []const model.FileSummary, path: []const u8, expected: model.FileStatus) !void {
    for (files) |file| {
        if (!std.mem.eql(u8, file.path, path)) continue;
        return std.testing.expectEqual(expected, file.status);
    }
    return error.MissingFile;
}

fn expectUnavailable(git: *GitProvider, path: []const u8, expected: model.UnavailableReason) !void {
    const review = try git.interface().getFileReview(std.testing.io, git.overview.review.id, path);
    switch (review.content) {
        .unavailable => |content| try std.testing.expectEqual(expected, content.reason),
        else => return error.ExpectedUnavailable,
    }
}
