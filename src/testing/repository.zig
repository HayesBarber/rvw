const std = @import("std");

pub const Repository = struct {
    allocator: std.mem.Allocator,
    temporary: std.testing.TmpDir,
    root: [:0]u8,

    pub fn init(allocator: std.mem.Allocator) !Repository {
        var temporary = std.testing.tmpDir(.{});
        errdefer temporary.cleanup();
        const root = try temporary.dir.realPathFileAlloc(std.testing.io, ".", allocator);
        errdefer allocator.free(root);

        var repository: Repository = .{
            .allocator = allocator,
            .temporary = temporary,
            .root = root,
        };
        try repository.git(&.{ "init", "--quiet" });
        return repository;
    }

    pub fn deinit(self: *Repository) void {
        self.allocator.free(self.root);
        self.temporary.cleanup();
        self.* = undefined;
    }

    pub fn write(self: *Repository, path: []const u8, contents: []const u8) !void {
        if (std.fs.path.dirname(path)) |parent| {
            try self.temporary.dir.createDirPath(std.testing.io, parent);
        }
        try self.temporary.dir.writeFile(std.testing.io, .{
            .sub_path = path,
            .data = contents,
        });
    }

    pub fn commit(self: *Repository, message: []const u8) !void {
        try self.git(&.{ "add", "--all" });
        try self.git(&.{
            "-c",
            "user.name=rvw tests",
            "-c",
            "user.email=rvw-tests@example.invalid",
            "-c",
            "commit.gpgSign=false",
            "commit",
            "--quiet",
            "-m",
            message,
        });
    }

    pub fn revision(self: *Repository, name: []const u8) ![]u8 {
        const output = try self.runGit(&.{ "rev-parse", "--verify", name });
        defer self.allocator.free(output);
        return self.allocator.dupe(u8, std.mem.trim(u8, output, " \t\r\n"));
    }

    pub fn git(self: *Repository, arguments: []const []const u8) !void {
        const output = try self.runGit(arguments);
        self.allocator.free(output);
    }

    fn runGit(self: *Repository, arguments: []const []const u8) ![]u8 {
        var argv: std.ArrayList([]const u8) = .empty;
        defer argv.deinit(self.allocator);
        try argv.appendSlice(self.allocator, &.{
            "git",
            "-c",
            "core.autocrlf=false",
            "-c",
            "core.hooksPath=/dev/null",
            "-C",
            self.root,
        });
        try argv.appendSlice(self.allocator, arguments);

        const result = try std.process.run(self.allocator, std.testing.io, .{
            .argv = argv.items,
            .stdout_limit = .limited(1024 * 1024),
            .stderr_limit = .limited(1024 * 1024),
        });
        errdefer self.allocator.free(result.stdout);
        defer self.allocator.free(result.stderr);
        switch (result.term) {
            .exited => |status| if (status == 0) return result.stdout,
            else => {},
        }
        std.debug.print("git fixture command failed: {s}\n", .{result.stderr});
        return error.GitFixtureFailed;
    }
};
