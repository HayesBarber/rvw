const std = @import("std");
const rvw = @import("rvw");

const Options = struct {
    host: []const u8 = "127.0.0.1",
    port: u16 = 7331,
};

pub fn main(init: std.process.Init) !void {
    const args = try init.minimal.args.toSlice(init.arena.allocator());
    const options = parseOptions(args, init.environ_map) catch |err| {
        std.log.err("{s}", .{switch (err) {
            error.MissingValue => "missing value for command-line option",
            error.InvalidPort => "port must be an integer from 0 through 65535",
            error.UnknownArgument => "unknown command-line argument",
            error.ExpectedServe => "expected serve command",
        }});
        usage();
        return err;
    };
    const address = std.Io.net.IpAddress.parse(options.host, options.port) catch {
        std.log.err("invalid listen host: {s}", .{options.host});
        return error.InvalidHost;
    };

    var fixture: rvw.fixture_provider.FixtureProvider = .{};
    var core = rvw.core.Core.init(init.gpa, init.io, fixture.interface());
    try core.start();
    defer core.deinit();

    try rvw.http.serve(init.gpa, init.io, core.dispatcher(), address);
}

fn parseOptions(args: []const []const u8, environ: *const std.process.Environ.Map) !Options {
    var defaults: Options = .{};
    if (environ.get("RVW_HOST")) |host| defaults.host = host;
    if (environ.get("RVW_PORT")) |port| {
        defaults.port = std.fmt.parseInt(u16, port, 10) catch return error.InvalidPort;
    }
    return parseArgs(args, defaults);
}

fn parseArgs(args: []const []const u8, defaults: Options) !Options {
    var options = defaults;
    var index: usize = 1;
    if (index < args.len and std.mem.eql(u8, args[index], "serve")) {
        index += 1;
    } else if (index < args.len and !std.mem.startsWith(u8, args[index], "--")) {
        return error.ExpectedServe;
    }

    while (index < args.len) {
        const argument = args[index];
        index += 1;
        if (std.mem.eql(u8, argument, "--host")) {
            if (index == args.len) return error.MissingValue;
            options.host = args[index];
            index += 1;
        } else if (std.mem.eql(u8, argument, "--port")) {
            if (index == args.len) return error.MissingValue;
            options.port = std.fmt.parseInt(u16, args[index], 10) catch return error.InvalidPort;
            index += 1;
        } else {
            return error.UnknownArgument;
        }
    }
    return options;
}

fn usage() void {
    std.debug.print(
        "usage: rvw serve [--host HOST] [--port PORT]\n" ++
            "       defaults may also be set with RVW_HOST and RVW_PORT\n",
        .{},
    );
}

test "CLI options have stable defaults and overrides" {
    const defaults = try parseArgs(&.{"rvw"}, .{});
    try std.testing.expectEqualStrings("127.0.0.1", defaults.host);
    try std.testing.expectEqual(@as(u16, 7331), defaults.port);

    const configured = try parseArgs(&.{ "rvw", "serve", "--host", "0.0.0.0", "--port", "8123" }, .{});
    try std.testing.expectEqualStrings("0.0.0.0", configured.host);
    try std.testing.expectEqual(@as(u16, 8123), configured.port);
}

test "environment configures defaults and CLI options take precedence" {
    var environ = std.process.Environ.Map.init(std.testing.allocator);
    defer environ.deinit();
    try environ.put("RVW_HOST", "0.0.0.0");
    try environ.put("RVW_PORT", "8000");

    const from_environment = try parseOptions(&.{"rvw"}, &environ);
    try std.testing.expectEqualStrings("0.0.0.0", from_environment.host);
    try std.testing.expectEqual(@as(u16, 8000), from_environment.port);

    const configured = try parseOptions(
        &.{ "rvw", "serve", "--host", "127.0.0.1", "--port", "9000" },
        &environ,
    );
    try std.testing.expectEqualStrings("127.0.0.1", configured.host);
    try std.testing.expectEqual(@as(u16, 9000), configured.port);
}
