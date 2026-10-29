const std = @import("std");
const config = @import("../config/config.zig");
const logging = @import("../log/interface.zig");

pub const FileStatus = enum {
    modified,
    added,
    deleted,
    renamed,
    unchanged,
};

pub const Repository = struct { name: []const u8 };

pub const PullRequest = struct {
    number: u32,
    title: []const u8,
    authorLogin: []const u8,
    url: []const u8,
    isDraft: bool,
    baseRefName: []const u8,
    headRefName: []const u8,
};

pub const PullRequestListResult = struct {
    pullRequests: []const PullRequest,
    /// Storage for this result; null for static results. Never serialized.
    arena: ?std.heap.ArenaAllocator = null,

    /// Call once after use, including when serialization fails.
    pub fn deinit(self: PullRequestListResult) void {
        if (self.arena) |storage| {
            var arena = storage;
            arena.deinit();
        }
    }

    pub fn jsonStringify(self: PullRequestListResult, writer: *std.json.Stringify) !void {
        try writer.write(.{ .pullRequests = self.pullRequests });
    }
};

test "pull request list preserves metadata and order and releases owned storage" {
    const Test = struct {
        fn run(allocator: std.mem.Allocator) !void {
            var arena = std.heap.ArenaAllocator.init(allocator);
            // Covers allocation and serialization failures as well as success.
            const result: PullRequestListResult = result: {
                errdefer arena.deinit();
                const storage = arena.allocator();
                const items = try storage.alloc(PullRequest, 2);
                items[0] = .{
                    .number = 42,
                    .title = try storage.dupe(u8, "Fix \"quoted\" text and 雪"),
                    .authorLogin = try storage.dupe(u8, "test-author"),
                    .url = try storage.dupe(u8, "https://github.com/owner/repo/pull/42"),
                    .isDraft = true,
                    .baseRefName = try storage.dupe(u8, "main"),
                    .headRefName = try storage.dupe(u8, "feature/雪"),
                };
                items[1] = items[0];
                items[1].number = 7;
                items[1].url = try storage.dupe(u8, "https://github.com/owner/repo/pull/7");
                items[1].isDraft = false;
                break :result .{ .pullRequests = items, .arena = arena };
            };
            defer result.deinit();
            const encoded = try std.json.Stringify.valueAlloc(allocator, result, .{});
            defer allocator.free(encoded);
            const parsed = try std.json.parseFromSlice(std.json.Value, allocator, encoded, .{});
            defer parsed.deinit();
            try std.testing.expectEqual(@as(usize, 1), parsed.value.object.count());
            const items = parsed.value.object.get("pullRequests").?.array.items;
            try std.testing.expectEqual(@as(usize, 2), items.len);
            for (items, result.pullRequests) |item, expected| {
                const fields = item.object;
                try std.testing.expectEqual(@as(usize, 7), fields.count());
                try std.testing.expectEqual(@as(i64, expected.number), fields.get("number").?.integer);
                try std.testing.expectEqualStrings(expected.title, fields.get("title").?.string);
                try std.testing.expectEqualStrings(expected.authorLogin, fields.get("authorLogin").?.string);
                try std.testing.expectEqualStrings(expected.url, fields.get("url").?.string);
                try std.testing.expectEqual(expected.isDraft, fields.get("isDraft").?.bool);
                try std.testing.expectEqualStrings(expected.baseRefName, fields.get("baseRefName").?.string);
                try std.testing.expectEqualStrings(expected.headRefName, fields.get("headRefName").?.string);
            }
        }
    };
    try std.testing.checkAllAllocationFailures(std.testing.allocator, Test.run, .{});
}

test "empty pull request list supports static storage" {
    const result: PullRequestListResult = .{ .pullRequests = &.{} };
    defer result.deinit();
    const encoded = try std.json.Stringify.valueAlloc(std.testing.allocator, result, .{});
    defer std.testing.allocator.free(encoded);
    try std.testing.expectEqualStrings("{\"pullRequests\":[]}", encoded);
}

pub const Commit = struct {
    /// Full commit object ID.
    sha: []const u8,
    /// First line of the commit message.
    subject: []const u8,
    authorName: []const u8,
    /// Committer date in ISO 8601 format, with a UTC offset.
    commitDate: []const u8,
};

