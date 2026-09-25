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

pub const FileSummary = struct {
    path: []const u8,
    previousPath: ?[]const u8 = null,
    status: FileStatus,
    additions: ?usize,
    deletions: ?usize,
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
    debugTimings: bool = false,
    id: []const u8,
    repository: Repository,
    source: DiffSource,
    initialPath: ?[]const u8,
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
    get_files,
    get_files_not_ignored,
    search_text: TextSearchRequest,
    get_file: struct { path: []const u8, trace_id: ?[]const u8 = null },
    get_file_diff: struct {
        diff_id: []const u8,
        trace_id: ?[]const u8 = null,
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
};

pub const AppError = error{
    UnknownDiff,
    UnknownFile,
    InvalidComment,
    InvalidCommentId,
    UnknownComment,
    NoComments,
    InvalidFilePath,
    ReloadUnavailable,
    InvalidSearchQuery,
    SearchUnavailable,
    SearchFailed,
};

pub const ErrorCode = enum {
    malformed_request,
    unknown_operation,
    unknown_diff,
    unknown_file,
    invalid_comment,
    invalid_comment_id,
    unknown_comment,
    no_comments,
    invalid_file_path,
    reload_unavailable,
    invalid_search_query,
    search_unavailable,
    search_failed,
    file_path_clipboard_unavailable,
    clipboard_unavailable,
    internal_error,
};

pub fn errorCode(err: anyerror) ErrorCode {
    return switch (err) {
        error.UnknownDiff => .unknown_diff,
        error.UnknownFile => .unknown_file,
        error.InvalidComment => .invalid_comment,
        error.InvalidCommentId => .invalid_comment_id,
        error.UnknownComment => .unknown_comment,
        error.NoComments => .no_comments,
        error.InvalidFilePath => .invalid_file_path,
        error.InvalidSearchQuery => .invalid_search_query,
        error.SearchUnavailable => .search_unavailable,
        error.SearchFailed => .search_failed,
        error.ReloadUnavailable => .reload_unavailable,
        error.FilePathClipboardUnavailable => .file_path_clipboard_unavailable,
        error.ClipboardCommandFailed,
        error.ClipboardToolNotFound,
        error.ClipboardWriteFailed,
        error.UnsupportedPlatform,
        => .clipboard_unavailable,
        else => .internal_error,
    };
}

pub fn errorMessage(code: ErrorCode) []const u8 {
    return switch (code) {
        .malformed_request => "Malformed request",
        .unknown_operation => "Unknown operation",
        .unknown_diff => "Unknown diff",
        .unknown_file => "Unknown file",
        .invalid_comment => "Comment body or target is invalid",
        .invalid_comment_id => "Comment ID is invalid",
        .unknown_comment => "Comment was not found",
        .no_comments => "No review comments to copy",
        .invalid_file_path => "File path is invalid",
        .invalid_search_query => "Search query must be valid UTF-8 without NUL or line breaks",
        .search_unavailable => "Search is unavailable; install ripgrep and set RVW_RIPGREP to its absolute executable path or add rg to Rvw’s PATH",
        .search_failed => "Search failed; check directory access and try again",
        .reload_unavailable => "Unable to reload the review snapshot",
        .file_path_clipboard_unavailable => "Unable to copy the file path to the clipboard",
        .clipboard_unavailable => "Unable to copy review comments to the clipboard",
        .internal_error => "Internal error",
    };
}
