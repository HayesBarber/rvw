const std = @import("std");
const model = @import("model.zig");
const provider = @import("provider.zig");

pub const FixtureProvider = struct {
    pub fn interface(self: *FixtureProvider) provider.ReviewProvider {
        return .{ .context = self, .vtable = &vtable };
    }

    fn getOverview(_: *anyopaque) !model.ReviewOverview {
        return overview;
    }

    fn getFileReview(_: *anyopaque, review_id: []const u8, path: []const u8) !model.FileReview {
        if (!std.mem.eql(u8, review_id, "working-tree")) return error.UnknownReview;
        for (file_reviews) |review| {
            if (std.mem.eql(u8, review.path, path)) return review;
        }
        return error.UnknownFile;
    }

    const vtable: provider.ReviewProvider.VTable = .{
        .getOverview = getOverview,
        .getFileReview = getFileReview,
    };
};

const files = [_]model.FileSummary{
    .{ .path = "README.md", .status = .unchanged, .additions = 0, .deletions = 0, .commentCount = 0 },
    .{ .path = "src/app/review.zig", .status = .modified, .additions = 6, .deletions = 2, .commentCount = 2 },
    .{ .path = "src/app/session.zig", .status = .added, .additions = 9, .deletions = 0, .commentCount = 1 },
    .{ .path = "src/legacy.zig", .status = .deleted, .additions = 0, .deletions = 5, .commentCount = 0 },
    .{ .path = "src/main.zig", .status = .unchanged, .additions = 0, .deletions = 0, .commentCount = 1 },
};

const comments = [_]model.ReviewComment{
    .{
        .id = "comment-1",
        .body = "Should the review own this identifier, or should the platform layer provide it?",
        .target = .{ .line = .{ .path = "src/app/review.zig", .side = .new, .startLine = 4, .endLine = 4 } },
    },
    .{
        .id = "comment-2",
        .body = "The model boundary is taking shape. We should keep platform-specific data out of this struct.",
        .target = .{ .file = .{ .path = "src/app/review.zig" } },
    },
    .{
        .id = "comment-3",
        .body = "Consider representing the two commit endpoints separately instead of keeping a range string.",
        .target = .{ .line = .{ .path = "src/app/session.zig", .side = .new, .startLine = 8, .endLine = 8 } },
    },
    .{
        .id = "comment-4",
        .body = "This file is unchanged, but it may eventually need to initialize the selected review mode.",
        .target = .{ .line = .{ .path = "src/main.zig", .side = .new, .startLine = 3, .endLine = 5 } },
    },
};

const overview: model.ReviewOverview = .{
    .review = .{
        .id = "working-tree",
        .repository = .{ .name = "rvw" },
        .source = .{ .kind = "working-tree", .base = "HEAD" },
    },
    .initialPath = "src/app/review.zig",
    .files = &files,
    .comments = &comments,
};

const file_reviews = [_]model.FileReview{
    .{
        .path = "README.md",
        .status = .unchanged,
        .content = .{ .file = .{ .file = .{
            .name = "README.md",
            .contents = "# rvw\n\nAn integrated environment for reviewing code with a native core and web UI.\n",
        } } },
    },
    .{
        .path = "src/app/review.zig",
        .status = .modified,
        .content = .{ .diff = .{
            .oldFile = .{
                .name = "src/app/review.zig",
                .contents =
                \\const std = @import("std");
                \\
                \\pub const Review = struct {
                \\    files: []const []const u8,
                \\};
                \\
                \\pub fn open() void {
                \\    std.debug.print("opening review\\n", .{});
                \\}
                \\
                ,
            },
            .newFile = .{
                .name = "src/app/review.zig",
                .contents =
                \\const std = @import("std");
                \\
                \\pub const Review = struct {
                \\    id: []const u8,
                \\    files: []const File,
                \\};
                \\
                \\pub const File = struct {
                \\    path: []const u8,
                \\    status: Status,
                \\};
                \\
                \\pub fn open(review: Review) void {
                \\    std.debug.print("opening {s}\\n", .{review.id});
                \\}
                \\
                ,
            },
        } },
    },
    .{
        .path = "src/app/session.zig",
        .status = .added,
        .content = .{ .diff = .{
            .oldFile = null,
            .newFile = .{
                .name = "src/app/session.zig",
                .contents =
                \\pub const Session = struct {
                \\    repository_path: []const u8,
                \\    comparison: Comparison,
                \\};
                \\
                \\pub const Comparison = union(enum) {
                \\    working_tree,
                \\    commit_range: []const u8,
                \\};
                \\
                ,
            },
        } },
    },
    .{
        .path = "src/legacy.zig",
        .status = .deleted,
        .content = .{ .diff = .{
            .oldFile = .{
                .name = "src/legacy.zig",
                .contents =
                \\pub fn printFiles(files: []const []const u8) void {
                \\    for (files) |file| {
                \\        std.debug.print("{s}\\n", .{file});
                \\    }
                \\}
                \\
                ,
            },
            .newFile = null,
        } },
    },
    .{
        .path = "src/main.zig",
        .status = .unchanged,
        .content = .{ .file = .{ .file = .{
            .name = "src/main.zig",
            .contents =
            \\const std = @import("std");
            \\
            \\pub fn main() !void {
            \\    const stdout = std.io.getStdOut().writer();
            \\    try stdout.print("rvw\\n", .{});
            \\}
            \\
            ,
        } } },
    },
};

test "fixture provider returns known data and typed failures" {
    var fixture: FixtureProvider = .{};
    const injected = fixture.interface();
    const result = try injected.getOverview();
    try std.testing.expectEqualStrings("src/app/review.zig", result.initialPath);
    try std.testing.expectEqual(@as(usize, 5), result.files.len);
    try std.testing.expectEqualStrings("README.md", (try injected.getFileReview("working-tree", "README.md")).path);
    try std.testing.expectError(error.UnknownReview, injected.getFileReview("missing", "README.md"));
    try std.testing.expectError(error.UnknownFile, injected.getFileReview("working-tree", "missing"));
}
