const std = @import("std");
const config = @import("../config/config.zig");
const dispatcher_module = @import("dispatcher.zig");
const model = @import("model.zig");
const log = @import("../log/log.zig");
const output = @import("../output/output.zig");
const provider_module = @import("../provider/provider.zig");

const Allocator = std.mem.Allocator;
const Io = std.Io;

pub const Core = struct {
    allocator: Allocator,
    io: Io,
    review_provider: provider_module.review.ReviewProvider,
    text_search_ignore_aware_provider: provider_module.text_search.TextSearchProvider,
    text_search_all_files_provider: provider_module.text_search.TextSearchProvider,
    comment_provider: provider_module.comment.CommentProvider,
    clipboard: output.Clipboard,
    review_generation: usize = 0,
    logger: log.Logger,
    configuration: config.Snapshot,

    pub fn init(
        allocator: Allocator,
        io: Io,
        review_provider: provider_module.review.ReviewProvider,
        text_search_ignore_aware_provider: provider_module.text_search.TextSearchProvider,
        text_search_all_files_provider: provider_module.text_search.TextSearchProvider,
        comment_provider: provider_module.comment.CommentProvider,
        clipboard: output.Clipboard,
        logger: log.Logger,
        configuration: config.Snapshot,
    ) Core {
        return .{
            .allocator = allocator,
            .io = io,
            .review_provider = review_provider,
            .text_search_ignore_aware_provider = text_search_ignore_aware_provider,
            .text_search_all_files_provider = text_search_all_files_provider,
            .comment_provider = comment_provider,
            .clipboard = clipboard,
            .logger = logger,
            .configuration = configuration,
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
        if (request == .log) {
            self.logger.log(self.io, request.log);
            return .{ .log_result = .{ .accepted = true } };
        }
        const operation = operationName(request);
        return self.dispatchRequest(request) catch |err| {
            if (shouldLogRequestFailure(err)) {
                logRequestFailed(self.logger, self.io, operation, err);
            }
            return err;
        };
    }

    fn dispatchRequest(self: *Core, request: model.Request) !model.Response {
        return switch (request) {
            .log => unreachable,
            .get_configuration => .{ .configuration = self.configuration },
            .reload_review => blk: {
                self.review_provider.reload(self.io) catch return error.ReloadUnavailable;
                self.review_generation +%= 1;
                break :blk .{ .reload_review_result = .{ .generation = self.review_generation } };
            },
            .get_diff_overview => .{ .diff_overview = try self.review_provider.getDiffOverview(self.io) },
            .get_files => .{ .files = try self.review_provider.getFiles(self.io) },
            .get_files_not_ignored => .{ .files = try self.review_provider.getFilesNotIgnored(self.io) },
            .search_text => |details| blk: {
                const search_provider = switch (details.mode) {
                    .@"ignore-aware" => self.text_search_ignore_aware_provider,
                    .@"all-files" => self.text_search_all_files_provider,
                };
                break :blk .{ .text_search = try search_provider.search(self.io, self.review_provider.repositoryRoot(), details.query) };
            },
            .get_file => |details| .{ .file = .{
                .path = details.path,
                .status = .unchanged,
                .content = try self.review_provider.getFile(self.io, details.path),
            } },
            .get_file_diff => |details| .{
                .file_diff = try self.review_provider.getFileDiff(self.io, details.diff_id, details.path),
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
            .copy_file_path => |details| blk: {
                if (!validRepositoryRelativePath(details.path)) return error.InvalidFilePath;
                const copied_path = switch (details.format) {
                    .relative => details.path,
                    .absolute => try std.fs.path.join(self.allocator, &.{
                        self.review_provider.repositoryRoot(),
                        details.path,
                    }),
                };
                defer if (details.format == .absolute) self.allocator.free(copied_path);
                self.clipboard.copy(self.io, copied_path) catch
                    return error.FilePathClipboardUnavailable;
                break :blk .{ .copy_file_path_result = .{
                    .path = details.path,
                    .format = details.format,
                } };
            },
            .create_comment => |details| blk: {
                if (!validComment(details.body, details.comment_type, details.target)) return error.InvalidComment;
                break :blk .{ .comment = try self.comment_provider.createComment(
                    self.io,
                    details.body,
                    details.comment_type,
                    details.target,
                ) };
            },
            .edit_comment => |details| blk: {
                if (!validCommentId(details.comment_id)) return error.InvalidCommentId;
                if (!validCommentBody(details.body) or !validCommentType(details.comment_type)) return error.InvalidComment;
                break :blk .{ .comment = try self.comment_provider.editComment(
                    self.io,
                    details.comment_id,
                    details.body,
                    details.comment_type,
                ) };
            },
            .delete_comment => |details| blk: {
                if (!validCommentId(details.comment_id)) return error.InvalidCommentId;
                try self.comment_provider.deleteComment(self.io, details.comment_id);
                break :blk .{ .delete_comment_result = .{ .commentId = details.comment_id } };
            },
            .clear_comments => blk: {
                const count = try self.comment_provider.clearComments(self.io);
                break :blk .{ .clear_comments_result = .{ .commentCount = count } };
            },
        };
    }
};

fn operationName(request: model.Request) []const u8 {
    return switch (request) {
        .log => "log",
        .get_configuration => "get_configuration",
        .reload_review => "reload_review",
        .get_diff_overview => "get_diff_overview",
        .get_files => "get_files",
        .get_files_not_ignored => "get_files_not_ignored",
        .search_text => "search_text",
        .get_file => "get_file",
        .get_file_diff => "get_file_diff",
        .get_comments => "get_comments",
        .copy_comments_as_markdown => "copy_comments_as_markdown",
        .copy_file_path => "copy_file_path",
        .create_comment => "create_comment",
        .edit_comment => "edit_comment",
        .delete_comment => "delete_comment",
        .clear_comments => "clear_comments",
    };
}

fn shouldLogRequestFailure(err: anyerror) bool {
    return switch (model.errorCode(err)) {
        .reload_unavailable, .clipboard_unavailable, .internal_error => true,
        else => false,
    };
}

fn logRequestFailed(
    logger: log.Logger,
    io: Io,
    operation: []const u8,
    err: anyerror,
) void {
    var context: std.json.ObjectMap = .empty;
    defer context.deinit(logger.allocator);

    context.put(logger.allocator, "operation", .{ .string = operation }) catch
        return logRequestFailureWithoutContext(logger, io);
    context.put(logger.allocator, "errorCode", .{ .string = @errorName(err) }) catch
        return logRequestFailureWithoutContext(logger, io);

    logger.log(io, .{
        .level = .err,
        .source = .backend,
        .message = "request failed",
        .context = .{ .object = context },
    });
}

fn logRequestFailureWithoutContext(logger: log.Logger, io: Io) void {
    logger.log(io, .{
        .level = .err,
        .source = .backend,
        .message = "request failed",
    });
}

fn validComment(body: []const u8, comment_type: ?[]const u8, target: model.CommentTarget) bool {
    if (!validCommentBody(body) or !validCommentType(comment_type)) return false;
    return switch (target) {
        .file => |details| details.path.len > 0,
        .line => |details| details.path.len > 0 and
            details.startLine > 0 and
            details.endLine >= details.startLine,
    };
}

fn validCommentType(comment_type: ?[]const u8) bool {
    const value = comment_type orelse return true;
    return value.len > 0 and
        std.mem.trim(u8, value, &std.ascii.whitespace).len > 0 and
        std.mem.indexOfAny(u8, value, "\r\n") == null and
        std.unicode.utf8ValidateSlice(value);
}

fn validCommentBody(body: []const u8) bool {
    return std.mem.trim(u8, body, " \t\r\n").len > 0 and
        std.unicode.utf8ValidateSlice(body);
}

fn validCommentId(comment_id: []const u8) bool {
    return comment_id.len > 0 and
        comment_id.len <= 128 and
        std.mem.trim(u8, comment_id, " \t\r\n").len == comment_id.len and
        std.unicode.utf8ValidateSlice(comment_id);
}

fn validRepositoryRelativePath(path: []const u8) bool {
    if (path.len == 0 or !std.unicode.utf8ValidateSlice(path)) return false;
    if (std.fs.path.isAbsolute(path) or path[0] == '/' or
        std.mem.indexOfScalar(u8, path, '\\') != null or
        std.mem.indexOfScalar(u8, path, 0) != null) return false;

    var components = std.mem.splitScalar(u8, path, '/');
    while (components.next()) |component| {
        if (component.len == 0 or
            std.mem.eql(u8, component, ".") or
            std.mem.eql(u8, component, "..")) return false;
    }
    return true;
}

test "comment mutation validation rejects blank bodies and malformed IDs" {
    try std.testing.expect(validCommentBody("updated"));
    try std.testing.expect(!validCommentBody(" \n\t"));
    try std.testing.expect(validCommentType(null));
    try std.testing.expect(validCommentType("ISSUE"));
    try std.testing.expect(!validCommentType(""));
    try std.testing.expect(!validCommentType("MULTI\nLINE"));
    try std.testing.expect(validCommentId("comment-12"));
    try std.testing.expect(!validCommentId(""));
    try std.testing.expect(!validCommentId(" comment-12"));
}

test "only operational request failures are logged" {
    try std.testing.expect(!shouldLogRequestFailure(error.InvalidComment));
    try std.testing.expect(!shouldLogRequestFailure(error.UnknownFile));
    try std.testing.expect(shouldLogRequestFailure(error.ClipboardWriteFailed));
    try std.testing.expect(shouldLogRequestFailure(error.OutOfMemory));
}

test "request failure logging records only operation and error code" {
    const Recorder = struct {
        count: usize = 0,
        message: ?[]const u8 = null,
        operation: ?[]const u8 = null,
        error_code: ?[]const u8 = null,

        fn write(context: *anyopaque, _: Io, event: log.Event) !void {
            const self: *@This() = @ptrCast(@alignCast(context));
            self.count += 1;
            self.message = event.message;
            const fields = switch (event.context orelse return) {
                .object => |object| object,
                else => return,
            };
            self.operation = jsonString(fields.get("operation"));
            self.error_code = jsonString(fields.get("errorCode"));
        }

        fn jsonString(value: ?std.json.Value) ?[]const u8 {
            return switch (value orelse return null) {
                .string => |string| string,
                else => null,
            };
        }
    };

    var recorder: Recorder = .{};
    logRequestFailed(.{
        .allocator = std.testing.allocator,
        .context = &recorder,
        .vtable = &.{ .write = Recorder.write },
    }, std.testing.io, "get_file", error.AccessDenied);

    try std.testing.expectEqual(@as(usize, 1), recorder.count);
    try std.testing.expectEqualStrings("request failed", recorder.message.?);
    try std.testing.expectEqualStrings("get_file", recorder.operation.?);
    try std.testing.expectEqualStrings("AccessDenied", recorder.error_code.?);
}

test "core routes file listings and text search through their providers" {
    const ReviewStub = struct {
        all_paths: []const []const u8,
        visible_paths: []const []const u8,

        fn getDiffOverview(_: *anyopaque, _: Io) !model.DiffOverview {
            return error.TestUnexpectedResult;
        }
        fn getFileDiff(_: *anyopaque, _: Io, _: []const u8, _: []const u8) !model.FileDiff {
            return error.TestUnexpectedResult;
        }
        fn getFiles(context: *anyopaque, _: Io) ![]const []const u8 {
            const self: *@This() = @ptrCast(@alignCast(context));
            return self.all_paths;
        }
        fn getFilesNotIgnored(context: *anyopaque, _: Io) ![]const []const u8 {
            const self: *@This() = @ptrCast(@alignCast(context));
            return self.visible_paths;
        }
        fn getFile(_: *anyopaque, _: Io, _: []const u8) !model.FileContent {
            return error.UnknownFile;
        }
        fn reload(_: *anyopaque, _: Io) !void {}
        fn repositoryRoot(_: *anyopaque) []const u8 {
            return "/repository";
        }
        fn interface(self: *@This()) provider_module.review.ReviewProvider {
            return .{ .context = self, .vtable = &.{
                .getDiffOverview = getDiffOverview,
                .getFileDiff = getFileDiff,
                .getFiles = getFiles,
                .getFilesNotIgnored = getFilesNotIgnored,
                .getFile = getFile,
                .reload = reload,
                .repositoryRoot = repositoryRoot,
            } };
        }
    };

    var threaded: std.Io.Threaded = .init(std.testing.allocator, .{});
    defer threaded.deinit();
    var all_context: u8 = 0;
    var review: ReviewStub = .{
        .all_paths = &.{ "a.txt", "ignored.txt" },
        .visible_paths = &.{"a.txt"},
    };
    var comments = provider_module.comment.memory.MemoryProvider.init(std.testing.allocator);
    defer comments.deinit();
    var search_ignore_aware: provider_module.text_search.ripgrep.RipgrepProvider = .{ .allocator = std.testing.allocator, .mode = .@"ignore-aware" };
    var search_all_files: provider_module.text_search.ripgrep.RipgrepProvider = .{ .allocator = std.testing.allocator, .mode = .@"all-files" };
    var core = Core.init(
        std.testing.allocator,
        threaded.io(),
        review.interface(),
        search_ignore_aware.interface(),
        search_all_files.interface(),
        comments.interface(),
        .{ .context = &all_context, .vtable = &noop_clipboard_vtable },
        .{
            .allocator = std.testing.allocator,
            .context = &all_context,
            .vtable = &silent_logger_vtable,
        },
        .{ .configuration = .{ .object = .empty }, .diagnostic = null },
    );

    const protocol = @import("json_protocol.zig");
    for (std.enums.values(model.TextSearchMode)) |mode| {
        const input = try std.json.Stringify.valueAlloc(std.testing.allocator, .{ .type = "search_text", .query = "", .mode = mode }, .{});
        defer std.testing.allocator.free(input);
        const response = try protocol.dispatchJson(std.testing.allocator, core.dispatcher(), input);
        defer std.testing.allocator.free(response);
        try std.testing.expectEqualStrings(
            \\{"ok":true,"data":{"matches":[],"truncated":false}}
        , response);
        const empty = (try core.dispatch(.{ .search_text = .{ .query = "", .mode = mode } })).text_search;
        try std.testing.expectEqual(@as(usize, 0), empty.matches.len);
        try std.testing.expect(!empty.truncated);
        try std.testing.expectError(error.InvalidSearchQuery, core.dispatch(.{ .search_text = .{ .query = "a\nb", .mode = mode } }));
    }

    const RecordingSearch = struct {
        calls: usize = 0,
        fn search(ptr: *anyopaque, _: Io, directory: []const u8, query: []const u8) !model.TextSearchResult {
            const self: *@This() = @ptrCast(@alignCast(ptr));
            try std.testing.expectEqualStrings("/repository", directory);
            try std.testing.expectEqualStrings("😀", query);
            self.calls += 1;
            return .{ .matches = &.{.{ .path = "unchanged.txt", .lineNumber = 2, .lineText = "a😀", .spans = &.{.{ .start = 1, .end = 3 }} }}, .truncated = true };
        }
    };
    var ignore_aware_recording: RecordingSearch = .{};
    var all_files_recording: RecordingSearch = .{};
    core.text_search_ignore_aware_provider = .{ .context = &ignore_aware_recording, .vtable = &.{ .search = RecordingSearch.search } };
    core.text_search_all_files_provider = .{ .context = &all_files_recording, .vtable = &.{ .search = RecordingSearch.search } };
    for (std.enums.values(model.TextSearchMode)) |mode| {
        const result = (try core.dispatch(.{ .search_text = .{ .query = "😀", .mode = mode } })).text_search;
        try std.testing.expectEqual(@as(usize, 1), ignore_aware_recording.calls);
        try std.testing.expectEqual(@as(usize, if (mode == .@"all-files") 1 else 0), all_files_recording.calls);
        try std.testing.expect(result.truncated);
        try std.testing.expectEqualStrings("unchanged.txt", result.matches[0].path);
        try std.testing.expectEqual(@as(usize, 2), result.matches[0].lineNumber);
    }

    const all_files = (try core.dispatch(.get_files)).files;
    try std.testing.expectEqual(@as(usize, 2), all_files.len);
    try std.testing.expectEqualStrings("ignored.txt", all_files[1]);

    const visible_files = (try core.dispatch(.get_files_not_ignored)).files;
    try std.testing.expectEqual(@as(usize, 1), visible_files.len);
    try std.testing.expectEqualStrings("a.txt", visible_files[0]);
}

test "core reload replaces the review snapshot without touching comments and preserves it on failure" {
    const ReviewStub = struct {
        version: usize = 1,
        fail_reload: bool = false,

        const first_files = [_]model.FileSummary{.{
            .path = "before.txt",
            .status = .modified,
            .additions = 1,
            .deletions = 0,
        }};
        const second_files = [_]model.FileSummary{.{
            .path = "after.txt",
            .status = .added,
            .additions = 1,
            .deletions = 0,
        }};

        fn getDiffOverview(context: *anyopaque, _: Io) !model.DiffOverview {
            const self: *@This() = @ptrCast(@alignCast(context));
            return if (self.version == 1) .{
                .id = "snapshot-1",
                .repository = .{ .name = "repository" },
                .source = .{ .working_tree = .{ .base = "base" } },
                .initialPath = "before.txt",
                .files = &first_files,
            } else .{
                .id = "snapshot-2",
                .repository = .{ .name = "repository" },
                .source = .{ .working_tree = .{ .base = "base" } },
                .initialPath = "after.txt",
                .files = &second_files,
            };
        }
        fn getFileDiff(_: *anyopaque, _: Io, _: []const u8, _: []const u8) !model.FileDiff {
            return error.UnknownFile;
        }
        fn getFiles(_: *anyopaque, _: Io) ![]const []const u8 {
            return &.{};
        }
        fn getFilesNotIgnored(context: *anyopaque, io: Io) ![]const []const u8 {
            return getFiles(context, io);
        }
        fn getFile(_: *anyopaque, _: Io, _: []const u8) !model.FileContent {
            return error.UnknownFile;
        }
        fn reload(context: *anyopaque, _: Io) !void {
            const self: *@This() = @ptrCast(@alignCast(context));
            if (self.fail_reload) return error.SnapshotBuildFailed;
            self.version += 1;
        }
        fn repositoryRoot(_: *anyopaque) []const u8 {
            return "/repository";
        }
        const vtable: provider_module.review.ReviewProvider.VTable = .{
            .getDiffOverview = getDiffOverview,
            .getFileDiff = getFileDiff,
            .getFiles = getFiles,
            .getFilesNotIgnored = getFilesNotIgnored,
            .getFile = getFile,
            .reload = reload,
            .repositoryRoot = repositoryRoot,
        };
    };

    var threaded: std.Io.Threaded = .init(std.testing.allocator, .{});
    defer threaded.deinit();
    var review: ReviewStub = .{};
    var comments = provider_module.comment.memory.MemoryProvider.init(std.testing.allocator);
    defer comments.deinit();
    var context: u8 = 0;
    var search_ignore_aware: provider_module.text_search.ripgrep.RipgrepProvider = .{ .allocator = std.testing.allocator, .mode = .@"ignore-aware" };
    var search_all_files: provider_module.text_search.ripgrep.RipgrepProvider = .{ .allocator = std.testing.allocator, .mode = .@"all-files" };
    var core = Core.init(
        std.testing.allocator,
        threaded.io(),
        .{ .context = &review, .vtable = &ReviewStub.vtable },
        search_ignore_aware.interface(),
        search_all_files.interface(),
        comments.interface(),
        .{ .context = &context, .vtable = &noop_clipboard_vtable },
        .{
            .allocator = std.testing.allocator,
            .context = &context,
            .vtable = &silent_logger_vtable,
        },
        .{ .configuration = .{ .object = .empty }, .diagnostic = null },
    );

    _ = try core.dispatch(.{ .create_comment = .{
        .body = "keep me",
        .target = .{ .file = .{ .path = "before.txt" } },
    } });
    const result = (try core.dispatch(.reload_review)).reload_review_result;
    try std.testing.expectEqual(@as(usize, 1), result.generation);
    try std.testing.expectEqualStrings("snapshot-2", (try core.dispatch(.get_diff_overview)).diff_overview.id);
    try std.testing.expectEqualStrings("keep me", (try core.dispatch(.get_comments)).comments[0].body);

    review.fail_reload = true;
    try std.testing.expectError(error.ReloadUnavailable, core.dispatch(.reload_review));
    try std.testing.expectEqualStrings("snapshot-2", (try core.dispatch(.get_diff_overview)).diff_overview.id);
    try std.testing.expectEqualStrings("keep me", (try core.dispatch(.get_comments)).comments[0].body);
}

const noop_clipboard_vtable: output.Clipboard.VTable = .{
    .copy = noopCopy,
};

fn noopCopy(_: *anyopaque, _: Io, _: []const u8) !void {}

const silent_logger_vtable: log.Logger.VTable = .{
    .write = silentLog,
};

fn silentLog(_: *anyopaque, _: Io, _: log.Event) !void {}

test "core edits and deletes only the requested comment with useful errors" {
    const TestDependencies = struct {
        fn getDiffOverview(_: *anyopaque, _: Io) !model.DiffOverview {
            return error.TestUnexpectedResult;
        }

        fn getFileDiff(_: *anyopaque, _: Io, _: []const u8, _: []const u8) !model.FileDiff {
            return error.TestUnexpectedResult;
        }

        fn getFiles(_: *anyopaque, _: Io) ![]const []const u8 {
            return &.{};
        }
        fn getFilesNotIgnored(context: *anyopaque, io: Io) ![]const []const u8 {
            return getFiles(context, io);
        }

        fn getFile(_: *anyopaque, _: Io, _: []const u8) !model.FileContent {
            return error.UnknownFile;
        }

        fn copy(_: *anyopaque, _: Io, _: []const u8) !void {}
        fn reload(_: *anyopaque, _: Io) !void {}
        fn repositoryRoot(_: *anyopaque) []const u8 {
            return "/repository";
        }
        fn writeLog(_: *anyopaque, _: Io, _: log.Event) !void {}

        const review_vtable: provider_module.review.ReviewProvider.VTable = .{
            .getDiffOverview = getDiffOverview,
            .getFileDiff = getFileDiff,
            .getFiles = getFiles,
            .getFilesNotIgnored = getFilesNotIgnored,
            .getFile = getFile,
            .reload = reload,
            .repositoryRoot = repositoryRoot,
        };
        const clipboard_vtable: output.Clipboard.VTable = .{ .copy = copy };
        const logger_vtable: log.Logger.VTable = .{ .write = writeLog };
    };

    var threaded: std.Io.Threaded = .init(std.testing.allocator, .{});
    defer threaded.deinit();
    var context: u8 = 0;
    var comments = provider_module.comment.memory.MemoryProvider.init(std.testing.allocator);
    defer comments.deinit();
    var search_ignore_aware: provider_module.text_search.ripgrep.RipgrepProvider = .{ .allocator = std.testing.allocator, .mode = .@"ignore-aware" };
    var search_all_files: provider_module.text_search.ripgrep.RipgrepProvider = .{ .allocator = std.testing.allocator, .mode = .@"all-files" };
    var core = Core.init(
        std.testing.allocator,
        threaded.io(),
        .{ .context = &context, .vtable = &TestDependencies.review_vtable },
        search_ignore_aware.interface(),
        search_all_files.interface(),
        comments.interface(),
        .{ .context = &context, .vtable = &TestDependencies.clipboard_vtable },
        .{
            .allocator = std.testing.allocator,
            .context = &context,
            .vtable = &TestDependencies.logger_vtable,
        },
        .{ .configuration = .{ .object = .empty }, .diagnostic = null },
    );

    const first = (try core.dispatch(.{ .create_comment = .{
        .body = "first",
        .comment_type = "ISSUE",
        .target = .{ .file = .{ .path = "README.md" } },
    } })).comment;
    const second = (try core.dispatch(.{ .create_comment = .{
        .body = "second",
        .target = .{ .file = .{ .path = "LICENSE" } },
    } })).comment;
    const first_id = try std.testing.allocator.dupe(u8, first.id);
    defer std.testing.allocator.free(first_id);

    const edited = (try core.dispatch(.{ .edit_comment = .{
        .comment_id = first_id,
        .body = "updated",
        .comment_type = "QUESTION",
    } })).comment;
    try std.testing.expectEqualStrings(first_id, edited.id);
    try std.testing.expectEqualStrings("updated", edited.body);
    try std.testing.expectEqualStrings("QUESTION", edited.commentType.?);
    try std.testing.expectEqualStrings("README.md", edited.target.file.path);
    try std.testing.expectError(error.InvalidComment, core.dispatch(.{ .edit_comment = .{
        .comment_id = first_id,
        .body = "  \n",
    } }));
    try std.testing.expectError(error.InvalidComment, core.dispatch(.{ .edit_comment = .{
        .comment_id = first_id,
        .body = "valid",
        .comment_type = "MULTI\nLINE",
    } }));
    try std.testing.expectError(error.InvalidCommentId, core.dispatch(.{ .delete_comment = .{
        .comment_id = " invalid",
    } }));
    try std.testing.expectError(error.UnknownComment, core.dispatch(.{ .edit_comment = .{
        .comment_id = "comment-99",
        .body = "missing",
    } }));

    const deleted = (try core.dispatch(.{ .delete_comment = .{
        .comment_id = first_id,
    } })).delete_comment_result;
    try std.testing.expectEqualStrings(first_id, deleted.commentId);
    try std.testing.expectError(error.UnknownComment, core.dispatch(.{ .delete_comment = .{
        .comment_id = first_id,
    } }));
    const remaining = (try core.dispatch(.get_comments)).comments;
    try std.testing.expectEqual(@as(usize, 1), remaining.len);
    try std.testing.expectEqualStrings(second.id, remaining[0].id);
    try std.testing.expectEqualStrings("second", remaining[0].body);

    const cleared = (try core.dispatch(.clear_comments)).clear_comments_result;
    try std.testing.expectEqual(@as(usize, 1), cleared.commentCount);
    const empty = (try core.dispatch(.get_comments)).comments;
    try std.testing.expectEqual(@as(usize, 0), empty.len);
    const cleared_again = (try core.dispatch(.clear_comments)).clear_comments_result;
    try std.testing.expectEqual(@as(usize, 0), cleared_again.commentCount);
}

test "core copies validated file paths exactly without accessing the file" {
    const TestDependencies = struct {
        copied: [256]u8 = undefined,
        copied_len: usize = 0,
        fail_copy: bool = false,

        fn getDiffOverview(_: *anyopaque, _: Io) !model.DiffOverview {
            return error.TestUnexpectedResult;
        }
        fn getFileDiff(_: *anyopaque, _: Io, _: []const u8, _: []const u8) !model.FileDiff {
            return error.TestUnexpectedResult;
        }
        fn getFiles(_: *anyopaque, _: Io) ![]const []const u8 {
            return &.{};
        }
        fn getFilesNotIgnored(context: *anyopaque, io: Io) ![]const []const u8 {
            return getFiles(context, io);
        }
        fn getFile(_: *anyopaque, _: Io, _: []const u8) !model.FileContent {
            return error.TestUnexpectedResult;
        }
        fn copy(context: *anyopaque, _: Io, text: []const u8) !void {
            const self: *@This() = @ptrCast(@alignCast(context));
            if (self.fail_copy) return error.ClipboardWriteFailed;
            @memcpy(self.copied[0..text.len], text);
            self.copied_len = text.len;
        }
        fn reload(_: *anyopaque, _: Io) !void {}
        fn repositoryRoot(_: *anyopaque) []const u8 {
            return "/repo root";
        }
        fn writeLog(_: *anyopaque, _: Io, _: log.Event) !void {}

        const review_vtable: provider_module.review.ReviewProvider.VTable = .{
            .getDiffOverview = getDiffOverview,
            .getFileDiff = getFileDiff,
            .getFiles = getFiles,
            .getFilesNotIgnored = getFilesNotIgnored,
            .getFile = getFile,
            .reload = reload,
            .repositoryRoot = repositoryRoot,
        };
        const clipboard_vtable: output.Clipboard.VTable = .{ .copy = copy };
        const logger_vtable: log.Logger.VTable = .{ .write = writeLog };
    };

    var threaded: std.Io.Threaded = .init(std.testing.allocator, .{});
    defer threaded.deinit();
    var dependencies: TestDependencies = .{};
    var comments = provider_module.comment.memory.MemoryProvider.init(std.testing.allocator);
    defer comments.deinit();
    var search_ignore_aware: provider_module.text_search.ripgrep.RipgrepProvider = .{ .allocator = std.testing.allocator, .mode = .@"ignore-aware" };
    var search_all_files: provider_module.text_search.ripgrep.RipgrepProvider = .{ .allocator = std.testing.allocator, .mode = .@"all-files" };
    var core = Core.init(
        std.testing.allocator,
        threaded.io(),
        .{ .context = &dependencies, .vtable = &TestDependencies.review_vtable },
        search_ignore_aware.interface(),
        search_all_files.interface(),
        comments.interface(),
        .{ .context = &dependencies, .vtable = &TestDependencies.clipboard_vtable },
        .{
            .allocator = std.testing.allocator,
            .context = &dependencies,
            .vtable = &TestDependencies.logger_vtable,
        },
        .{ .configuration = .{ .object = .empty }, .diagnostic = null },
    );

    const relative_path = "nested/deleted ü.txt";
    const relative = (try core.dispatch(.{ .copy_file_path = .{
        .path = relative_path,
        .format = .relative,
    } })).copy_file_path_result;
    try std.testing.expectEqualStrings(relative_path, dependencies.copied[0..dependencies.copied_len]);
    try std.testing.expectEqualStrings(relative_path, relative.path);
    try std.testing.expectEqual(model.FilePathFormat.relative, relative.format);

    _ = try core.dispatch(.{ .copy_file_path = .{
        .path = relative_path,
        .format = .absolute,
    } });
    try std.testing.expectEqualStrings(
        "/repo root/nested/deleted ü.txt",
        dependencies.copied[0..dependencies.copied_len],
    );

    const invalid_paths = [_][]const u8{
        "",
        "/etc/passwd",
        "../secret",
        "nested/../secret",
        "nested//file",
        "nested\\file",
    };
    for (&invalid_paths) |path| {
        try std.testing.expectError(error.InvalidFilePath, core.dispatch(.{ .copy_file_path = .{
            .path = path,
            .format = .relative,
        } }));
    }

    dependencies.fail_copy = true;
    try std.testing.expectError(error.FilePathClipboardUnavailable, core.dispatch(.{ .copy_file_path = .{
        .path = "README.md",
        .format = .relative,
    } }));
}

test "relay acknowledges filtered events and writes once without recursive instrumentation" {
    const Recorder = struct {
        count: usize = 0,
        fn write(ptr: *anyopaque, _: Io, event: log.Event) !void {
            const self: *@This() = @ptrCast(@alignCast(ptr));
            self.count += 1;
            try std.testing.expectEqual(log.Source.frontend, event.source);
            try std.testing.expectEqualStrings("relay test event", event.message);
        }
    };
    var recorder: Recorder = .{};
    var core: Core = undefined;
    core.io = std.testing.io;
    core.logger = .{ .allocator = std.testing.allocator, .context = &recorder, .vtable = &.{ .write = Recorder.write } };
    const request: model.Request = .{ .log = .{ .level = .info, .source = .frontend, .message = "relay test event" } };
    try std.testing.expect((try core.dispatch(request)).log_result.accepted);
    try std.testing.expectEqual(@as(usize, 0), recorder.count);
    core.logger.minimum_level = .debug;
    try std.testing.expect((try core.dispatch(request)).log_result.accepted);
    try std.testing.expectEqual(@as(usize, 1), recorder.count);
}
