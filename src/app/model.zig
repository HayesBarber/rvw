const std = @import("std");
const config = @import("../config.zig");
const log = @import("../log.zig");

pub const FileStatus = enum {
    modified,
    added,
    deleted,
    renamed,
    unchanged,
};

pub const Repository = struct { name: []const u8 };

pub const DiffSource = union(enum) {
    working_tree: struct { base: []const u8 },
    commit_range: struct {
        base: []const u8,
        head: []const u8,
    },

    pub fn jsonStringify(self: DiffSource, writer: *std.json.Stringify) !void {
        try writer.beginObject();
        switch (self) {
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
    target: CommentTarget,
};

pub const DiffOverview = struct {
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

pub const Request = union(enum) {
    get_configuration,
    get_diff_overview,
    get_files,
    get_file: struct { path: []const u8 },
    get_file_diff: struct {
        diff_id: []const u8,
        path: []const u8,
    },
    get_comments,
    copy_comments_as_markdown,
    create_comment: struct {
        body: []const u8,
        target: CommentTarget,
    },
    edit_comment: struct {
        comment_id: []const u8,
        body: []const u8,
    },
    delete_comment: struct { comment_id: []const u8 },
    log: struct {
        level: log.Level,
        message: []const u8,
        context: ?std.json.Value = null,
        metrics: ?std.json.Value = null,
    },
};

pub const CopyCommentsResult = struct {
    commentCount: usize,
};

pub const DeleteCommentResult = struct {
    commentId: []const u8,
};

pub const Response = union(enum) {
    configuration: config.Snapshot,
    diff_overview: DiffOverview,
    files: []const []const u8,
    file: FileDiff,
    file_diff: FileDiff,
    comments: []const Comment,
    comment: Comment,
    delete_comment_result: DeleteCommentResult,
    copy_comments_result: CopyCommentsResult,
    log: struct {},
};

pub const AppError = error{
    UnknownDiff,
    UnknownFile,
    InvalidComment,
    InvalidCommentId,
    UnknownComment,
    InvalidLogEntry,
    NoComments,
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
        error.InvalidLogEntry => .malformed_request,
        error.NoComments => .no_comments,
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
        .clipboard_unavailable => "Unable to copy review comments to the clipboard",
        .internal_error => "Internal error",
    };
}
