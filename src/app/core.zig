const std = @import("std");
const dispatcher_module = @import("dispatcher.zig");
const model = @import("model.zig");
const log = @import("../log.zig");
const output = @import("../output.zig");
const provider_module = @import("../provider.zig");

const Allocator = std.mem.Allocator;
const Io = std.Io;

pub const Core = struct {
    allocator: Allocator,
    io: Io,
    diff_provider: provider_module.diff.DiffProvider,
    file_provider: provider_module.file.FileProvider,
    comment_provider: provider_module.comment.CommentProvider,
    clipboard: output.Clipboard,
    logger: log.Logger,

    pub fn init(
        allocator: Allocator,
        io: Io,
        diff_provider: provider_module.diff.DiffProvider,
        file_provider: provider_module.file.FileProvider,
        comment_provider: provider_module.comment.CommentProvider,
        clipboard: output.Clipboard,
        logger: log.Logger,
    ) Core {
        return .{
            .allocator = allocator,
            .io = io,
            .diff_provider = diff_provider,
            .file_provider = file_provider,
            .comment_provider = comment_provider,
            .clipboard = clipboard,
            .logger = logger,
        };
    }

    pub fn dispatcher(self: *Core) dispatcher_module.Dispatcher {
        return .{ .context = self, .dispatchFn = dispatchOpaque };
    }

    fn dispatchOpaque(context: *anyopaque, request: model.Request) !model.Response {
        const self: *Core = @ptrCast(@alignCast(context));
        return self.dispatch(request);
    }

    pub fn dispatch(self: *Core, request: model.Request) !model.Response {
        return switch (request) {
            .get_diff_overview => .{ .diff_overview = try self.diff_provider.getDiffOverview(self.io) },
            .get_files => .{ .files = try self.file_provider.getFiles(self.io) },
            .get_file => |details| .{ .file = .{
                .path = details.path,
                .status = .unchanged,
                .content = try self.file_provider.getFile(self.io, details.path),
            } },
            .get_file_diff => |details| .{
                .file_diff = try self.diff_provider.getFileDiff(self.io, details.diff_id, details.path),
            },
            .get_comments => .{ .comments = try self.comment_provider.getComments(self.io) },
            .copy_comments_as_markdown => blk: {
                const comments = try self.comment_provider.getComments(self.io);
                if (comments.len == 0) return error.NoComments;

                const markdown = try output.markdown.serialize(self.allocator, comments);
                defer self.allocator.free(markdown);
                try self.clipboard.copy(self.io, markdown);
                break :blk .{ .copy_comments_result = .{ .commentCount = comments.len } };
            },
            .create_comment => |details| blk: {
                if (!validComment(details.body, details.target)) return error.InvalidComment;
                break :blk .{ .comment = try self.comment_provider.createComment(
                    self.io,
                    details.body,
                    details.target,
                ) };
            },
            .log => |details| blk: {
                if (!validLogMessage(details.message)) return error.InvalidLogEntry;
                self.logger.log(self.io, .{
                    .level = details.level,
                    .source = .frontend,
                    .message = details.message,
                    .context = details.context,
                    .metrics = details.metrics,
                });
                break :blk .log;
            },
        };
    }
};

