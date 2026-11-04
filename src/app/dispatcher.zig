const model = @import("model.zig");

/// Owns the result and its request scope. Release it after serialization,
/// including when serialization fails.
pub const ScopedResponse = struct {
    response: model.Response,
    context: ?*anyopaque = null,
    releaseFn: ?*const fn (*anyopaque) void = null,

    pub fn deinit(self: ScopedResponse) void {
        self.response.deinit();
        if (self.releaseFn) |release| release(self.context.?);
    }
};

pub const Dispatcher = struct {
    context: *anyopaque,
    dispatchFn: *const fn (*anyopaque, model.Request) anyerror!model.Response,
    dispatchScopedFn: ?*const fn (*anyopaque, model.Request, ?u64) anyerror!ScopedResponse = null,

    pub fn dispatch(self: Dispatcher, request: model.Request) !model.Response {
        return self.dispatchFn(self.context, request);
    }

    /// Transport entry point. The scope keeps borrowed response data valid.
    pub fn dispatchScoped(self: Dispatcher, request: model.Request, session_id: ?u64) !ScopedResponse {
        if (self.dispatchScopedFn) |dispatch_scoped| return dispatch_scoped(self.context, request, session_id);
        return .{ .response = try self.dispatch(request) };
    }
};
