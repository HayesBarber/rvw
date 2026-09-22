const std = @import("std");
const Io = std.Io;
const Allocator = std.mem.Allocator;
pub const Match = struct { path: []const u8, line: usize, text: []const u8, spans: []const Span };
pub const Span = struct { start: usize, end: usize };
pub const Result = struct {
    status: enum { searching, complete, cancelled } = .searching,
    matches: []const Match = &.{},
    truncated: bool = false,
    message: ?[]const u8 = null,
    pub fn deinit(self: Result, allocator: Allocator) void {
        for (self.matches) |match| {
            allocator.free(match.path);
            allocator.free(match.text);
            allocator.free(match.spans);
        }
        allocator.free(self.matches);
        if (self.message) |message| allocator.free(message);
    }
};

/// One bounded, cancellable search per review. Polling never waits for ripgrep.
pub const Search = struct {
    mutex: Io.Mutex = .init,
    job: ?*Job = null,

    pub fn cancel(self: *Search, io: Io) void {
        if (self.job) |job| {
            job.future.?.cancel(io);
            job.arena.deinit();
            std.heap.page_allocator.destroy(job);
            self.job = null;
        }
    }

    pub fn request(self: *Search, io: Io, allocator: Allocator, root: []const u8, id: []const u8, query: ?[]const u8, all: bool, stop: bool) !Result {
        try self.mutex.lock(io);
        defer self.mutex.unlock(io);
        if (query) |text| {
            self.cancel(io);
            const job = try std.heap.page_allocator.create(Job);
            job.* = .{ .arena = .init(std.heap.page_allocator) };
            errdefer {
                job.arena.deinit();
                std.heap.page_allocator.destroy(job);
            }
            const a = job.arena.allocator();
            job.id = try a.dupe(u8, id);
            job.root = try a.dupe(u8, root);
            job.query = try a.dupe(u8, text);
            job.all = all;
            job.future = try io.concurrent(Job.work, .{ job, io });
            self.job = job;
        }
        const job = self.job orelse return .{ .status = .cancelled };
        if (!std.mem.eql(u8, job.id, id)) return .{ .status = .cancelled };
        if (stop) {
            self.cancel(io);
            return .{ .status = .cancelled };
        }
        if (!job.done.load(.acquire)) return .{};
        // The caller owns a snapshot, so a subsequent start can free the job.
        var result = job.result;
        const matches = try allocator.alloc(Match, result.matches.len);
        for (result.matches, matches) |m, *copy| copy.* = .{ .path = try allocator.dupe(u8, m.path), .line = m.line, .text = try allocator.dupe(u8, m.text), .spans = try allocator.dupe(Span, m.spans) };
        result.matches = matches;
        if (result.message) |message| result.message = try allocator.dupe(u8, message);
        return result;
    }
};

