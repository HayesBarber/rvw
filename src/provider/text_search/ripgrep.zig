const std = @import("std");
const model = @import("../../app/model.zig");
const TextSearchProvider = @import("interface.zig").TextSearchProvider;

pub const maximum_output_size = 4 * 1024 * 1024;
pub const maximum_matches = 1000;

/// Each result owns its memory. Call result.deinit() after serialization.
pub const RipgrepProvider = struct {
    allocator: std.mem.Allocator,
    mode: model.TextSearchMode,
    /// Null discovers rg through the parent process PATH. An override must be absolute.
    executable: ?[]const u8 = null,
    output_limit: usize = maximum_output_size,
    match_limit: usize = maximum_matches,

    pub fn interface(self: *RipgrepProvider) TextSearchProvider {
        return .{ .context = self, .vtable = &.{ .search = search } };
    }

    fn search(context: *anyopaque, io: std.Io, directory: []const u8, query: []const u8) !model.TextSearchResult {
        const self: *RipgrepProvider = @ptrCast(@alignCast(context));
        const executable = self.executable orelse "rg";
        if (self.executable != null and !std.fs.path.isAbsolute(executable)) return error.SearchUnavailable;
        var argv: std.ArrayList([]const u8) = .empty;
        defer argv.deinit(self.allocator);
        try argv.appendSlice(self.allocator, &.{
            executable,      "--no-config",   "--json",          "--fixed-strings", "--case-sensitive",
            "--line-number", "--color=never", "--encoding=none",
        });
        if (self.mode == .@"all-files") try argv.appendSlice(self.allocator, &.{ "--no-ignore", "--hidden" });
        try argv.appendSlice(self.allocator, &.{ "--", query, "." });
        var root = std.Io.Dir.cwd().openDir(io, directory, .{}) catch return error.SearchFailed;
        defer root.close(io);
        var child = std.process.spawn(io, .{
            .argv = argv.items,
            .cwd = .{ .dir = root },
            .stdin = .ignore,
            .stdout = .pipe,
            .stderr = .pipe,
        }) catch |err| switch (err) {
            error.FileNotFound, error.AccessDenied, error.InvalidExe => return error.SearchUnavailable,
            else => return error.SearchFailed,
        };
        defer child.kill(io);

        var buffer: std.Io.File.MultiReader.Buffer(2) = undefined;
        var reader: std.Io.File.MultiReader = undefined;
        reader.init(self.allocator, io, buffer.toStreams(), &.{ child.stdout.?, child.stderr.? });
        defer reader.deinit();
        var truncated = false;
        while (reader.fill(4096, .none)) |_| {
            if (reader.reader(1).buffered().len > 4096) return error.SearchFailed;
            if (reader.reader(0).buffered().len > self.output_limit) {
                truncated = true;
                break;
            }
        } else |err| switch (err) {
            error.EndOfStream => {},
            else => return error.SearchFailed,
        }
        if (!truncated) {
            reader.checkAnyError() catch return error.SearchFailed;
            const term = child.wait(io) catch return error.SearchFailed;
            switch (term) {
                .exited => |code| if (code != 0 and code != 1) return error.SearchFailed,
                else => return error.SearchFailed,
            }
        }
        var output = reader.reader(0).buffered();
        if (truncated) {
            child.kill(io);
            output = output[0..@min(output.len, self.output_limit)];
            output = output[0..if (std.mem.lastIndexOfScalar(u8, output, '\n')) |end| end + 1 else 0];
        }
        return parseOutput(self.allocator, output, self.match_limit, truncated);
    }
};

const Text = struct { text: ?[]const u8 = null, bytes: ?[]const u8 = null };
const MatchData = struct {
    path: Text,
    lines: Text,
    line_number: usize,
    submatches: []const struct { start: usize, end: usize },
};

