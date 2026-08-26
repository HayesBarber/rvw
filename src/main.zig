const std = @import("std");

const usage =
    \\usage: rvw [DIR] [-r RANGE | --range RANGE]
    \\       rvw -h | --help
    \\
;

const Options = struct {
    directory: []const u8 = ".",
    range: ?[]const u8 = null,
};

const Command = union(enum) {
    help,
    launch: Options,
};

const ParseError = error{
    DuplicateDirectory,
    DuplicateRange,
    EmptyRange,
    MissingRange,
    UnknownArgument,
};

pub fn main(init: std.process.Init) u8 {
    const allocator = init.arena.allocator();
    const args = init.minimal.args.toSlice(allocator) catch |err| {
        std.log.err("unable to read command-line arguments: {t}", .{err});
        return 1;
    };
    const command = parseArgs(args) catch |err| {
        std.log.err("{s}", .{parseErrorMessage(err)});
        std.Io.File.stderr().writeStreamingAll(init.io, usage) catch {};
        return 2;
    };

    const options = switch (command) {
        .help => {
            std.Io.File.stdout().writeStreamingAll(init.io, usage) catch |err| {
                std.log.err("unable to write help: {t}", .{err});
                return 1;
            };
            return 0;
        },
        .launch => |options| options,
    };

    const directory = canonicalizeDirectory(init.io, allocator, .cwd(), options.directory) catch |err| {
        std.log.err("invalid directory '{s}': {t}", .{ options.directory, err });
        return 2;
    };
    launch(init.io, allocator, directory, options.range) catch |err| {
        std.log.err("unable to launch rvw: {t}", .{err});
        return 1;
    };
    return 0;
}

fn parseArgs(args: []const []const u8) ParseError!Command {
    var options: Options = .{};
    var has_directory = false;
    var has_range = false;
    var positional_only = false;
    var index: usize = 1;

    while (index < args.len) : (index += 1) {
        const argument = args[index];
        if (!positional_only and
            (std.mem.eql(u8, argument, "-h") or std.mem.eql(u8, argument, "--help")))
        {
            return .help;
        }
        if (!positional_only and std.mem.eql(u8, argument, "--")) {
            positional_only = true;
            continue;
        }
        if (!positional_only and
            (std.mem.eql(u8, argument, "-r") or std.mem.eql(u8, argument, "--range")))
        {
            if (has_range) return error.DuplicateRange;
            index += 1;
            if (index == args.len) return error.MissingRange;
            if (args[index].len == 0) return error.EmptyRange;
            options.range = args[index];
            has_range = true;
            continue;
        }
        if (!positional_only and std.mem.startsWith(u8, argument, "-")) {
            return error.UnknownArgument;
        }
        if (has_directory) return error.DuplicateDirectory;
        options.directory = argument;
        has_directory = true;
    }

    return .{ .launch = options };
}

fn parseErrorMessage(err: ParseError) []const u8 {
    return switch (err) {
        error.DuplicateDirectory => "only one directory may be provided",
        error.DuplicateRange => "the commit range may only be provided once",
        error.EmptyRange => "the commit range cannot be empty",
        error.MissingRange => "missing value for commit range",
        error.UnknownArgument => "unknown command-line argument",
    };
}

fn canonicalizeDirectory(
    io: std.Io,
    allocator: std.mem.Allocator,
    base_dir: std.Io.Dir,
    path: []const u8,
) ![:0]u8 {
    const stat = try base_dir.statFile(io, path, .{});
    if (stat.kind != .directory) return error.NotDirectory;
    return base_dir.realPathFileAlloc(io, path, allocator);
}

fn launch(
    io: std.Io,
    allocator: std.mem.Allocator,
    directory: []const u8,
    range: ?[]const u8,
) !void {
    const executable_dir = try std.process.executableDirPathAlloc(io, allocator);
    const bundle_path = try appBundlePath(executable_dir);
    var buffer: [9][]const u8 = undefined;
    const argv = launchArguments(&buffer, bundle_path, directory, range);

    var child = try std.process.spawn(io, .{ .argv = argv });
    const result = try child.wait(io);
    switch (result) {
        .exited => |status| if (status != 0) return error.LaunchFailed,
        else => return error.LaunchFailed,
    }
}

fn appBundlePath(executable_dir: []const u8) ![]const u8 {
    const contents_dir = std.fs.path.dirname(executable_dir) orelse
        return error.InvalidBundleLayout;
    return std.fs.path.dirname(contents_dir) orelse
        error.InvalidBundleLayout;
}

