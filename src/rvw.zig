pub const model = @import("app/model.zig");
pub const provider = @import("app/provider.zig");
pub const fixture_provider = @import("app/fixture_provider.zig");
pub const dispatcher = @import("app/dispatcher.zig");
pub const core = @import("app/core.zig");
pub const json_protocol = @import("app/json_protocol.zig");
pub const http = @import("dispatcher/http.zig");

test "all public modules are test roots" {
    _ = model;
    _ = provider;
    _ = fixture_provider;
    _ = dispatcher;
    _ = core;
    _ = json_protocol;
    _ = http;
}