const Job = struct {
    arena: std.heap.ArenaAllocator,
    future: ?Io.Future(void) = null,
    done: std.atomic.Value(bool) = .init(false),
    id: []const u8 = "",
    root: []const u8 = "",
    query: []const u8 = "",
    all: bool = false,
    executable: ?[]const u8 = null,
    result: Result = .{},

    fn work(self: *Job, io: Io) void {
        self.run(io) catch |err| {
            self.result.message = if (err == error.FileNotFound)
                "Ripgrep (rg) was not found. Install ripgrep and ensure rg is on PATH, then restart Rvw."
            else
                "Search failed while reading ripgrep output. Try a narrower query.";
        };
        self.result.status = .complete;
        self.done.store(true, .release);
    }

    fn run(self: *Job, io: Io) !void {
        if (self.query.len == 0) return;
        const a = self.arena.allocator();
        const executable = self.executable orelse try locateRipgrep(a, io);
        const argv = &.{ executable, "--json", "--no-config", "--fixed-strings", "--smart-case", "--hidden", "--glob", "!.git", if (self.all) "--no-ignore" else "--no-follow", "--", self.query, "." };
        var child = try std.process.spawn(io, .{ .argv = argv, .cwd = .{ .path = self.root }, .stdin = .ignore, .stdout = .pipe, .stderr = .pipe });
        defer child.kill(io);
        var buffer: Io.File.MultiReader.Buffer(2) = undefined;
        var reader: Io.File.MultiReader = undefined;
        reader.init(a, io, buffer.toStreams(), &.{ child.stdout.?, child.stderr.? });
        defer reader.deinit();
        var matches: std.ArrayList(Match) = .empty;
        var consumed: usize = 0;
        var file_start: ?usize = null;
        const deadline = (Io.Timeout{ .duration = .{ .raw = .fromSeconds(10), .clock = .awake } }).toDeadline(io);
        while (reader.fill(4096, deadline)) |_| {
            const output = reader.reader(0).buffered();
            while (std.mem.indexOfScalarPos(u8, output, consumed, '\n')) |end| {
                const row = output[consumed..end];
                consumed = end + 1;
                const parsed = try std.json.parseFromSlice(std.json.Value, a, row, .{ .allocate = .alloc_always });
                const event = parsed.value.object;
                const kind = event.get("type").?.string;
                if (std.mem.eql(u8, kind, "begin")) file_start = matches.items.len;
                if (matches.items.len <= 500) {
                    if (try parseMatch(a, parsed.value)) |match| try matches.append(a, match);
                }
                if (std.mem.eql(u8, kind, "end")) {
                    const binary = event.get("data").?.object.get("binary_offset");
                    if (binary != null and binary.? != .null) matches.shrinkRetainingCapacity(file_start orelse matches.items.len);
                    file_start = null;
                    if (matches.items.len > 500) {
                        matches.shrinkRetainingCapacity(500);
                        self.result.truncated = true;
                        break;
                    }
                }
            }
            if (self.result.truncated or output.len > 2 * 1024 * 1024 or reader.reader(1).buffered().len > 8192) {
                self.result.truncated = true;
                break;
            }
        } else |err| switch (err) {
            error.EndOfStream => {},
            error.Timeout => {
                self.result.truncated = true;
                self.result.message = "Search reached the ten-second limit. Narrow your query.";
            },
            else => return err,
        }
        // Do not publish a partially read file: its end event may classify it as binary.
        if (file_start) |start| matches.shrinkRetainingCapacity(start);
        self.result.matches = try matches.toOwnedSlice(a);
        const stderr = reader.reader(1).buffered();
        if (stderr.len > 0) self.result.message = try a.dupe(u8, stderr);
        if (!self.result.truncated) {
            try reader.checkAnyError();
            const term = try child.wait(io);
            switch (term) {
                .exited => |code| if (code > 1 and self.result.message == null) {
                    self.result.message = "Ripgrep could not search all files.";
                },
                else => self.result.message = "Ripgrep terminated unexpectedly.",
            }
        }
    }
};

fn parseMatch(a: Allocator, value: std.json.Value) !?Match {
    const object = value.object;
    if (!std.mem.eql(u8, object.get("type").?.string, "match")) return null;
    const data = object.get("data").?.object;
    const path = data.get("path").?.object.get("text") orelse return null;
    const lines = data.get("lines").?.object.get("text") orelse return null;
    if (!std.unicode.utf8ValidateSlice(path.string) or !std.unicode.utf8ValidateSlice(lines.string)) return null;
    var spans: std.ArrayList(Span) = .empty;
    for (data.get("submatches").?.array.items) |sub| {
        try spans.append(a, .{ .start = @intCast(sub.object.get("start").?.integer), .end = @intCast(sub.object.get("end").?.integer) });
    }
    return .{ .path = if (std.mem.startsWith(u8, path.string, "./")) path.string[2..] else path.string, .line = @intCast(data.get("line_number").?.integer), .text = lines.string, .spans = try spans.toOwnedSlice(a) };
}

test "ripgrep searches hidden and ignored files with literal smart case and excludes metadata" {
    var repo = try @import("../testing/repository.zig").Repository.init(std.testing.allocator);
    defer repo.deinit();
    try repo.write(".gitignore", "ignored.txt\n");
    try repo.write("ordinary.txt", "needle.*\nNEEDLE.*\n");
    try repo.write(".hidden/file.txt", "needle.*\n");
    try repo.write("ignored.txt", "needle.*\n");
    try repo.write(".git/private", "needle.*\n");
    try repo.write("binary", "\x00needle.*\n");
    try repo.write("late-binary", "needle.*\n" ++ ("x" ** 100000) ++ "\x00");
    try repo.temporary.dir.symLink(std.testing.io, ".hidden", "linked-directory", .{ .is_directory = true });
    var job: Job = .{ .arena = .init(std.testing.allocator), .root = repo.root, .query = "needle.*" };
    defer job.arena.deinit();
    try job.run(std.testing.io);
    try std.testing.expectEqual(@as(usize, 3), job.result.matches.len);
    job.all = true;
    try job.run(std.testing.io);
    try std.testing.expectEqual(@as(usize, 4), job.result.matches.len);
    job.query = "NEEDLE.*";
    try job.run(std.testing.io);
    try std.testing.expectEqual(@as(usize, 1), job.result.matches.len);
    job.query = "no match";
    try job.run(std.testing.io);
    try std.testing.expectEqual(@as(usize, 0), job.result.matches.len);
    try std.testing.expectEqual(@as(?[]const u8, null), job.result.message);
}