fn parseOutput(allocator: std.mem.Allocator, output: []const u8, limit: usize, output_truncated: bool) !model.TextSearchResult {
    var arena = std.heap.ArenaAllocator.init(allocator);
    errdefer arena.deinit();
    const owned = arena.allocator();
    var matches: std.ArrayList(model.TextSearchMatch) = .empty;
    var truncated = output_truncated;
    var lines = std.mem.splitScalar(u8, output, '\n');
    while (lines.next()) |line| {
        if (line.len == 0) continue;
        var parsed = std.json.parseFromSlice(std.json.Value, allocator, line, .{}) catch return error.SearchFailed;
        defer parsed.deinit();
        if (parsed.value != .object) return error.SearchFailed;
        const kind = parsed.value.object.get("type") orelse return error.SearchFailed;
        if (kind != .string) return error.SearchFailed;
        if (!std.mem.eql(u8, kind.string, "match")) continue;
        if (matches.items.len == limit) {
            truncated = true;
            break;
        }
        const data = parsed.value.object.get("data") orelse return error.SearchFailed;
        var match = std.json.parseFromValue(MatchData, allocator, data, .{ .ignore_unknown_fields = true }) catch return error.SearchFailed;
        defer match.deinit();
        const value = match.value;
        // ripgrep uses base64 for non-UTF-8 data. Such files cannot meet the text contract.
        var path = value.path.text orelse continue;
        const text = value.lines.text orelse continue;
        if (!std.unicode.utf8ValidateSlice(path) or !std.unicode.utf8ValidateSlice(text)) continue;
        if (std.mem.startsWith(u8, path, "./")) path = path[2..];
        if (path.len == 0 or std.fs.path.isAbsolute(path) or value.line_number == 0) return error.SearchFailed;
        var line_text = text;
        if (std.mem.endsWith(u8, line_text, "\n")) {
            line_text = line_text[0 .. line_text.len - 1];
            if (std.mem.endsWith(u8, line_text, "\r")) line_text = line_text[0 .. line_text.len - 1];
        }
        const spans = try owned.alloc(model.TextSearchSpan, value.submatches.len);
        var byte_offset: usize = 0;
        var utf16_offset: usize = 0;
        for (value.submatches, spans) |span, *target| {
            if (span.start < byte_offset or span.start >= span.end or span.end > line_text.len) return error.SearchFailed;
            // Scan each byte once, even when one line contains many matches.
            utf16_offset += try utf16Offset(line_text[byte_offset..span.start], span.start - byte_offset);
            target.start = utf16_offset;
            utf16_offset += try utf16Offset(line_text[span.start..span.end], span.end - span.start);
            target.end = utf16_offset;
            byte_offset = span.end;
        }
        try matches.append(owned, .{
            .path = try owned.dupe(u8, path),
            .lineNumber = value.line_number,
            .lineText = try owned.dupe(u8, line_text),
            .spans = spans,
        });
    }
    return .{ .matches = try matches.toOwnedSlice(owned), .truncated = truncated, .arena = arena };
}

fn utf16Offset(text: []const u8, offset: usize) !usize {
    const view = std.unicode.Utf8View.init(text[0..offset]) catch return error.SearchFailed;
    var iterator = view.iterator();
    var count: usize = 0;
    while (iterator.nextCodepoint()) |codepoint| count += if (codepoint > 0xffff) @as(usize, 2) else 1;
    return count;
}

test "ripgrep modes search unchanged files and include ignored and hidden files only in all-files mode" {
    var repository = try @import("../../testing/repository.zig").Repository.init(std.testing.allocator);
    defer repository.deinit();
    try repository.write(".gitignore", "ignored.txt\n");
    try repository.write("space 雪.txt", "header\r\na😀雪雪\r\n");
    try repository.commit("unchanged file");
    try repository.write("ignored.txt", "雪\n");
    try repository.write(".hidden", "雪\n");
    for (std.enums.values(model.TextSearchMode)) |mode| {
        var provider: RipgrepProvider = .{ .allocator = std.testing.allocator, .mode = mode };
        const result = try provider.interface().search(std.testing.io, repository.root, "雪");
        defer result.deinit();
        try std.testing.expectEqual(@as(usize, if (mode == .@"all-files") 3 else 1), result.matches.len);
        try std.testing.expect(!result.truncated);
        var found = false;
        for (result.matches) |match| {
            if (!std.mem.eql(u8, match.path, "space 雪.txt")) continue;
            found = true;
            try std.testing.expectEqual(@as(usize, 2), match.lineNumber);
            try std.testing.expectEqualStrings("a😀雪雪", match.lineText);
            try std.testing.expectEqualSlices(model.TextSearchSpan, &.{ .{ .start = 3, .end = 4 }, .{ .start = 4, .end = 5 } }, match.spans);
        }
        try std.testing.expect(found);
        const empty = try provider.interface().search(std.testing.io, repository.root, "absent");
        defer empty.deinit();
        try std.testing.expectEqual(@as(usize, 0), empty.matches.len);
        try std.testing.expect(!empty.truncated);
        const literal = "--flag ; $(echo bad) .*";
        try repository.write("literal.txt", literal);
        const literal_result = try provider.interface().search(std.testing.io, repository.root, literal);
        defer literal_result.deinit();
        try std.testing.expectEqual(@as(usize, 1), literal_result.matches.len);
        try std.testing.expectEqualStrings(literal, literal_result.matches[0].lineText);
    }
}

