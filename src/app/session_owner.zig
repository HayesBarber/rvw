const std = @import("std");
const session_module = @import("session.zig");
const dispatcher_module = @import("dispatcher.zig");
const model = @import("model.zig");

/// Stable request boundary. Scopes run in lock acquisition order, through
/// serialization. The native transport also preserves its request queue order.
/// Do not move the owner after exposing its dispatcher.
pub const SessionOwner = struct {
    io: std.Io,
    mutex: std.Io.Mutex = .init,
    active: *session_module.Session,
    session_id: u64 = 1,

    pub fn init(io: std.Io, session: *session_module.Session) SessionOwner {
        return .{ .io = io, .active = session };
    }

    /// The caller must stop accepting new requests before destruction.
    pub fn deinit(self: *SessionOwner) void {
        self.mutex.lockUncancelable(self.io);
        defer self.mutex.unlock(self.io);
        self.active.destroy();
    }

    pub fn dispatcher(self: *SessionOwner) dispatcher_module.Dispatcher {
        return .{ .context = self, .dispatchFn = unscopedDispatch, .dispatchScopedFn = dispatchScoped };
    }

    /// Takes ownership only on success. Waits for earlier response scopes.
    pub fn replace(self: *SessionOwner, replacement: *session_module.Session) !void {
        self.mutex.lockUncancelable(self.io);
        defer self.mutex.unlock(self.io);
        try self.replaceLocked(replacement);
    }

    fn replaceLocked(self: *SessionOwner, replacement: *session_module.Session) !void {
        if (self.session_id == model.maximum_session_id) return error.SessionLimitReached;
        const previous = self.active;
        self.active = replacement;
        self.session_id += 1;
        previous.destroy();
    }

    fn unscopedDispatch(_: *anyopaque, _: model.Request) !model.Response {
        return error.RequestScopeRequired;
    }

    fn dispatchScoped(context: *anyopaque, request: model.Request, expected_session_id: ?u64) !dispatcher_module.ScopedResponse {
        const self: *SessionOwner = @ptrCast(@alignCast(context));
        self.mutex.lockUncancelable(self.io);
        errdefer self.mutex.unlock(self.io);
        if (expected_session_id) |id| {
            if (id != self.session_id) return error.StaleSession;
        } else if (self.session_id != 1 and request != .get_review_session) {
            // Legacy requests may use only the initial session. They must not
            // silently reach a replacement when queued by the old document.
            return error.StaleSession;
        }
        const response: model.Response = switch (request) {
            .get_review_session => .{ .review_session = .{ .id = self.session_id } },
            .reload_review => |details| try self.reload(details.source),
            else => try self.active.core.dispatch(request),
        };
        return .{ .response = response, .context = self, .releaseFn = release };
    }

    fn reload(self: *SessionOwner, source: ?model.DiffSource) !model.Response {
        var options = self.active.options;
        if (source) |value| options.source = value;
        const replacement = session_module.Session.create(self.active.allocator, self.io, options) catch |err| {
            self.active.options.logger.log(self.io, .{
                .level = .err,
                .source = .backend,
                .message = "review session replacement failed",
            });
            return switch (err) {
                error.InvalidRevision, error.PullRequestUnavailable, error.InvalidPullRequestRefs => err,
                error.MissingOrigin => error.PullRequestUnavailable,
                else => error.ReloadUnavailable,
            };
        };
        errdefer replacement.destroy();
        try self.replaceLocked(replacement);
        return .{ .reload_review_result = .{ .sessionId = self.session_id } };
    }

    fn release(context: *anyopaque) void {
        const self: *SessionOwner = @ptrCast(@alignCast(context));
        self.mutex.unlock(self.io);
    }
};