pub const CommitListResult = struct {
    commits: []const Commit,
    /// Storage for this result; null for static results. Never serialized.
    arena: ?std.heap.ArenaAllocator = null,

    /// Call once after use, including when serialization fails.
    pub fn deinit(self: CommitListResult) void {
        if (self.arena) |storage| {
            var arena = storage;
            arena.deinit();
        }
    }

    pub fn jsonStringify(self: CommitListResult, writer: *std.json.Stringify) !void {
        try writer.write(.{ .commits = self.commits });
    }
};

test "commit list serialization preserves fields and releases owned storage" {
    const result: CommitListResult = result: {
        var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
        errdefer arena.deinit();
        const allocator = arena.allocator();
        const commits = try allocator.alloc(Commit, 1);
        commits[0] = .{
            .sha = try allocator.dupe(u8, "0123456789abcdef0123456789abcdef01234567"),
            .subject = try allocator.dupe(u8, "Fix \"quoted\" text and 雪"),
            .authorName = try allocator.dupe(u8, "Test Author"),
            .commitDate = try allocator.dupe(u8, "2026-10-27T18:30:00-04:00"),
        };
        break :result .{ .commits = commits, .arena = arena };
    };
    defer result.deinit();

    var failing = std.testing.FailingAllocator.init(std.testing.allocator, .{ .fail_index = 0 });
    try std.testing.expectError(error.OutOfMemory, std.json.Stringify.valueAlloc(failing.allocator(), result, .{}));
    const encoded = try std.json.Stringify.valueAlloc(std.testing.allocator, result, .{});
    defer std.testing.allocator.free(encoded);
    const parsed = try std.json.parseFromSlice(std.json.Value, std.testing.allocator, encoded, .{});
    defer parsed.deinit();
    try std.testing.expectEqual(@as(usize, 1), parsed.value.object.count());
    const items = parsed.value.object.get("commits").?.array.items;
    try std.testing.expectEqual(@as(usize, 1), items.len);
    const item = items[0].object;
    try std.testing.expectEqual(@as(usize, 4), item.count());
    try std.testing.expectEqualStrings(result.commits[0].sha, item.get("sha").?.string);
    try std.testing.expectEqualStrings(result.commits[0].subject, item.get("subject").?.string);
    try std.testing.expectEqualStrings(result.commits[0].authorName, item.get("authorName").?.string);
    try std.testing.expectEqualStrings(result.commits[0].commitDate, item.get("commitDate").?.string);
}

test "empty commit list supports static storage" {
    const result: CommitListResult = .{ .commits = &.{} };
    defer result.deinit();
    const encoded = try std.json.Stringify.valueAlloc(std.testing.allocator, result, .{});
    defer std.testing.allocator.free(encoded);
    try std.testing.expectEqualStrings("{\"commits\":[]}", encoded);
}

pub const DiffSource = union(enum) {
    pull_request: struct { number: u32 },
    working_tree: struct { base: []const u8 },
    commit_range: struct {
        base: []const u8,
        head: []const u8,
    },

    pub fn jsonStringify(self: DiffSource, writer: *std.json.Stringify) !void {
        try writer.beginObject();
        switch (self) {
            .pull_request => |source| {
                try writer.objectField("kind");
                try writer.write("pull-request");
                try writer.objectField("number");
                try writer.write(source.number);
            },
            .working_tree => |source| {
                try writer.objectField("kind");
                try writer.write("working-tree");
                try writer.objectField("base");
                try writer.write(source.base);
            },
            .commit_range => |source| {
                try writer.objectField("kind");
                try writer.write("commit-range");
                try writer.objectField("base");
                try writer.write(source.base);
                try writer.objectField("head");
                try writer.write(source.head);
            },
        }
        try writer.endObject();
    }
};

pub const SourceLabels = struct {
    full: []const u8,
    compact: []const u8,
};

pub fn formatSourceLabels(allocator: std.mem.Allocator, source: DiffSource) !SourceLabels {
    return switch (source) {
        .working_tree => .{ .full = "working tree", .compact = "working tree" },
        .pull_request => |value| blk: {
            const label = try std.fmt.allocPrint(allocator, "PR #{d}", .{value.number});
            break :blk .{ .full = label, .compact = label };
        },
        .commit_range => |value| .{
            .full = try std.fmt.allocPrint(allocator, "{s}..{s}", .{ value.base, value.head }),
            .compact = try std.fmt.allocPrint(allocator, "{s}..{s}", .{
                compactRevision(value.base), compactRevision(value.head),
            }),
        },
    };
}

