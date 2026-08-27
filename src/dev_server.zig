const std = @import("std");
const rvw = @import("rvw");

const Options = struct {
    host: []const u8 = "127.0.0.1",
    port: u16 = 7331,
    directory: ?[]const u8 = null,
};

pub fn main(init: std.process.Init) !void {
    const args = try init.minimal.args.toSlice(init.arena.allocator());
    const options = parseOptions(args, init.environ_map) catch |err| {
        std.log.err("{s}", .{switch (err) {
            error.MissingValue => "missing value for command-line option",
            error.InvalidPort => "port must be an integer from 0 through 65535",
            error.UnknownArgument => "unknown command-line argument",
            error.ExpectedServe => "expected serve command",
            error.MissingDirectory => "missing required --directory DIR",
            error.DuplicateDirectory => "--directory may only be provided once",
        }});
        usage();
        return err;
    };
    const requested_directory = options.directory.?;
    const validated_directory = rvw.repository.validateRoot(init.io, init.gpa, requested_directory) catch |err| {
        std.log.err("invalid repository directory '{s}': {s}", .{ requested_directory, switch (err) {
            error.RepositoryPathMissing => "path does not exist",
            error.NotDirectory => "path is not a directory",
            error.NotGitRepository => "path is not a Git worktree",
            error.NotRepositoryRoot => "path is inside a Git worktree but is not its root",
            error.GitNotFound => "git is not available on PATH",
            else => @errorName(err),
        } });
        return err;
    };
    defer init.gpa.free(validated_directory);
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
    if (index == args.len or !std.mem.eql(u8, args[index], "serve")) return error.ExpectedServe;
    index += 1;

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
        } else if (std.mem.eql(u8, argument, "--directory")) {
            if (index == args.len) return error.MissingValue;
            if (options.directory != null) return error.DuplicateDirectory;
            options.directory = args[index];
            index += 1;
        } else {
            return error.UnknownArgument;
        }
    }
    if (options.directory == null) return error.MissingDirectory;
    return options;
}

fn usage() void {
    std.debug.print(
        "usage: rvw-server serve --directory DIR [--host HOST] [--port PORT]\n" ++
            "       defaults may also be set with RVW_HOST and RVW_PORT\n",
        .{},
    );
}

test "serve requires exactly one repository directory" {
    const defaults: Options = .{};
    try std.testing.expectError(error.ExpectedServe, parseArgs(&.{"rvw-server"}, defaults));
    try std.testing.expectError(error.ExpectedServe, parseArgs(&.{ "rvw-server", "--directory", "." }, defaults));
    try std.testing.expectError(error.MissingDirectory, parseArgs(&.{ "rvw-server", "serve" }, defaults));
    try std.testing.expectError(error.MissingValue, parseArgs(&.{ "rvw-server", "serve", "--directory" }, defaults));
    try std.testing.expectError(error.DuplicateDirectory, parseArgs(
        &.{ "rvw-server", "serve", "--directory", ".", "--directory", "." },
        defaults,
    ));
    const options = try parseArgs(&.{ "rvw-server", "serve", "--directory", "." }, defaults);
    try std.testing.expectEqualStrings(".", options.directory.?);
}