test "copy comments as Markdown serializes all comments and copies once" {
    var threaded: Io.Threaded = .init(std.testing.allocator, .{ .environ = .empty });
    defer threaded.deinit();

    var comments = provider_module.comment.memory.MemoryProvider.init(std.testing.allocator);
    defer comments.deinit();
    _ = try comments.interface().createComment(threaded.io(), "Handle this error.", .{ .line = .{
        .path = "src/main.zig",
        .side = .new,
        .startLine = 7,
        .endLine = 7,
    } });

    const FakeClipboard = struct {
        copied: [128]u8 = undefined,
        copied_len: usize = 0,
        calls: usize = 0,

        fn copy(context: *anyopaque, _: Io, text: []const u8) !void {
            const self: *@This() = @ptrCast(@alignCast(context));
            @memcpy(self.copied[0..text.len], text);
            self.copied_len = text.len;
            self.calls += 1;
        }
    };
    var fake_clipboard: FakeClipboard = .{};
    const clipboard: output.Clipboard = .{
        .context = &fake_clipboard,
        .vtable = &.{ .copy = FakeClipboard.copy },
    };

    var fake_diff_context: u8 = 0;
    const fake_diff: provider_module.diff.DiffProvider = .{
        .context = &fake_diff_context,
        .vtable = &.{
            .getDiffOverview = struct {
                fn get(_: *anyopaque, _: Io) !model.DiffOverview {
                    return error.UnexpectedDiffRequest;
                }
            }.get,
            .getFileDiff = struct {
                fn get(_: *anyopaque, _: Io, _: []const u8, _: []const u8) !model.FileDiff {
                    return error.UnexpectedDiffRequest;
                }
            }.get,
        },
    };

    var core = Core.init(
        std.testing.allocator,
        threaded.io(),
        fake_diff,
        .{ .context = &fake_diff_context, .vtable = undefined },
        comments.interface(),
        clipboard,
        log.stderrLogger(std.testing.allocator),
    );
    const response = try core.dispatch(.copy_comments_as_markdown);
    switch (response) {
        .copy_comments_result => |result| try std.testing.expectEqual(@as(usize, 1), result.commentCount),
        else => return error.UnexpectedResponse,
    }
    try std.testing.expectEqual(@as(usize, 1), fake_clipboard.calls);
    try std.testing.expectEqualStrings(
        "- src/main.zig:7 - Handle this error.\n",
        fake_clipboard.copied[0..fake_clipboard.copied_len],
    );
}

test "copy comments as Markdown rejects an empty review" {
    var threaded: Io.Threaded = .init(std.testing.allocator, .{ .environ = .empty });
    defer threaded.deinit();

    var comments = provider_module.comment.memory.MemoryProvider.init(std.testing.allocator);
    defer comments.deinit();
    var unused_context: u8 = 0;
    const unused_diff: provider_module.diff.DiffProvider = .{
        .context = &unused_context,
        .vtable = undefined,
    };
    const unused_clipboard: output.Clipboard = .{
        .context = &unused_context,
        .vtable = undefined,
    };
    var core = Core.init(
        std.testing.allocator,
        threaded.io(),
        unused_diff,
        .{ .context = &unused_context, .vtable = undefined },
        comments.interface(),
        unused_clipboard,
        log.stderrLogger(std.testing.allocator),
    );

    try std.testing.expectError(error.NoComments, core.dispatch(.copy_comments_as_markdown));
}

test "copy comments as Markdown propagates clipboard failures" {
    var threaded: Io.Threaded = .init(std.testing.allocator, .{ .environ = .empty });
    defer threaded.deinit();

    var comments = provider_module.comment.memory.MemoryProvider.init(std.testing.allocator);
    defer comments.deinit();
    _ = try comments.interface().createComment(threaded.io(), "Explain this branch.", .{
        .file = .{ .path = "src/main.zig" },
    });

    const FailingClipboard = struct {
        fn copy(_: *anyopaque, _: Io, _: []const u8) !void {
            return error.ClipboardCommandFailed;
        }
    };
    var unused_context: u8 = 0;
    const unused_diff: provider_module.diff.DiffProvider = .{
        .context = &unused_context,
        .vtable = undefined,
    };
    const clipboard: output.Clipboard = .{
        .context = &unused_context,
        .vtable = &.{ .copy = FailingClipboard.copy },
    };
    var core = Core.init(
        std.testing.allocator,
        threaded.io(),
        unused_diff,
        .{ .context = &unused_context, .vtable = undefined },
        comments.interface(),
        clipboard,
        log.stderrLogger(std.testing.allocator),
    );

    try std.testing.expectError(
        error.ClipboardCommandFailed,
        core.dispatch(.copy_comments_as_markdown),
    );
}