fn compactRevision(revision: []const u8) []const u8 {
    if (revision.len < 40 or revision.len > 64) return revision;
    for (revision) |character| {
        if (!std.ascii.isHex(character) or std.ascii.isUpper(character)) return revision;
    }
    return revision[0..7];
}

test "source labels cover working tree, full revisions, and pull requests" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();
    const working = try formatSourceLabels(allocator, .{ .working_tree = .{ .base = "HEAD" } });
    try std.testing.expectEqualStrings("working tree", working.full);
    try std.testing.expectEqualStrings("working tree", working.compact);

    const base = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const head = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const range = try formatSourceLabels(allocator, .{ .commit_range = .{ .base = base, .head = head } });
    try std.testing.expectEqualStrings(base ++ ".." ++ head, range.full);
    try std.testing.expectEqualStrings("aaaaaaa..bbbbbbb", range.compact);
    const symbolic = try formatSourceLabels(allocator, .{ .commit_range = .{ .base = "HEAD~1", .head = "HEAD" } });
    try std.testing.expectEqualStrings("HEAD~1..HEAD", symbolic.compact);

    const pr = try formatSourceLabels(allocator, .{ .pull_request = .{ .number = 100 } });
    try std.testing.expectEqualStrings("PR #100", pr.full);
    try std.testing.expectEqualStrings("PR #100", pr.compact);
}

pub const FileSummary = struct {
    path: []const u8,
    previousPath: ?[]const u8 = null,
    status: FileStatus,
    additions: ?usize,
    deletions: ?usize,
};

pub const WorkingTreeChangesResult = struct {
    files: []const FileSummary,
    /// Storage for this result; null for static results. Never serialized.
    arena: ?std.heap.ArenaAllocator = null,

    /// Call once after use, including when serialization fails.
    pub fn deinit(self: WorkingTreeChangesResult) void {
        if (self.arena) |storage| {
            var arena = storage;
            arena.deinit();
        }
    }

    pub fn jsonStringify(self: WorkingTreeChangesResult, writer: *std.json.Stringify) !void {
        try writer.write(.{ .files = self.files });
    }
};

pub const UnavailableReason = enum {
    binary,
    invalid_utf8,
    too_large,
    symlink,
    submodule,

    pub fn jsonStringify(self: UnavailableReason, writer: *std.json.Stringify) !void {
        try writer.write(switch (self) {
            .binary => "binary",
            .invalid_utf8 => "invalid-utf8",
            .too_large => "too-large",
            .symlink => "symlink",
            .submodule => "submodule",
        });
    }
};

pub const CommentTarget = union(enum) {
    review,
    file: struct { path: []const u8 },
    line: struct {
        path: []const u8,
        side: enum { old, new },
        startLine: usize,
        endLine: usize,
    },

    /// Uses the API's `{ "kind": ... }` tagged-object shape instead of
    /// std.json's default representation for tagged unions.
    pub fn jsonStringify(self: CommentTarget, writer: *std.json.Stringify) !void {
        try writer.beginObject();
        switch (self) {
            .review => {
                try writer.objectField("kind");
                try writer.write("review");
            },
            .file => |target| {
                try writer.objectField("kind");
                try writer.write("file");
                try writer.objectField("path");
                try writer.write(target.path);
            },
            .line => |target| {
                try writer.objectField("kind");
                try writer.write("line");
                try writer.objectField("path");
                try writer.write(target.path);
                try writer.objectField("side");
                try writer.write(target.side);
                try writer.objectField("startLine");
                try writer.write(target.startLine);
                try writer.objectField("endLine");
                try writer.write(target.endLine);
            },
        }
        try writer.endObject();
    }
};

pub const Comment = struct {
    id: []const u8,
    body: []const u8,
    commentType: ?[]const u8 = null,
    target: CommentTarget,
};

pub const DiffOverview = struct {
    id: []const u8,
    repository: Repository,
    source: DiffSource,
    sourceLabel: []const u8 = "",
    compactSourceLabel: []const u8 = "",
    files: []const FileSummary,
};

pub const FileContents = struct {
    name: []const u8,
    contents: []const u8,
    lang: ?[]const u8 = null,

    /// Keeps the optional `lang` field out of the JSON contract when unknown.
    pub fn jsonStringify(self: FileContents, writer: *std.json.Stringify) !void {
        try writer.beginObject();
        try writer.objectField("name");
        try writer.write(self.name);
        try writer.objectField("contents");
        try writer.write(self.contents);
        if (self.lang) |lang| {
            try writer.objectField("lang");
            try writer.write(lang);
        }
        try writer.endObject();
    }
};

