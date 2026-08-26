const std = @import("std");

pub const FileStatus = enum {
    modified,
    added,
    deleted,
    unchanged,
};

pub const Repository = struct { name: []const u8 };

pub const ReviewSource = struct {
    kind: []const u8,
    base: []const u8,
};

pub const Review = struct {
    id: []const u8,
    repository: Repository,
    source: ReviewSource,
};

pub const FileSummary = struct {
    path: []const u8,
    status: FileStatus,
    additions: usize,
    deletions: usize,
    commentCount: usize,
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

pub const ReviewComment = struct {
    id: []const u8,
    body: []const u8,
    target: CommentTarget,
};

pub const ReviewOverview = struct {
    review: Review,
    initialPath: []const u8,
    files: []const FileSummary,
    comments: []const ReviewComment,
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
        }
        try writer.endObject();
    }
};

pub const FileReview = struct {
    path: []const u8,
    status: FileStatus,
    content: FileContent,
};

pub const Request = union(enum) {
    get_review_overview,
    get_file_review: struct {
        review_id: []const u8,
        path: []const u8,
    },
};

pub const Response = union(enum) {
    review_overview: ReviewOverview,
    file_review: FileReview,
};

pub const AppError = error{
    UnknownReview,
    UnknownFile,
};

pub const ErrorCode = enum {
    malformed_request,
    unknown_operation,
    unknown_review,
    unknown_file,
    internal_error,
};

pub fn errorCode(err: anyerror) ErrorCode {
    return switch (err) {
        error.UnknownReview => .unknown_review,
        error.UnknownFile => .unknown_file,
        else => .internal_error,
    };
}

pub fn errorMessage(code: ErrorCode) []const u8 {
    return switch (code) {
        .malformed_request => "Malformed request",
        .unknown_operation => "Unknown operation",
        .unknown_review => "Unknown review",
        .unknown_file => "Unknown file",
        .internal_error => "Internal error",
    };
}
