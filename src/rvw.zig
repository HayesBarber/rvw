pub const model = @import("app/model.zig");
pub const provider = @import("app/provider.zig");
pub const fixture_provider = @import("app/fixture_provider.zig");
pub const core = @import("app/core.zig");
pub const json_protocol = @import("app/json_protocol.zig");
pub const http = @import("platform/http.zig");

test {
    _ = model;
    _ = provider;
    _ = fixture_provider;
    _ = core;
    _ = json_protocol;
    _ = http;
}