test "large searches retain bounded partial matches" {
    var repo = try @import("../testing/repository.zig").Repository.init(std.testing.allocator);
    defer repo.deinit();
    try repo.write("many.txt", "match\n" ** 800);
    var job: Job = .{ .arena = .init(std.testing.allocator), .root = repo.root, .query = "match" };
    defer job.arena.deinit();
    try job.run(std.testing.io);
    try std.testing.expectEqual(@as(usize, 500), job.result.matches.len);
    try std.testing.expect(job.result.truncated);
}

test "superseded search cancellation cannot cancel a newer job" {
    var arena: std.heap.ArenaAllocator = .init(std.testing.allocator);
    defer arena.deinit();
    var repo = try @import("../testing/repository.zig").Repository.init(std.testing.allocator);
    defer repo.deinit();
    var search: Search = .{};
    defer search.cancel(std.testing.io);
    _ = try search.request(std.testing.io, arena.allocator(), repo.root, "old", "one", false, false);
    _ = try search.request(std.testing.io, arena.allocator(), repo.root, "new", "two", false, false);
    const stale = try search.request(std.testing.io, arena.allocator(), repo.root, "old", null, false, true);
    try std.testing.expectEqual(.cancelled, stale.status);
    try std.testing.expectEqualStrings("new", search.job.?.id);
    const cancelled = try search.request(std.testing.io, arena.allocator(), repo.root, "new", null, false, true);
    try std.testing.expectEqual(.cancelled, cancelled.status);
    try std.testing.expect(search.job == null);
}

/// Finder-launched macOS applications may not inherit the user's shell PATH.
fn locateRipgrep(a: Allocator, io: Io) ![]const u8 {
    if (@import("builtin").os.tag == .macos) {
        const executable = try std.process.executablePathAlloc(io, a);
        const sibling = try std.fs.path.join(a, &.{ std.fs.path.dirname(executable).?, "rg" });
        if (Io.Dir.cwd().access(io, sibling, .{})) |_| return sibling else |_| {}
        for ([_][]const u8{ "/opt/homebrew/bin/rg", "/usr/local/bin/rg" }) |candidate| {
            if (Io.Dir.cwd().access(io, candidate, .{})) |_| return candidate else |_| {}
        }
    }
    return "rg";
}

test "missing executable and search errors are actionable" {
    var job: Job = .{ .arena = .init(std.testing.allocator), .query = "match", .root = "/", .executable = "/rvw-missing-ripgrep" };
    defer job.arena.deinit();
    job.work(std.testing.io);
    try std.testing.expectEqual(.complete, job.result.status);
    try std.testing.expect(std.mem.indexOf(u8, job.result.message.?, "Install ripgrep") != null);
    job.executable = null;
    job.root = "/rvw-missing-search-root";
    job.work(std.testing.io);
    try std.testing.expect(job.result.message != null);
}

test "unreadable files report partial search errors alongside matches" {
    var repo = try @import("../testing/repository.zig").Repository.init(std.testing.allocator);
    defer repo.deinit();
    try repo.write("readable.txt", "needle\n");
    try repo.write("unreadable.txt", "needle\n");
    const file = try repo.temporary.dir.openFile(std.testing.io, "unreadable.txt", .{});
    defer file.close(std.testing.io);
    try file.setPermissions(std.testing.io, @enumFromInt(0));
    defer file.setPermissions(std.testing.io, .default_file) catch {};
    var job: Job = .{ .arena = .init(std.testing.allocator), .query = "needle", .root = repo.root };
    defer job.arena.deinit();
    try job.run(std.testing.io);
    try std.testing.expectEqual(@as(usize, 1), job.result.matches.len);
    try std.testing.expect(job.result.message != null);
}
