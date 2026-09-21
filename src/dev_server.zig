const std = @import("std");
const rvw = @import("rvw");

const Options = struct {
    host: []const u8 = "127.0.0.1",
    port: u16 = 7331,
    directory: ?[]const u8 = null,
    range: ?[]const u8 = null,
    pr: ?u32 = null,
    log_level: ?[]const u8 = null,
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
            error.DuplicateLogLevel => "--log-level may only be provided once",
            error.InvalidPr => "PR number must be a positive integer",
            error.DuplicateTarget => "provide only one of --range or --pr",
            error.DuplicateRange => "--range may only be provided once",
        }});
        usage();
        return err;
    };
    const address = std.Io.net.IpAddress.parse(options.host, options.port) catch {
        std.log.err("invalid listen host: {s}", .{options.host});
        return error.InvalidHost;
    };

    var default_logger = rvw.log.DefaultLogger.init(init.gpa, init.io, .{
        .home = init.environ_map.get("HOME"),
        .xdg_state_home = init.environ_map.get("XDG_STATE_HOME"),
        .temporary_directory = init.environ_map.get("TMPDIR"),
    });
    defer default_logger.deinit();
    default_logger.minimum_level = rvw.log.Level.resolve(init.io, options.log_level orelse init.environ_map.get("LOG_LEVEL"));
    const logger = default_logger.interface();
    const range = if (options.pr) |number| rvw.util.pull_request.resolveRange(init.io, init.arena.allocator(), options.directory.?, number) catch |err| {
        std.log.err("{s}", .{rvw.util.pull_request.errorMessage(err)});
        usage();
        return err;
    } else options.range;
    var review = rvw.provider.review.git.GitReviewProvider.init(init.gpa, init.io, options.directory.?, range, options.pr) catch |err| {
        rvw.startup.logApplicationStartFailed(logger, init.io, "diff_provider", err);
        std.log.err("unable to open Git diff: {s}", .{rvw.provider.diff.git.errorMessage(err)});
        return err;
    };
    defer review.deinit();
    var comments = rvw.provider.comment.memory.MemoryProvider.init(init.gpa);
    defer comments.deinit();
    var clipboard: rvw.output.SystemClipboard = .{};
    var configuration = try rvw.config.load(init.gpa, init.io, .{
        .home = init.environ_map.get("HOME"),
    });
    defer configuration.deinit();
    var core = rvw.core.Core.init(
        init.gpa,
        init.io,
        review.interface(),
        comments.interface(),
        clipboard.interface(),
        logger,
        configuration.snapshot,
    );

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
        } else if (std.mem.eql(u8, argument, "--range")) {
            if (index == args.len) return error.MissingValue;
            if (options.pr != null) return error.DuplicateTarget;
            if (options.range != null) return error.DuplicateRange;
            options.range = args[index];
            index += 1;
        } else if (std.mem.eql(u8, argument, "--pr")) {
            if (index == args.len) return error.MissingValue;
            if (options.pr != null or options.range != null) return error.DuplicateTarget;
            options.pr = try rvw.util.pull_request.parseNumber(args[index]);
            index += 1;
        } else if (std.mem.eql(u8, argument, "--log-level")) {
            if (index == args.len) return error.MissingValue;
            if (options.log_level != null) return error.DuplicateLogLevel;
            options.log_level = args[index];
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
        "usage: rvw-server serve --directory DIR [--range A..B | --pr NUMBER] [--host HOST] [--port PORT] [--log-level LEVEL]\n" ++
            "       defaults may also be set with RVW_HOST and RVW_PORT\n",
        .{},
    );
}

test "server PR options require a directory and exclude ranges" {
    const options = try parseArgs(&.{ "server", "serve", "--directory", ".", "--pr", "100" }, .{});
    try std.testing.expectEqual(@as(?u32, 100), options.pr);
    try std.testing.expectError(error.MissingDirectory, parseArgs(&.{ "server", "serve", "--pr", "100" }, .{}));
    try std.testing.expectError(error.MissingValue, parseArgs(&.{ "server", "serve", "--pr" }, .{}));
    try std.testing.expectError(error.InvalidPr, parseArgs(&.{ "server", "serve", "--pr", "0" }, .{}));
    try std.testing.expectError(error.DuplicateTarget, parseArgs(&.{ "server", "serve", "--pr", "1", "--range", "a..b" }, .{}));
    try std.testing.expectError(error.DuplicateTarget, parseArgs(&.{ "server", "serve", "--range", "a..b", "--pr", "1" }, .{}));
    try std.testing.expectError(error.DuplicateTarget, parseArgs(&.{ "server", "serve", "--pr", "1", "--pr", "2" }, .{}));
}