test "reload waits for response serialization and rejects requests from the old document" {
    const allocator = std.testing.allocator;
    const io = std.testing.io;
    var repository = try @import("../testing/repository.zig").Repository.init(allocator);
    defer repository.deinit();
    try repository.write("file.txt", "base\n");
    try repository.commit("base");
    try repository.write("file.txt", "old snapshot\n");
    var owner = SessionOwner.init(io, try session_module.Session.create(allocator, io, testOptions(repository.root)));
    defer owner.deinit();
    try repository.write("file.txt", "new snapshot\n");
    const old_id = (try owner.active.core.dispatch(.get_diff_overview)).diff_overview.id;
    const scoped = try owner.dispatcher().dispatchScoped(.{ .get_file_diff = .{ .diff_id = old_id, .path = "file.txt" } }, 1);
    var scope_active = true;
    defer if (scope_active) scoped.deinit();
    const Replacement = struct {
        owner: *SessionOwner,
        started: std.Io.Event = .unset,
        finished: std.Io.Event = .unset,
        failure: ?anyerror = null,

        fn run(self: *@This()) void {
            defer self.finished.set(self.owner.io);
            self.started.set(self.owner.io);
            const reset = self.owner.dispatcher().dispatchScoped(.{ .reload_review = .{} }, 1) catch |err| {
                self.failure = err;
                return;
            };
            reset.deinit();
        }
    };
    var replacement_task: Replacement = .{ .owner = &owner };
    const thread = try std.Thread.spawn(.{}, Replacement.run, .{&replacement_task});
    var joined = false;
    defer {
        if (scope_active) {
            scoped.deinit();
            scope_active = false;
        }
        if (!joined) thread.join();
    }
    replacement_task.started.waitUncancelable(io);
    try std.testing.expect(!owner.mutex.tryLock());
    try std.testing.expect(!replacement_task.finished.isSet());
    const encoded = try @import("json_protocol.zig").encodeResponse(allocator, scoped.response);
    defer allocator.free(encoded);
    scoped.deinit();
    scope_active = false;
    thread.join();
    joined = true;
    try std.testing.expect(replacement_task.finished.isSet());
    try std.testing.expect(replacement_task.failure == null);
    // Serialized bytes remain valid after the old session has been destroyed.
    try std.testing.expect(std.mem.indexOf(u8, encoded, "old snapshot") != null);
    const mutation: model.Request = .{ .create_comment = .{ .body = "stale", .target = .review } };
    try std.testing.expectError(error.StaleSession, owner.dispatcher().dispatchScoped(mutation, 1));
    try std.testing.expectError(error.StaleSession, owner.dispatcher().dispatchScoped(mutation, null));
    for ([_][]const u8{
        \\{"type":"create_comment","body":"stale","target":{"kind":"review"},"sessionId":1}
        ,
        \\{"type":"create_comment","body":"stale","target":{"kind":"review"}}
        ,
    }) |input| {
        const rejected = try @import("json_protocol.zig").dispatchJson(allocator, owner.dispatcher(), input);
        defer allocator.free(rejected);
        try std.testing.expect(std.mem.indexOf(u8, rejected, "stale_session") != null);
    }
    const bootstrap = try owner.dispatcher().dispatchScoped(.get_review_session, null);
    try std.testing.expectEqual(@as(u64, 2), bootstrap.response.review_session.id);
    bootstrap.deinit();
    const current = try owner.dispatcher().dispatchScoped(.get_comments, 2);
    defer current.deinit();
    try std.testing.expectEqual(@as(usize, 0), current.response.comments.len);
}

test "native JSON scopes release the session on dispatch and serialization failures" {
    const allocator = std.testing.allocator;
    const io = std.testing.io;
    var repository = try @import("../testing/repository.zig").Repository.init(allocator);
    defer repository.deinit();
    try repository.write("file.txt", "base\n");
    try repository.commit("base");
    var owner = SessionOwner.init(io, try session_module.Session.create(allocator, io, testOptions(repository.root)));
    defer owner.deinit();
    const Test = struct {
        fn run(result_allocator: std.mem.Allocator, target: *SessionOwner) !void {
            const encoded = @import("json_protocol.zig").dispatchJson(result_allocator, target.dispatcher(),
                \\{"type":"get_diff_overview","sessionId":1}
            );
            // Check release even when parsing or serialization returned an error.
            try std.testing.expect(target.mutex.tryLock());
            target.mutex.unlock(target.io);
            const bytes = try encoded;
            defer result_allocator.free(bytes);
        }
    };
    try std.testing.checkAllAllocationFailures(allocator, Test.run, .{&owner});
    const failed = try @import("json_protocol.zig").dispatchJson(allocator, owner.dispatcher(),
        \\{"type":"get_file","path":"missing.txt","sessionId":1}
    );
    defer allocator.free(failed);
    try std.testing.expect(std.mem.indexOf(u8, failed, "unknown_file") != null);
    try std.testing.expect(owner.mutex.tryLock());
    owner.mutex.unlock(io);
    try std.testing.expectError(error.RequestScopeRequired, owner.dispatcher().dispatch(.get_comments));
}