test "ripgrep limits report partial results and release storage between searches" {
    var repository = try @import("../../testing/repository.zig").Repository.init(std.testing.allocator);
    defer repository.deinit();
    const contents = "needle\n" ** 5000;
    try repository.write("many.txt", contents);
    var provider: RipgrepProvider = .{ .allocator = std.testing.allocator, .mode = .@"ignore-aware", .match_limit = 2 };
    const limited = try provider.interface().search(std.testing.io, repository.root, "needle");
    defer limited.deinit();
    try std.testing.expect(limited.truncated);
    try std.testing.expectEqual(@as(usize, 2), limited.matches.len);
    provider.match_limit = maximum_matches;
    provider.output_limit = 1024;
    const bounded = try provider.interface().search(std.testing.io, repository.root, "needle");
    defer bounded.deinit();
    try std.testing.expect(bounded.truncated);
    try std.testing.expect(bounded.matches.len > 0);
    // A later search must not invalidate the earlier result.
    try std.testing.expectEqualStrings("needle", limited.matches[0].lineText);
    provider.output_limit = 1;
    const tiny = try provider.interface().search(std.testing.io, repository.root, "needle");
    defer tiny.deinit();
    try std.testing.expect(tiny.truncated);
    try std.testing.expectEqual(@as(usize, 0), tiny.matches.len);
}

test "ripgrep failures map to actionable contract errors" {
    var repository = try @import("../../testing/repository.zig").Repository.init(std.testing.allocator);
    defer repository.deinit();
    var provider: RipgrepProvider = .{ .allocator = std.testing.allocator, .mode = .@"ignore-aware", .executable = "/rvw-missing-rg" };
    try std.testing.expectError(error.SearchUnavailable, provider.interface().search(std.testing.io, repository.root, "needle"));
    provider.executable = "relative-rg";
    try std.testing.expectError(error.SearchUnavailable, provider.interface().search(std.testing.io, repository.root, "needle"));
    try repository.write("not-executable", "not executable");
    const executable = try std.fs.path.join(std.testing.allocator, &.{ repository.root, "not-executable" });
    defer std.testing.allocator.free(executable);
    provider.executable = executable;
    try std.testing.expectError(error.SearchUnavailable, provider.interface().search(std.testing.io, repository.root, "needle"));
    provider.executable = "/usr/bin/false";
    // Exit 1 is the ripgrep no-match contract.
    const empty = try provider.interface().search(std.testing.io, repository.root, "needle");
    defer empty.deinit();
    try std.testing.expectEqual(@as(usize, 0), empty.matches.len);
    try repository.write("failed-rg", "#!/bin/sh\necho 'search failed' >&2\nexit 2\n");
    var failed_file = try repository.temporary.dir.openFile(std.testing.io, "failed-rg", .{});
    defer failed_file.close(std.testing.io);
    try failed_file.setPermissions(std.testing.io, .executable_file);
    const failed_path = try std.fs.path.join(std.testing.allocator, &.{ repository.root, "failed-rg" });
    defer std.testing.allocator.free(failed_path);
    provider.executable = failed_path;
    try std.testing.expectError(error.SearchFailed, provider.interface().search(std.testing.io, repository.root, "needle"));
    provider.executable = null;
    try std.testing.expectError(error.SearchFailed, provider.interface().search(std.testing.io, "/rvw-missing-directory", "needle"));
    for ([_][]const u8{ "a\nb", "a\rb", "a\x00b", "\xff" }) |invalid| {
        try std.testing.expectError(error.InvalidSearchQuery, provider.interface().search(std.testing.io, repository.root, invalid));
    }
    // Empty queries do not require an executable.
    provider.executable = "/rvw-missing-rg";
    const blank = try provider.interface().search(std.testing.io, repository.root, "");
    defer blank.deinit();
    try std.testing.expectEqual(@as(usize, 0), blank.matches.len);
}

test "structured output ignores non-match records and rejects malformed spans" {
    const fixture =
        \\{"type":"begin","data":{"path":{"text":"./a.txt"}}}
        \\{"type":"match","data":{"path":{"text":"./a.txt"},"lines":{"text":"😀雪\n"},"line_number":3,"submatches":[{"start":0,"end":4},{"start":4,"end":7}]}}
        \\{"type":"end","data":{}}
    ;
    const result = try parseOutput(std.testing.allocator, fixture, 10, false);
    defer result.deinit();
    try std.testing.expectEqualStrings("a.txt", result.matches[0].path);
    try std.testing.expectEqualSlices(model.TextSearchSpan, &.{ .{ .start = 0, .end = 2 }, .{ .start = 2, .end = 3 } }, result.matches[0].spans);
    try std.testing.expectError(error.SearchFailed, utf16Offset("😀", 1));
    for ([_][]const u8{
        "not json",
        \\{"type":"match","data":{}}
        ,
        \\{"type":"match","data":{"path":{"text":"./a"},"lines":{"text":"a\n"},"line_number":1,"submatches":[{"start":0,"end":9}]}}
        ,
    }) |invalid| try std.testing.expectError(error.SearchFailed, parseOutput(std.testing.allocator, invalid, 10, false));
    const binary = try parseOutput(std.testing.allocator,
        \\{"type":"match","data":{"path":{"text":"./a"},"lines":{"bytes":"/w=="},"line_number":1,"submatches":[{"start":0,"end":1}]}}
    , 10, false);
    defer binary.deinit();
    try std.testing.expectEqual(@as(usize, 0), binary.matches.len);
}
