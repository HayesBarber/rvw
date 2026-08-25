const model = @import("../app/model.zig");

pub const Dispatcher = struct {
    context: *anyopaque,
    dispatchFn: *const fn (*anyopaque, model.Request) anyerror!model.Response,

    pub fn dispatch(self: Dispatcher, request: model.Request) !model.Response {
        return self.dispatchFn(self.context, request);
    }
};
