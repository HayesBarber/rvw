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

    pub fn init(allocator: Allocator, io: Io, provider: provider_module.ReviewProvider) Core {
        return .{ .allocator = allocator, .io = io, .provider = provider };
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
            .get_review_overview => .{ .review_overview = try self.provider.getOverview(self.io) },
            .get_file_review => |details| .{
                .file_review = try self.provider.getFileReview(self.io, details.review_id, details.path),
            },
        };
    }
};

test "core dispatches through the provider with its io implementation" {
    const FakeProvider = struct {
        expected_io: Io,
        overview_calls: usize = 0,
        file_calls: usize = 0,

        fn interface(self: *@This()) provider_module.ReviewProvider {
            return .{ .context = self, .vtable = &.{
                .getOverview = getOverview,
                .getFileReview = getFileReview,
            } };
        }

        fn checkIo(self: *@This(), io: Io) !void {
            if (io.userdata != self.expected_io.userdata or io.vtable != self.expected_io.vtable) {
                return error.UnexpectedIo;
            }
        }

        fn getOverview(context: *anyopaque, io: Io) !model.ReviewOverview {
            const self: *@This() = @ptrCast(@alignCast(context));
            try self.checkIo(io);
            self.overview_calls += 1;
            return testOverview;
        }

        fn getFileReview(context: *anyopaque, io: Io, _: []const u8, _: []const u8) !model.FileReview {
            const self: *@This() = @ptrCast(@alignCast(context));
            try self.checkIo(io);
            self.file_calls += 1;
            return error.UnknownFile;
        }
    };

    const io = std.testing.io;
    var fake: FakeProvider = .{ .expected_io = io };
    var core = Core.init(std.testing.allocator, io, fake.interface());

    const response = try core.dispatch(.get_review_overview);
    try std.testing.expectEqualStrings("fake", response.review_overview.review.repository.name);
    try std.testing.expectError(error.UnknownFile, core.dispatch(.{ .get_file_review = .{
        .review_id = "review",
        .path = "missing.zig",
    } }));
    try std.testing.expectEqual(@as(usize, 1), fake.overview_calls);
    try std.testing.expectEqual(@as(usize, 1), fake.file_calls);
}

test "dispatcher permits provider calls to overlap" {
    const TrackingProvider = struct {
        active: std.atomic.Value(usize) = .init(0),
        max_active: std.atomic.Value(usize) = .init(0),

        fn interface(self: *@This()) provider_module.ReviewProvider {
            return .{ .context = self, .vtable = &.{
                .getOverview = getOverview,
                .getFileReview = getFileReview,
            } };
        }

        fn getOverview(context: *anyopaque, io: Io) !model.ReviewOverview {
            const self: *@This() = @ptrCast(@alignCast(context));
            const active = self.active.fetchAdd(1, .monotonic) + 1;
            defer _ = self.active.fetchSub(1, .monotonic);

            var previous = self.max_active.load(.monotonic);
            while (active > previous) {
                previous = self.max_active.cmpxchgWeak(
                    previous,
                    active,
                    .monotonic,
                    .monotonic,
                ) orelse break;
            }

            try io.sleep(.fromMilliseconds(25), .awake);
            return testOverview;
        }

        fn getFileReview(_: *anyopaque, _: Io, _: []const u8, _: []const u8) !model.FileReview {
            return error.UnknownFile;
        }
    };

    const io = std.testing.io;
    var provider: TrackingProvider = .{};
    var core = Core.init(std.testing.allocator, io, provider.interface());
    const dispatcher = core.dispatcher();

    var first = try io.concurrent(dispatcher_module.Dispatcher.dispatch, .{
        dispatcher,
        model.Request.get_review_overview,
    });
    defer _ = first.cancel(io) catch {};
    var second = try io.concurrent(dispatcher_module.Dispatcher.dispatch, .{
        dispatcher,
        model.Request.get_review_overview,
    });
    defer _ = second.cancel(io) catch {};

    _ = try first.await(io);
    _ = try second.await(io);
    try std.testing.expectEqual(@as(usize, 2), provider.max_active.load(.monotonic));
}

const testOverview: model.ReviewOverview = .{
    .review = .{
        .id = "test",
        .repository = .{ .name = "fake" },
        .source = .{ .kind = "working-tree", .base = "HEAD" },
    },
    .initialPath = "file.zig",
    .files = &.{},
    .comments = &.{},
};
