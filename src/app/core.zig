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
    diff_provider: provider_module.diff.DiffProvider,
    file_provider: provider_module.file.FileProvider,
    all_files_tree_provider: provider_module.filetree.FileTreeProvider,
    visible_files_tree_provider: provider_module.filetree.FileTreeProvider,
    comment_provider: provider_module.comment.CommentProvider,
    clipboard: output.Clipboard,
    repository_root: []const u8,
    logger: log.Logger,
    configuration: config.Snapshot,

    pub fn init(
        allocator: Allocator,
        io: Io,
        diff_provider: provider_module.diff.DiffProvider,
        file_provider: provider_module.file.FileProvider,
        all_files_tree_provider: provider_module.filetree.FileTreeProvider,
        visible_files_tree_provider: provider_module.filetree.FileTreeProvider,
        comment_provider: provider_module.comment.CommentProvider,
        clipboard: output.Clipboard,
        repository_root: []const u8,
        logger: log.Logger,
        configuration: config.Snapshot,
    ) Core {
        return .{
            .allocator = allocator,
            .io = io,
            .diff_provider = diff_provider,
            .file_provider = file_provider,
            .all_files_tree_provider = all_files_tree_provider,
            .visible_files_tree_provider = visible_files_tree_provider,
            .comment_provider = comment_provider,
            .clipboard = clipboard,
            .repository_root = repository_root,
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
            .get_configuration => .{ .configuration = self.configuration },
            .get_diff_overview => .{ .diff_overview = try self.diff_provider.getDiffOverview(self.io) },
            .get_files => .{ .files = try self.all_files_tree_provider.getFiles(self.io) },
            .get_files_not_ignored => .{ .files = try self.visible_files_tree_provider.getFiles(self.io) },
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
            .copy_file_path => |details| blk: {
                if (!validRepositoryRelativePath(details.path)) return error.InvalidFilePath;
                const copied_path = switch (details.format) {
                    .relative => details.path,
                    .absolute => try std.fs.path.join(self.allocator, &.{
                        self.repository_root,
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
                if (!validComment(details.body, details.target)) return error.InvalidComment;
                break :blk .{ .comment = try self.comment_provider.createComment(
                    self.io,
                    details.body,
                    details.target,
                ) };
            },
            .edit_comment => |details| blk: {
                if (!validCommentId(details.comment_id)) return error.InvalidCommentId;
                if (!validCommentBody(details.body)) return error.InvalidComment;
                break :blk .{ .comment = try self.comment_provider.editComment(
                    self.io,
                    details.comment_id,
                    details.body,
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
        .get_configuration => "get_configuration",
        .get_diff_overview => "get_diff_overview",
        .get_files => "get_files",
        .get_files_not_ignored => "get_files_not_ignored",
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
        .clipboard_unavailable, .internal_error => true,
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

fn validComment(body: []const u8, target: model.CommentTarget) bool {
    if (!validCommentBody(body)) return false;
    return switch (target) {
        .file => |details| details.path.len > 0,
        .line => |details| details.path.len > 0 and
            details.startLine > 0 and
            details.endLine >= details.startLine,
    };
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

test "core routes file listing variants through their tree providers" {
    const TreeStub = struct {
        paths: []const []const u8,

        fn getFiles(context: *anyopaque, _: Io) ![]const []const u8 {
            const self: *@This() = @ptrCast(@alignCast(context));
            return self.paths;
        }

        fn interface(self: *@This()) provider_module.filetree.FileTreeProvider {
            return .{ .context = self, .vtable = &.{ .getFiles = getFiles } };
        }
    };

    var threaded: std.Io.Threaded = .init(std.testing.allocator, .{});
    defer threaded.deinit();
    var all_context: u8 = 0;
    var all_tree: TreeStub = .{ .paths = &.{ "a.txt", "ignored.txt" } };
    var visible_tree: TreeStub = .{ .paths = &.{"a.txt"} };
    var comments = provider_module.comment.memory.MemoryProvider.init(std.testing.allocator);
    defer comments.deinit();
    var core = Core.init(
        std.testing.allocator,
        threaded.io(),
        .{ .context = &all_context, .vtable = &failed_diff_vtable },
        .{ .context = &all_context, .vtable = &empty_file_vtable },
        all_tree.interface(),
        visible_tree.interface(),
        comments.interface(),
        .{ .context = &all_context, .vtable = &noop_clipboard_vtable },
        "/repository",
        .{
            .allocator = std.testing.allocator,
            .context = &all_context,
            .vtable = &silent_logger_vtable,
        },
        .{ .configuration = .{ .object = .empty }, .diagnostic = null },
    );

    const all_files = (try core.dispatch(.get_files)).files;
    try std.testing.expectEqual(@as(usize, 2), all_files.len);
    try std.testing.expectEqualStrings("ignored.txt", all_files[1]);

    const visible_files = (try core.dispatch(.get_files_not_ignored)).files;
    try std.testing.expectEqual(@as(usize, 1), visible_files.len);
    try std.testing.expectEqualStrings("a.txt", visible_files[0]);
}

const empty_file_vtable: provider_module.file.FileProvider.VTable = .{
    .getFile = emptyGetFile,
};

fn emptyGetFile(_: *anyopaque, _: Io, _: []const u8) !model.FileContent {
    return error.UnknownFile;
}

const noop_clipboard_vtable: output.Clipboard.VTable = .{
    .copy = noopCopy,
};

fn noopCopy(_: *anyopaque, _: Io, _: []const u8) !void {}

const silent_logger_vtable: log.Logger.VTable = .{
    .write = silentLog,
};

fn silentLog(_: *anyopaque, _: Io, _: log.Event) !void {}

const failed_diff_vtable: provider_module.diff.DiffProvider.VTable = .{
    .getDiffOverview = failedDiffOverview,
    .getFileDiff = failedFileDiff,
};

fn failedDiffOverview(_: *anyopaque, _: Io) !model.DiffOverview {
    return error.TestUnexpectedResult;
}

fn failedFileDiff(_: *anyopaque, _: Io, _: []const u8, _: []const u8) !model.FileDiff {
    return error.TestUnexpectedResult;
}

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

        fn getFile(_: *anyopaque, _: Io, _: []const u8) !model.FileContent {
            return error.UnknownFile;
        }

        fn copy(_: *anyopaque, _: Io, _: []const u8) !void {}
        fn writeLog(_: *anyopaque, _: Io, _: log.Event) !void {}

        const diff_vtable: provider_module.diff.DiffProvider.VTable = .{
            .getDiffOverview = getDiffOverview,
            .getFileDiff = getFileDiff,
        };
        const tree_vtable: provider_module.filetree.FileTreeProvider.VTable = .{
            .getFiles = getFiles,
        };
        const file_vtable: provider_module.file.FileProvider.VTable = .{
            .getFile = getFile,
        };
        const clipboard_vtable: output.Clipboard.VTable = .{ .copy = copy };
        const logger_vtable: log.Logger.VTable = .{ .write = writeLog };
    };

    var threaded: std.Io.Threaded = .init(std.testing.allocator, .{});
    defer threaded.deinit();
    var context: u8 = 0;
    var comments = provider_module.comment.memory.MemoryProvider.init(std.testing.allocator);
    defer comments.deinit();
    var core = Core.init(
        std.testing.allocator,
        threaded.io(),
        .{ .context = &context, .vtable = &TestDependencies.diff_vtable },
        .{ .context = &context, .vtable = &TestDependencies.file_vtable },
        .{ .context = &context, .vtable = &TestDependencies.tree_vtable },
        .{ .context = &context, .vtable = &TestDependencies.tree_vtable },
        comments.interface(),
        .{ .context = &context, .vtable = &TestDependencies.clipboard_vtable },
        "/repository",
        .{
            .allocator = std.testing.allocator,
            .context = &context,
            .vtable = &TestDependencies.logger_vtable,
        },
        .{ .configuration = .{ .object = .empty }, .diagnostic = null },
    );

    const first = (try core.dispatch(.{ .create_comment = .{
        .body = "first",
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
    } })).comment;
    try std.testing.expectEqualStrings(first_id, edited.id);
    try std.testing.expectEqualStrings("updated", edited.body);
    try std.testing.expectEqualStrings("README.md", edited.target.file.path);
    try std.testing.expectError(error.InvalidComment, core.dispatch(.{ .edit_comment = .{
        .comment_id = first_id,
        .body = "  \n",
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
        fn getFile(_: *anyopaque, _: Io, _: []const u8) !model.FileContent {
            return error.TestUnexpectedResult;
        }
        fn copy(context: *anyopaque, _: Io, text: []const u8) !void {
            const self: *@This() = @ptrCast(@alignCast(context));
            if (self.fail_copy) return error.ClipboardWriteFailed;
            @memcpy(self.copied[0..text.len], text);
            self.copied_len = text.len;
        }
        fn writeLog(_: *anyopaque, _: Io, _: log.Event) !void {}

        const diff_vtable: provider_module.diff.DiffProvider.VTable = .{
            .getDiffOverview = getDiffOverview,
            .getFileDiff = getFileDiff,
        };
        const tree_vtable: provider_module.filetree.FileTreeProvider.VTable = .{
            .getFiles = getFiles,
        };
        const file_vtable: provider_module.file.FileProvider.VTable = .{
            .getFile = getFile,
        };
        const clipboard_vtable: output.Clipboard.VTable = .{ .copy = copy };
        const logger_vtable: log.Logger.VTable = .{ .write = writeLog };
    };

    var threaded: std.Io.Threaded = .init(std.testing.allocator, .{});
    defer threaded.deinit();
    var dependencies: TestDependencies = .{};
    var comments = provider_module.comment.memory.MemoryProvider.init(std.testing.allocator);
    defer comments.deinit();
    var core = Core.init(
        std.testing.allocator,
        threaded.io(),
        .{ .context = &dependencies, .vtable = &TestDependencies.diff_vtable },
        .{ .context = &dependencies, .vtable = &TestDependencies.file_vtable },
        .{ .context = &dependencies, .vtable = &TestDependencies.tree_vtable },
        .{ .context = &dependencies, .vtable = &TestDependencies.tree_vtable },
        comments.interface(),
        .{ .context = &dependencies, .vtable = &TestDependencies.clipboard_vtable },
        "/repo root",
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
