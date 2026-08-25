const std = @import("std");
const dispatcher_module = @import("dispatcher.zig");
const model = @import("model.zig");
const provider_module = @import("provider.zig");

const Allocator = std.mem.Allocator;
const Io = std.Io;

pub const Core = struct {
    allocator: Allocator,
    io: Io,
    provider: provider_module.ReviewProvider,
    mutex: Io.Mutex = .init,
    ready: Io.Condition = .init,
    head: ?*Work = null,
    tail: ?*Work = null,
    state: State = .initialized,
    thread: ?std.Thread = null,

    const State = enum { initialized, running, stopping, stopped };
    const Result = anyerror!model.Response;

    const Work = struct {
        request: model.Request,
        next: ?*Work = null,
        mutex: Io.Mutex = .init,
        complete: Io.Condition = .init,
        done: bool = false,
        result: ?Result = null,
    };

    pub fn init(allocator: Allocator, io: Io, provider: provider_module.ReviewProvider) Core {
        return .{ .allocator = allocator, .io = io, .provider = provider };
    }

    pub fn start(self: *Core) !void {
        self.mutex.lockUncancelable(self.io);
        defer self.mutex.unlock(self.io);
        if (self.state != .initialized) return error.InvalidState;
        self.state = .running;
        self.thread = std.Thread.spawn(.{}, run, .{self}) catch |err| {
            self.state = .initialized;
            return err;
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
        const owned_request = try cloneRequest(self.allocator, request);
        const work = self.allocator.create(Work) catch |err| {
            freeRequest(self.allocator, owned_request);
            return err;
        };
        work.* = .{ .request = owned_request };

        self.mutex.lockUncancelable(self.io);
        if (self.state != .running) {
            self.mutex.unlock(self.io);
            freeRequest(self.allocator, work.request);
            self.allocator.destroy(work);
            return error.ShuttingDown;
        }
        if (self.tail) |tail| {
            tail.next = work;
        } else {
            self.head = work;
        }
        self.tail = work;
        self.ready.signal(self.io);
        self.mutex.unlock(self.io);

        work.mutex.lockUncancelable(self.io);
        while (!work.done) work.complete.waitUncancelable(self.io, &work.mutex);
        const result = work.result.?;
        work.mutex.unlock(self.io);

        freeRequest(self.allocator, work.request);
        self.allocator.destroy(work);
        return result;
    }

    pub fn stop(self: *Core) void {
        self.mutex.lockUncancelable(self.io);
        switch (self.state) {
            .initialized => self.state = .stopped,
            .running => {
                self.state = .stopping;
                self.ready.broadcast(self.io);
            },
            .stopping, .stopped => {},
        }
        self.mutex.unlock(self.io);

        if (self.thread) |thread| {
            thread.join();
            self.thread = null;
        }
    }

    pub fn deinit(self: *Core) void {
        self.stop();
        self.* = undefined;
    }

    fn run(self: *Core) void {
        while (true) {
            self.mutex.lockUncancelable(self.io);
            while (self.head == null and self.state == .running) {
                self.ready.waitUncancelable(self.io, &self.mutex);
            }
            const work = self.head orelse {
                self.state = .stopped;
                self.mutex.unlock(self.io);
                return;
            };
            self.head = work.next;
            if (self.head == null) self.tail = null;
            self.mutex.unlock(self.io);

            const result = self.handle(work.request);
            work.mutex.lockUncancelable(self.io);
            work.result = result;
            work.done = true;
            work.complete.signal(self.io);
            work.mutex.unlock(self.io);
        }
    }

    fn handle(self: *Core, request: model.Request) !model.Response {
        return switch (request) {
            .get_review_overview => .{ .review_overview = try self.provider.getOverview() },
            .get_file_review => |details| .{
                .file_review = try self.provider.getFileReview(details.review_id, details.path),
            },
        };
    }
};

fn cloneRequest(allocator: Allocator, request: model.Request) !model.Request {
    return switch (request) {
        .get_review_overview => .get_review_overview,
        .get_file_review => |details| blk: {
            const review_id = try allocator.dupe(u8, details.review_id);
            errdefer allocator.free(review_id);
            const path = try allocator.dupe(u8, details.path);
            break :blk .{ .get_file_review = .{ .review_id = review_id, .path = path } };
        },
    };
}

fn freeRequest(allocator: Allocator, request: model.Request) void {
    switch (request) {
        .get_review_overview => {},
        .get_file_review => |details| {
            allocator.free(details.review_id);
            allocator.free(details.path);
        },
    }
}