pub const FileContent = union(enum) {
    diff: struct {
        oldFile: ?FileContents,
        newFile: ?FileContents,
    },
    file: struct { file: FileContents },
    unavailable: struct { reason: UnavailableReason },

    /// Uses the API's `{ "kind": ... }` tagged-object shape instead of
    /// std.json's default representation for tagged unions.
    pub fn jsonStringify(self: FileContent, writer: *std.json.Stringify) !void {
        try writer.beginObject();
        switch (self) {
            .diff => |content| {
                try writer.objectField("kind");
                try writer.write("diff");
                try writer.objectField("oldFile");
                try writer.write(content.oldFile);
                try writer.objectField("newFile");
                try writer.write(content.newFile);
            },
            .file => |content| {
                try writer.objectField("kind");
                try writer.write("file");
                try writer.objectField("file");
                try writer.write(content.file);
            },
            .unavailable => |content| {
                try writer.objectField("kind");
                try writer.write("unavailable");
                try writer.objectField("reason");
                try writer.write(content.reason);
            },
        }
        try writer.endObject();
    }
};

pub const FileDiff = struct {
    path: []const u8,
    previousPath: ?[]const u8 = null,
    status: FileStatus,
    content: FileContent,
};

/// Wire values also name the two provider modes.
pub const TextSearchMode = enum { @"ignore-aware", @"all-files" };

/// A case-sensitive literal query. Empty queries succeed with no matches.
pub const TextSearchRequest = struct {
    query: []const u8,
    mode: TextSearchMode,
};

/// Zero-based UTF-16 code-unit offsets into lineText; end is exclusive.
/// Boundaries must not split a surrogate pair.
pub const TextSearchSpan = struct { start: usize, end: usize };

pub const TextSearchMatch = struct {
    /// Canonical path relative to the opened directory, with '/' separators.
    path: []const u8,
    /// One-based line number in the working-tree file.
    lineNumber: usize,
    /// Valid UTF-8, without the LF or CRLF line terminator.
    lineText: []const u8,
    spans: []const TextSearchSpan,
};

pub const TextSearchResult = struct {
    matches: []const TextSearchMatch,
    /// True if a result or output limit stopped the search. Matches are partial.
    truncated: bool,
    /// Request-owned storage; null for static or stub results. Never serialized.
    arena: ?std.heap.ArenaAllocator = null,

    pub fn deinit(self: TextSearchResult) void {
        if (self.arena) |storage| {
            var arena = storage;
            arena.deinit();
        }
    }

    pub fn jsonStringify(self: TextSearchResult, writer: *std.json.Stringify) !void {
        try writer.write(.{ .matches = self.matches, .truncated = self.truncated });
    }
};

pub fn validTextSearchQuery(query: []const u8) bool {
    return std.unicode.utf8ValidateSlice(query) and std.mem.indexOfAny(u8, query, "\x00\r\n") == null;
}

pub const Request = union(enum) {
    log: logging.Event,
    get_configuration,
    reload_review,
    get_diff_overview,
    list_commits,
    list_working_tree_changes,
    list_open_pull_requests,
    get_files,
    get_files_not_ignored,
    search_text: TextSearchRequest,
    get_file: struct { path: []const u8 },
    get_file_diff: struct {
        diff_id: []const u8,
        path: []const u8,
    },
    get_comments,
    copy_comments_as_markdown,
    copy_file_path: struct {
        path: []const u8,
        format: FilePathFormat,
    },
    create_comment: struct {
        body: []const u8,
        comment_type: ?[]const u8 = null,
        target: CommentTarget,
    },
    edit_comment: struct {
        comment_id: []const u8,
        body: []const u8,
        comment_type: ?[]const u8 = null,
    },
    delete_comment: struct { comment_id: []const u8 },
    clear_comments,
};

pub const FilePathFormat = enum {
    relative,
    absolute,
};

pub const CopyCommentsResult = struct {
    commentCount: usize,
};

pub const CopyFilePathResult = struct {
    path: []const u8,
    format: FilePathFormat,
};

pub const DeleteCommentResult = struct {
    commentId: []const u8,
};

