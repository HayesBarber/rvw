const std = @import("std");

pub fn main(init: std.process.Init) !void {
    const executable_dir = try std.process.executableDirPathAlloc(init.io, init.gpa);
    defer init.gpa.free(executable_dir);

    const contents_dir = std.fs.path.dirname(executable_dir) orelse
        return error.InvalidBundleLayout;
    const bundle_path = std.fs.path.dirname(contents_dir) orelse
        return error.InvalidBundleLayout;

    var child = try std.process.spawn(init.io, .{
        .argv = &.{
            "/usr/bin/open",
            "-n",
            bundle_path,
            "--args",
            "--rvw-cli-launch",
        },
    });
    const result = try child.wait(init.io);
    switch (result) {
        .exited => |status| if (status != 0) return error.LaunchFailed,
        else => return error.LaunchFailed,
    }
}
