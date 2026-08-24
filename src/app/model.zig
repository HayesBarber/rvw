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

    pub fn jsonStringify(self: CommentTarget, jws: anytype) !void {
        try jws.beginObject();
        switch (self) {
            .file => |target| {
                try jws.objectField("kind");
                try jws.write("file");
                try jws.objectField("path");
                try jws.write(target.path);
            },
            .line => |target| {
                try jws.objectField("kind");
                try jws.write("line");
                try jws.objectField("path");
                try jws.write(target.path);
                try jws.objectField("side");
                try jws.write(target.side);
                try jws.objectField("startLine");
                try jws.write(target.startLine);
                try jws.objectField("endLine");
                try jws.write(target.endLine);
            },
        }
        try jws.endObject();
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

    pub fn jsonStringify(self: FileContents, jws: anytype) !void {
        try jws.beginObject();
        try jws.objectField("name");
        try jws.write(self.name);
        try jws.objectField("contents");
        try jws.write(self.contents);
        if (self.lang) |lang| {
            try jws.objectField("lang");
            try jws.write(lang);
        }
        try jws.endObject();
    }
};

pub const FileContent = union(enum) {
    diff: struct {
        oldFile: ?FileContents,
        newFile: ?FileContents,
    },
    file: struct { file: FileContents },

    pub fn jsonStringify(self: FileContent, jws: anytype) !void {
        try jws.beginObject();
        switch (self) {
            .diff => |content| {
                try jws.objectField("kind");
                try jws.write("diff");
                try jws.objectField("oldFile");
                try jws.write(content.oldFile);
                try jws.objectField("newFile");
                try jws.write(content.newFile);
            },
            .file => |content| {
                try jws.objectField("kind");
                try jws.write("file");
                try jws.objectField("file");
                try jws.write(content.file);
            },
        }
        try jws.endObject();
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
    ShuttingDown,
};

pub const ErrorCode = enum {
    malformed_request,
    unknown_operation,
    unknown_review,
    unknown_file,
    shutting_down,
    internal_error,
};

pub fn errorCode(err: anyerror) ErrorCode {
    return switch (err) {
        error.UnknownReview => .unknown_review,
        error.UnknownFile => .unknown_file,
        error.ShuttingDown => .shutting_down,
        else => .internal_error,
    };
}

pub fn errorMessage(code: ErrorCode) []const u8 {
    return switch (code) {
        .malformed_request => "Malformed request",
        .unknown_operation => "Unknown operation",
        .unknown_review => "Unknown review",
        .unknown_file => "Unknown file",
        .shutting_down => "Core is shutting down",
        .internal_error => "Internal error",
    };
}

test "file content JSON omits an absent language" {
    const std = @import("std");
    const json = try std.json.Stringify.valueAlloc(std.testing.allocator, FileContents{
        .name = "main.zig",
        .contents = "",
    }, .{});
    defer std.testing.allocator.free(json);
    try std.testing.expectEqualStrings("{\"name\":\"main.zig\",\"contents\":\"\"}", json);
}