pub const ClearCommentsResult = struct {
    commentCount: usize,
};

pub const ReloadReviewResult = struct {
    generation: usize,
};

pub const LogResult = struct {
    accepted: bool,
};

pub const Response = union(enum) {
    log_result: LogResult,
    configuration: config.Snapshot,
    reload_review_result: ReloadReviewResult,
    diff_overview: DiffOverview,
    commit_list: CommitListResult,
    working_tree_changes: WorkingTreeChangesResult,
    pull_request_list: PullRequestListResult,
    files: []const []const u8,
    text_search: TextSearchResult,
    file: FileDiff,
    file_diff: FileDiff,
    comments: []const Comment,
    comment: Comment,
    delete_comment_result: DeleteCommentResult,
    copy_comments_result: CopyCommentsResult,
    copy_file_path_result: CopyFilePathResult,
    clear_comments_result: ClearCommentsResult,

    /// Release request-owned results after use, including serialization failure.
    pub fn deinit(self: Response) void {
        switch (self) {
            inline else => |value| switch (@typeInfo(@TypeOf(value))) {
                .@"struct", .@"union", .@"enum", .@"opaque" => {
                    if (@hasDecl(@TypeOf(value), "deinit")) value.deinit();
                },
                else => {},
            },
        }
    }
};

const ErrorDefinition = struct {
    errors: []const anyerror = &.{},
    message: []const u8,
};

const error_definitions = .{
    .malformed_request = ErrorDefinition{ .message = "Malformed request" },
    .unknown_operation = ErrorDefinition{ .message = "Unknown operation" },
    .unknown_diff = ErrorDefinition{ .errors = &.{error.UnknownDiff}, .message = "Unknown diff" },
    .unknown_file = ErrorDefinition{ .errors = &.{error.UnknownFile}, .message = "Unknown file" },
    .invalid_comment = ErrorDefinition{ .errors = &.{error.InvalidComment}, .message = "Comment body or target is invalid" },
    .invalid_comment_id = ErrorDefinition{ .errors = &.{error.InvalidCommentId}, .message = "Comment ID is invalid" },
    .unknown_comment = ErrorDefinition{ .errors = &.{error.UnknownComment}, .message = "Comment was not found" },
    .no_comments = ErrorDefinition{ .errors = &.{error.NoComments}, .message = "No review comments to copy" },
    .invalid_file_path = ErrorDefinition{ .errors = &.{error.InvalidFilePath}, .message = "File path is invalid" },
    .reload_unavailable = ErrorDefinition{ .errors = &.{error.ReloadUnavailable}, .message = "Unable to reload the review snapshot" },
    .invalid_search_query = ErrorDefinition{ .errors = &.{error.InvalidSearchQuery}, .message = "Search query must be valid UTF-8 without NUL or line breaks" },
    .search_unavailable = ErrorDefinition{ .errors = &.{error.SearchUnavailable}, .message = "Search is unavailable; install ripgrep and set RVW_RIPGREP to its absolute executable path or add rg to Rvw’s PATH" },
    .search_failed = ErrorDefinition{ .errors = &.{error.SearchFailed}, .message = "Search failed; check directory access and try again" },
    .repository_unavailable = ErrorDefinition{ .errors = &.{error.RepositoryUnavailable}, .message = "Git is unavailable" },
    .repository_failed = ErrorDefinition{ .errors = &.{error.RepositoryFailed}, .message = "Unable to read repository history" },
    .invalid_commit_history = ErrorDefinition{ .errors = &.{error.InvalidCommitHistory}, .message = "Repository history data is invalid" },
    .working_tree_changes_failed = ErrorDefinition{ .errors = &.{error.WorkingTreeChangesFailed}, .message = "Unable to list working-tree changes" },
    .invalid_revision = ErrorDefinition{ .errors = &.{error.InvalidRevision}, .message = "Revision does not identify a commit" },
    .unsupported_path = ErrorDefinition{ .errors = &.{error.UnsupportedPath}, .message = "Git file path is not supported" },
    .invalid_working_tree_changes = ErrorDefinition{ .errors = &.{error.MalformedGitOutput}, .message = "Working-tree change data is invalid" },
    .missing_origin = ErrorDefinition{ .errors = &.{error.MissingOrigin}, .message = "Pull request listing requires an origin remote" },
    .unsupported_origin = ErrorDefinition{ .errors = &.{error.UnsupportedOrigin}, .message = "The origin remote must identify a GitHub repository" },
    .pull_request_list_unavailable = ErrorDefinition{ .errors = &.{error.PullRequestListUnavailable}, .message = "GitHub CLI is unavailable" },
    .pull_request_authentication_failed = ErrorDefinition{ .errors = &.{error.PullRequestAuthenticationFailed}, .message = "GitHub authentication failed; sign in with gh auth login" },
    .pull_request_list_failed = ErrorDefinition{ .errors = &.{error.PullRequestListFailed}, .message = "Unable to list open pull requests" },
    .invalid_pull_request_list = ErrorDefinition{ .errors = &.{error.InvalidPullRequestList}, .message = "Pull request list data is invalid" },
    .file_path_clipboard_unavailable = ErrorDefinition{ .errors = &.{error.FilePathClipboardUnavailable}, .message = "Unable to copy the file path to the clipboard" },
    .clipboard_unavailable = ErrorDefinition{ .errors = &.{ error.ClipboardCommandFailed, error.ClipboardToolNotFound, error.ClipboardWriteFailed, error.UnsupportedPlatform }, .message = "Unable to copy review comments to the clipboard" },
    .internal_error = ErrorDefinition{ .message = "Internal error" },
};

