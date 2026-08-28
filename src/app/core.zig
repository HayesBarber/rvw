const std = @import("std");
const dispatcher_module = @import("dispatcher.zig");
const model = @import("model.zig");
const provider_module = @import("../provider.zig");

const Allocator = std.mem.Allocator;
const Io = std.Io;

pub const Core = struct {
    allocator: Allocator,
    io: Io,
    provider: provider_module.review.ReviewProvider,

    pub fn init(allocator: Allocator, io: Io, provider: provider_module.review.ReviewProvider) Core {
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
