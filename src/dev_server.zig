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
        "usage: rvw-server serve [--host HOST] [--port PORT]\n" ++
            "       defaults may also be set with RVW_HOST and RVW_PORT\n",
        .{},
    );
}