fn testOptions(directory: []const u8) session_module.Options {
    return .{
        .directory = directory,
        .configuration = .{ .configuration = .{ .object = .empty }, .diagnostic = null },
        .logger = @import("../log/log.zig").stderrLogger(std.testing.allocator),
    };
}

test "ordinary reload rebuilds caches and retains symbolic or explicit working-tree source intent" {
    const allocator = std.testing.allocator;
    const io = std.testing.io;
    var repository = try @import("../testing/repository.zig").Repository.init(allocator);
    defer repository.deinit();
    try repository.write("file.txt", "base\n");
    try repository.commit("base");
    const base = try repository.revision("HEAD");
    defer allocator.free(base);
    try repository.write("file.txt", "first\n");
    var owner = SessionOwner.init(io, try session_module.Session.create(allocator, io, testOptions(repository.root)));
    defer owner.deinit();
    const original_id = blk: {
        const scoped = try owner.dispatcher().dispatchScoped(.get_diff_overview, 1);
        defer scoped.deinit();
        break :blk try allocator.dupe(u8, scoped.response.diff_overview.id);
    };
    defer allocator.free(original_id);
    {
        const files = try owner.dispatcher().dispatchScoped(.get_files, 1);
        defer files.deinit();
        try std.testing.expectEqual(@as(usize, 1), files.response.files.len);
    }
    {
        const comment = try owner.dispatcher().dispatchScoped(.{ .create_comment = .{ .body = "discard", .target = .review } }, 1);
        defer comment.deinit();
    }
    try repository.write("file.txt", "second\n");
    try repository.write("new.txt", "new\n");
    {
        const reset = try owner.dispatcher().dispatchScoped(.{ .reload_review = .{} }, 1);
        defer reset.deinit();
        try std.testing.expectEqual(@as(u64, 2), reset.response.reload_review_result.sessionId);
    }
    {
        const overview = try owner.dispatcher().dispatchScoped(.get_diff_overview, 2);
        defer overview.deinit();
        try std.testing.expectEqualStrings(original_id, overview.response.diff_overview.id);
    }
    {
        const file = try owner.dispatcher().dispatchScoped(.{ .get_file_diff = .{ .diff_id = original_id, .path = "file.txt" } }, 2);
        defer file.deinit();
        try std.testing.expectEqualStrings("second\n", file.response.file_diff.content.diff.newFile.?.contents);
    }
    {
        const files = try owner.dispatcher().dispatchScoped(.get_files, 2);
        defer files.deinit();
        try std.testing.expectEqual(@as(usize, 2), files.response.files.len);
    }
    {
        const comments = try owner.dispatcher().dispatchScoped(.get_comments, 2);
        defer comments.deinit();
        try std.testing.expectEqual(@as(usize, 0), comments.response.comments.len);
    }
    try repository.commit("advance HEAD");
    const head = try repository.revision("HEAD");
    defer allocator.free(head);
    {
        const reset = try owner.dispatcher().dispatchScoped(.{ .reload_review = .{} }, 2);
        defer reset.deinit();
    }
    {
        const overview = try owner.dispatcher().dispatchScoped(.get_diff_overview, 3);
        defer overview.deinit();
        try std.testing.expectEqualStrings(head, overview.response.diff_overview.source.working_tree.base);
        try std.testing.expectEqual(@as(usize, 0), overview.response.diff_overview.files.len);
    }
    {
        const reset = try owner.dispatcher().dispatchScoped(.{ .reload_review = .{ .source = .{ .working_tree = .{ .base = base } } } }, 3);
        defer reset.deinit();
    }
    try repository.write("file.txt", "third\n");
    try repository.commit("advance HEAD again");
    {
        const reset = try owner.dispatcher().dispatchScoped(.{ .reload_review = .{} }, 4);
        defer reset.deinit();
    }
    {
        const overview = try owner.dispatcher().dispatchScoped(.get_diff_overview, 5);
        defer overview.deinit();
        try std.testing.expectEqualStrings(base, overview.response.diff_overview.source.working_tree.base);
        try std.testing.expectEqual(@as(usize, 2), overview.response.diff_overview.files.len);
    }
}
