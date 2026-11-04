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
        const response: model.Response = if (request == .get_review_session)
            .{ .review_session = .{ .id = self.session_id } }
        else
            try self.active.core.dispatch(request);
        return .{ .response = response, .context = self, .releaseFn = release };
    }

    fn release(context: *anyopaque) void {
        const self: *SessionOwner = @ptrCast(@alignCast(context));
        self.mutex.unlock(self.io);
    }
};

test "replacement waits for response serialization and rejects requests from the old document" {
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
    const replacement = try session_module.Session.create(allocator, io, owner.active.options);
    var owns_replacement = true;
    defer if (owns_replacement) replacement.destroy();
    const old_id = (try owner.active.core.dispatch(.get_diff_overview)).diff_overview.id;
    const scoped = try owner.dispatcher().dispatchScoped(.{ .get_file_diff = .{ .diff_id = old_id, .path = "file.txt" } }, 1);
    var scope_active = true;
    defer if (scope_active) scoped.deinit();
    const Replacement = struct {
        owner: *SessionOwner,
        session: *session_module.Session,
        started: std.Io.Event = .unset,
        finished: std.Io.Event = .unset,
        failure: ?anyerror = null,

        fn run(self: *@This()) void {
            self.started.set(self.owner.io);
            self.owner.replace(self.session) catch |err| {
                self.failure = err;
                self.session.destroy();
            };
            self.finished.set(self.owner.io);
        }
    };
    var replacement_task: Replacement = .{ .owner = &owner, .session = replacement };
    const thread = try std.Thread.spawn(.{}, Replacement.run, .{&replacement_task});
    owns_replacement = false;
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
