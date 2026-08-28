const std = @import("std");
const dispatcher_module = @import("dispatcher.zig");
const model = @import("model.zig");
const provider_module = @import("../provider.zig");

const Allocator = std.mem.Allocator;
const Io = std.Io;

pub const Core = struct {
    allocator: Allocator,
    io: Io,
    diff_provider: provider_module.diff.DiffProvider,

    pub fn init(allocator: Allocator, io: Io, diff_provider: provider_module.diff.DiffProvider) Core {
        return .{ .allocator = allocator, .io = io, .diff_provider = diff_provider };
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
            .get_file_diff => |details| .{
                .file_diff = try self.diff_provider.getFileDiff(self.io, details.diff_id, details.path),
            },
        };
    }
};