fn launchArguments(
    buffer: *[9][]const u8,
    bundle_path: []const u8,
    directory: []const u8,
    range: ?[]const u8,
) []const []const u8 {
    buffer[0..7].* = .{
        "/usr/bin/open",
        "-n",
        bundle_path,
        "--args",
        "--rvw-cli-launch",
        "--directory",
        directory,
    };
    if (range) |value| {
        buffer[7] = "--range";
        buffer[8] = value;
        return buffer[0..9];
    }
    return buffer[0..7];
}

test "parse defaults" {
    const options = (try parseArgs(&.{"rvw"})).launch;
    try std.testing.expectEqualStrings(".", options.directory);
    try std.testing.expectEqual(null, options.range);
}

test "parse directory and range in either order" {
    const directory_first = (try parseArgs(&.{ "rvw", "repo", "--range", "main..HEAD" })).launch;
    try std.testing.expectEqualStrings("repo", directory_first.directory);
    try std.testing.expectEqualStrings("main..HEAD", directory_first.range.?);

    const range_first = (try parseArgs(&.{ "rvw", "-r", "HEAD~2..HEAD", "repo" })).launch;
    try std.testing.expectEqualStrings("repo", range_first.directory);
    try std.testing.expectEqualStrings("HEAD~2..HEAD", range_first.range.?);
}

test "parse help and option terminator" {
    try std.testing.expect((try parseArgs(&.{ "rvw", "-h" })) == .help);
    try std.testing.expect((try parseArgs(&.{ "rvw", "--help" })) == .help);
    const options = (try parseArgs(&.{ "rvw", "--", "-repo" })).launch;
    try std.testing.expectEqualStrings("-repo", options.directory);
}

test "reject invalid arguments" {
    try std.testing.expectError(error.DuplicateDirectory, parseArgs(&.{ "rvw", "one", "two" }));
    try std.testing.expectError(error.DuplicateRange, parseArgs(&.{ "rvw", "-r", "one", "-r", "two" }));
    try std.testing.expectError(error.MissingRange, parseArgs(&.{ "rvw", "--range" }));
    try std.testing.expectError(error.EmptyRange, parseArgs(&.{ "rvw", "--range", "" }));
    try std.testing.expectError(error.UnknownArgument, parseArgs(&.{ "rvw", "--unknown" }));
}

test "canonicalize an existing directory and reject invalid paths" {
    var temporary = std.testing.tmpDir(.{});
    defer temporary.cleanup();

    const canonical = try canonicalizeDirectory(std.testing.io, std.testing.allocator, temporary.dir, ".");
    defer std.testing.allocator.free(canonical);
    try std.testing.expect(std.fs.path.isAbsolute(canonical));

    const file = try temporary.dir.createFile(std.testing.io, "file", .{});
    file.close(std.testing.io);
    try std.testing.expectError(
        error.NotDirectory,
        canonicalizeDirectory(std.testing.io, std.testing.allocator, temporary.dir, "file"),
    );
    try std.testing.expectError(
        error.FileNotFound,
        canonicalizeDirectory(std.testing.io, std.testing.allocator, temporary.dir, "missing"),
    );
}

test "construct normalized launch arguments" {
    var buffer: [9][]const u8 = undefined;
    const without_range = launchArguments(&buffer, "/Applications/Rvw.app", "/repo", null);
    try std.testing.expectEqualSlices([]const u8, &.{
        "/usr/bin/open",
        "-n",
        "/Applications/Rvw.app",
        "--args",
        "--rvw-cli-launch",
        "--directory",
        "/repo",
    }, without_range);

    const with_range = launchArguments(&buffer, "/Applications/Rvw.app", "/repo", "main..HEAD");
    try std.testing.expectEqualSlices([]const u8, &.{
        "/usr/bin/open",
        "-n",
        "/Applications/Rvw.app",
        "--args",
        "--rvw-cli-launch",
        "--directory",
        "/repo",
        "--range",
        "main..HEAD",
    }, with_range);
}

test "derive the app bundle from the executable directory" {
    try std.testing.expectEqualStrings(
        "/Applications/Rvw.app",
        try appBundlePath("/Applications/Rvw.app/Contents/MacOS"),
    );
    try std.testing.expectError(error.InvalidBundleLayout, appBundlePath("/"));
}