test "file provider operations list paths and wrap unchanged file content" {
    var threaded: Io.Threaded = .init(std.testing.allocator, .{ .environ = .empty });
    defer threaded.deinit();

    const FakeFiles = struct {
        const paths: []const []const u8 = &.{ "README.md", "src/main.zig" };

        fn getFiles(_: *anyopaque, _: Io) ![]const []const u8 {
            return paths;
        }

        fn getFile(_: *anyopaque, _: Io, path: []const u8) !model.FileContent {
            if (!std.mem.eql(u8, path, "README.md")) return error.UnknownFile;
            return .{ .file = .{ .file = .{ .name = "README.md", .contents = "hello\n" } } };
        }
    };
    var context: u8 = 0;
    const files: provider_module.file.FileProvider = .{
        .context = &context,
        .vtable = &.{ .getFiles = FakeFiles.getFiles, .getFile = FakeFiles.getFile },
    };
    const unused_diff: provider_module.diff.DiffProvider = .{ .context = &context, .vtable = undefined };
    const unused_comments: provider_module.comment.CommentProvider = .{ .context = &context, .vtable = undefined };
    const unused_clipboard: output.Clipboard = .{ .context = &context, .vtable = undefined };
    var core = Core.init(
        std.testing.allocator,
        threaded.io(),
        unused_diff,
        files,
        unused_comments,
        unused_clipboard,
    );

    switch (try core.dispatch(.get_files)) {
        .files => |paths| {
            try std.testing.expectEqual(@as(usize, 2), paths.len);
            try std.testing.expectEqualStrings("src/main.zig", paths[1]);
        },
        else => return error.UnexpectedResponse,
    }
    switch (try core.dispatch(.{ .get_file = .{ .path = "README.md" } })) {
        .file => |file| {
            try std.testing.expectEqual(.unchanged, file.status);
            try std.testing.expectEqualStrings("README.md", file.path);
            switch (file.content) {
                .file => |content| try std.testing.expectEqualStrings("hello\n", content.file.contents),
                else => return error.UnexpectedContent,
            }
        },
        else => return error.UnexpectedResponse,
    }
}

fn validComment(body: []const u8, target: model.CommentTarget) bool {
    if (std.mem.trim(u8, body, " \t\r\n").len == 0) return false;
    return switch (target) {
        .file => |details| details.path.len > 0,
        .line => |details| details.path.len > 0 and
            details.startLine > 0 and
            details.endLine >= details.startLine,
    };
}

fn validLogMessage(message: []const u8) bool {
    return message.len > 0 and
        message.len <= log.maximum_message_size and
        std.unicode.utf8ValidateSlice(message);
}

test "frontend logging validates messages and uses the shared logger" {
    var threaded: Io.Threaded = .init(std.testing.allocator, .{ .environ = .empty });
    defer threaded.deinit();

    const Capture = struct {
        calls: usize = 0,
        source: ?log.Source = null,
        message: []const u8 = "",

        fn write(context: *anyopaque, _: Io, event: log.Event) !void {
            const self: *@This() = @ptrCast(@alignCast(context));
            self.calls += 1;
            self.source = event.source;
            self.message = event.message;
        }
    };
    var capture: Capture = .{};
    const logger: log.Logger = .{
        .allocator = std.testing.allocator,
        .context = &capture,
        .vtable = &.{ .write = Capture.write },
    };
    var unused_context: u8 = 0;
    const unused_diff: provider_module.diff.DiffProvider = .{ .context = &unused_context, .vtable = undefined };
    const unused_comments: provider_module.comment.CommentProvider = .{ .context = &unused_context, .vtable = undefined };
    const unused_clipboard: output.Clipboard = .{ .context = &unused_context, .vtable = undefined };
    var core = Core.init(
        std.testing.allocator,
        threaded.io(),
        unused_diff,
        unused_comments,
        unused_clipboard,
        logger,
    );

    try std.testing.expectEqual(
        model.Response.log,
        try core.dispatch(.{ .log = .{ .level = .info, .message = "render complete" } }),
    );
    try std.testing.expectEqual(@as(usize, 1), capture.calls);
    try std.testing.expectEqual(log.Source.frontend, capture.source.?);
    try std.testing.expectEqualStrings("render complete", capture.message);

    try std.testing.expectError(
        error.InvalidLogEntry,
        core.dispatch(.{ .log = .{ .level = .debug, .message = "" } }),
    );
    const oversized = try std.testing.allocator.alloc(u8, log.maximum_message_size + 1);
    defer std.testing.allocator.free(oversized);
    @memset(oversized, 'x');
    try std.testing.expectError(
        error.InvalidLogEntry,
        core.dispatch(.{ .log = .{ .level = .err, .message = oversized } }),
    );
}