pub const ErrorCode = std.meta.FieldEnum(@TypeOf(error_definitions));

pub fn errorCode(err: anyerror) ErrorCode {
    inline for (std.meta.fields(@TypeOf(error_definitions))) |field| {
        inline for (@field(error_definitions, field.name).errors) |source| {
            if (err == source) return @field(ErrorCode, field.name);
        }
    }
    return .internal_error;
}

pub fn errorMessage(code: ErrorCode) []const u8 {
    return switch (code) {
        inline else => |value| @field(error_definitions, @tagName(value)).message,
    };
}

test "application error definitions map source errors and preserve wire codes" {
    inline for (std.meta.fields(@TypeOf(error_definitions))) |field| {
        const code = @field(ErrorCode, field.name);
        const definition = @field(error_definitions, field.name);
        try std.testing.expect(errorMessage(code).len > 0);
        const encoded = try std.json.Stringify.valueAlloc(std.testing.allocator, code, .{});
        defer std.testing.allocator.free(encoded);
        const decoded = try std.json.parseFromSlice([]const u8, std.testing.allocator, encoded, .{});
        defer decoded.deinit();
        try std.testing.expectEqualStrings(field.name, decoded.value);
        for (definition.errors) |source| {
            try std.testing.expectEqual(code, errorCode(source));
        }
    }
    try std.testing.expectEqual(ErrorCode.internal_error, errorCode(error.OutOfMemory));
}

test "working-tree results serialize file summaries and release owned storage on failure" {
    const Test = struct {
        fn run(allocator: std.mem.Allocator) !void {
            var arena = std.heap.ArenaAllocator.init(allocator);
            const result: WorkingTreeChangesResult = result: {
                errdefer arena.deinit();
                const storage = arena.allocator();
                const files = try storage.alloc(FileSummary, 2);
                files[0] = .{
                    .path = try storage.dupe(u8, "new 雪.txt"),
                    .previousPath = try storage.dupe(u8, "old.txt"),
                    .status = .renamed,
                    .additions = 3,
                    .deletions = 1,
                };
                files[1] = .{ .path = "binary.dat", .status = .added, .additions = null, .deletions = null };
                break :result .{ .files = files, .arena = arena };
            };
            defer result.deinit();
            const encoded = try std.json.Stringify.valueAlloc(allocator, result, .{});
            defer allocator.free(encoded);
            try std.testing.expectEqualStrings(
                "{\"files\":[{\"path\":\"new 雪.txt\",\"previousPath\":\"old.txt\",\"status\":\"renamed\",\"additions\":3,\"deletions\":1},{\"path\":\"binary.dat\",\"previousPath\":null,\"status\":\"added\",\"additions\":null,\"deletions\":null}]}",
                encoded,
            );
        }
    };
    try std.testing.checkAllAllocationFailures(std.testing.allocator, Test.run, .{});
    const empty: WorkingTreeChangesResult = .{ .files = &.{} };
    defer empty.deinit();
    const encoded = try std.json.Stringify.valueAlloc(std.testing.allocator, empty, .{});
    defer std.testing.allocator.free(encoded);
    try std.testing.expectEqualStrings("{\"files\":[]}", encoded);
}
