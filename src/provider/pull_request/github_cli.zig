const std = @import("std");
const model = @import("../../app/model.zig");
const git_process = @import("../../util/git_process.zig");
const PullRequestProvider = @import("interface.zig").PullRequestProvider;
const Error = PullRequestProvider.Error;

pub const GitHubCliProvider = struct {
    allocator: std.mem.Allocator,
    /// Null finds gh through PATH. Overrides must be absolute paths.
    executable: ?[]const u8 = null,
    /// Null finds Git through PATH. Overrides must be absolute paths.
    git_executable: ?[]const u8 = null,

    pub fn interface(self: *GitHubCliProvider) PullRequestProvider {
        return .{ .context = self, .vtable = &.{ .listOpenPullRequests = listOpenPullRequests } };
    }

    fn listOpenPullRequests(context: *anyopaque, io: std.Io, directory: []const u8) Error!model.PullRequestListResult {
        const self: *GitHubCliProvider = @ptrCast(@alignCast(context));
        var arena = std.heap.ArenaAllocator.init(self.allocator);
        errdefer arena.deinit();
        const allocator = arena.allocator();
        const origin = try self.readOrigin(allocator, io, directory);
        const repository = try std.fmt.allocPrint(allocator, "github.com/{s}", .{try repositoryName(origin)});
        const executable = self.executable orelse "gh";
        if (self.executable != null and !std.fs.path.isAbsolute(executable)) return error.PullRequestListUnavailable;
        const output = std.process.run(allocator, io, .{
            .argv = &.{ executable, "pr", "list", "--repo", repository, "--state", "open", "--json", "number,title,author,url,isDraft,baseRefName,headRefName" },
            .cwd = .{ .path = directory },
            .stdout_limit = .limited(git_process.maximum_metadata_size),
            .stderr_limit = .limited(git_process.maximum_stderr_size),
        }) catch |err| switch (err) {
            error.FileNotFound, error.AccessDenied, error.InvalidExe => return error.PullRequestListUnavailable,
            error.OutOfMemory => return error.OutOfMemory,
            else => return error.PullRequestListFailed,
        };
        switch (output.term) {
            .exited => |status| {
                if (status == 4 or (status != 0 and std.mem.indexOf(u8, output.stderr, "HTTP 401") != null)) return error.PullRequestAuthenticationFailed;
                if (status != 0) return error.PullRequestListFailed;
            },
            else => return error.PullRequestListFailed,
        }
        return .{ .pullRequests = try parsePullRequests(allocator, output.stdout), .arena = arena };
    }

    fn readOrigin(self: *GitHubCliProvider, allocator: std.mem.Allocator, io: std.Io, directory: []const u8) Error![]const u8 {
        const executable = self.git_executable orelse "git";
        if (self.git_executable != null and !std.fs.path.isAbsolute(executable)) return error.RepositoryUnavailable;
        const output = git_process.runResult(allocator, io, &.{ executable, "--no-pager", "--no-optional-locks", "-C", directory, "remote", "get-url", "origin" }, git_process.maximum_revision_size) catch |err| switch (err) {
            error.GitNotFound, error.AccessDenied, error.InvalidExe => return error.RepositoryUnavailable,
            error.OutOfMemory => return error.OutOfMemory,
            else => return error.RepositoryFailed,
        };
        switch (output.term) {
            .exited => |status| switch (status) {
                0 => return std.mem.trimEnd(u8, output.stdout, "\r\n"),
                2 => return error.MissingOrigin,
                else => return error.RepositoryFailed,
            },
            else => return error.RepositoryFailed,
        }
    }
};

fn repositoryName(origin: []const u8) error{UnsupportedOrigin}![]const u8 {
    var path: []const u8 = undefined;
    // Git also accepts SCP-style SSH remotes without a URI scheme.
    if (std.mem.startsWith(u8, origin, "git@github.com:")) {
        path = origin["git@github.com:".len..];
    } else {
        const uri = std.Uri.parse(origin) catch return error.UnsupportedOrigin;
        const host = switch (uri.host orelse return error.UnsupportedOrigin) {
            .raw, .percent_encoded => |value| value,
        };
        const default_port: u16 = if (std.ascii.eqlIgnoreCase(uri.scheme, "https")) 443 else if (std.ascii.eqlIgnoreCase(uri.scheme, "http")) 80 else if (std.ascii.eqlIgnoreCase(uri.scheme, "ssh")) 22 else if (std.ascii.eqlIgnoreCase(uri.scheme, "git")) 9418 else return error.UnsupportedOrigin;
        const github_ssh = std.ascii.eqlIgnoreCase(host, "ssh.github.com") and default_port == 22 and uri.port == 443;
        if (!github_ssh and (!std.ascii.eqlIgnoreCase(host, "github.com") or (uri.port != null and uri.port != default_port))) return error.UnsupportedOrigin;
        if (uri.query != null or uri.fragment != null) return error.UnsupportedOrigin;
        const uri_path = switch (uri.path) {
            .raw, .percent_encoded => |value| value,
        };
        if (!std.mem.startsWith(u8, uri_path, "/")) return error.UnsupportedOrigin;
        path = uri_path[1..];
    }
    if (std.mem.endsWith(u8, path, "/")) path = path[0 .. path.len - 1];
    if (std.mem.endsWith(u8, path, ".git")) path = path[0 .. path.len - 4];
    const slash = std.mem.indexOfScalar(u8, path, '/') orelse return error.UnsupportedOrigin;
    if (!validName(path[0..slash]) or !validName(path[slash + 1 ..])) return error.UnsupportedOrigin;
    return path;
}

fn validName(name: []const u8) bool {
    if (name.len == 0 or std.mem.eql(u8, name, ".") or std.mem.eql(u8, name, "..")) return false;
    for (name) |byte| {
        if (!std.ascii.isAlphanumeric(byte) and byte != '-' and byte != '_' and byte != '.') return false;
    }
    return true;
}

const GitHubPullRequest = struct {
    number: u32,
    title: []const u8,
    author: struct { login: []const u8 },
    url: []const u8,
    isDraft: bool,
    baseRefName: []const u8,
    headRefName: []const u8,
};

fn parsePullRequests(allocator: std.mem.Allocator, output: []const u8) Error![]const model.PullRequest {
    if (!std.unicode.utf8ValidateSlice(output)) return error.InvalidPullRequestList;
    const parsed = std.json.parseFromSliceLeaky([]const GitHubPullRequest, allocator, output, .{ .allocate = .alloc_always, .ignore_unknown_fields = true }) catch |err| switch (err) {
        error.OutOfMemory => return error.OutOfMemory,
        else => return error.InvalidPullRequestList,
    };
    const requests = try allocator.alloc(model.PullRequest, parsed.len);
    for (parsed, requests) |item, *request| {
        request.* = .{
            .number = item.number,
            .title = item.title,
            .authorLogin = item.author.login,
            .url = item.url,
            .isDraft = item.isDraft,
            .baseRefName = item.baseRefName,
            .headRefName = item.headRefName,
        };
        if (request.title.len == 0 or request.url.len == 0 or request.baseRefName.len == 0 or request.headRefName.len == 0) return error.InvalidPullRequestList;
    }
    return requests;
}

const TestRepository = @import("../../testing/repository.zig").Repository;
const sample_request =
    \\{"number":42,"title":"Fix \"quoted\" text and 雪","author":{"login":"test-author","is_bot":false},"url":"https://github.com/owner/repo/pull/42","isDraft":true,"baseRefName":"main","headRefName":"feature/雪"}
;
const sample_output = "[" ++ sample_request ++ "," ++
    \\{"number":7,"title":"Second","author":{"login":"other-author"},"url":"https://github.com/owner/repo/pull/7","isDraft":false,"baseRefName":"release","headRefName":"fix"}]
;

fn writeExecutable(repository: *TestRepository, name: []const u8, script: []const u8) ![]u8 {
    try repository.write(name, script);
    var file = try repository.temporary.dir.openFile(std.testing.io, name, .{});
    defer file.close(std.testing.io);
    try file.setPermissions(std.testing.io, .executable_file);
    return std.fs.path.join(std.testing.allocator, &.{ repository.root, name });
}

test "GitHub origins identify the same repository across supported remote forms" {
    for ([_][]const u8{
        "https://github.com/owner/repo",
        "https://github.com/owner/repo.git",
        "https://github.com/owner/repo.git/",
        "https://github.com:443/owner/repo.git",
        "https://user:password@github.com/owner/repo.git",
        "http://github.com/owner/repo",
        "git@github.com:owner/repo.git",
        "ssh://git@github.com/owner/repo.git",
        "ssh://github.com:22/owner/repo",
        "ssh://git@ssh.github.com:443/owner/repo.git",
        "git://github.com/owner/repo.git",
        "https://GITHUB.COM/owner/repo.git",
    }) |origin| {
        try std.testing.expectEqualStrings("owner/repo", try repositoryName(origin));
    }
    try std.testing.expectEqualStrings("Owner-1/repo_name.js", try repositoryName("git@github.com:Owner-1/repo_name.js.git"));
    for ([_][]const u8{
        "",                                     "origin",                                 "/local/repo",                       "file:///local/repo",          "https://gitlab.com/owner/repo",       "git@gitlab.com:owner/repo.git",
        "https://github.com.evil/owner/repo",   "https://github.com@evil.com/owner/repo", "https://github.com:444/owner/repo", "ftp://github.com/owner/repo", "https://github.com/owner",            "https://github.com//repo",
        "https://github.com/owner/",            "https://github.com/owner/repo/extra",    "https://github.com/owner/..",       "https://github.com/./repo",   "https://github.com/owner/repo?query", "https://github.com/owner/repo#fragment",
        "https://github.com/owner/repo\nother", "https://github.com/owner/repo%20name",   "git@github.com:/owner/repo",
    }) |origin| {
        try std.testing.expectError(error.UnsupportedOrigin, repositoryName(origin));
    }
}

test "GitHub CLI reads origin and metadata on each call without changing repository files or refs" {
    var repository = try TestRepository.init(std.testing.allocator);
    defer repository.deinit();
    try repository.write("tracked.txt", "base\n");
    try repository.commit("base");
    try repository.git(&.{ "remote", "add", "origin", "git@github.com:owner/repo.git" });
    try repository.write("tracked.txt", "staged\n");
    try repository.git(&.{ "add", "tracked.txt" });
    try repository.write("tracked.txt", "unstaged\n");
    try repository.write("untracked.txt", "untracked\n");
    try repository.write(".git/FETCH_HEAD", "keep fetch state\n");
    const git = try writeExecutable(&repository, ".git/fake-git",
        \\#!/bin/sh
        \\[ "$#" -eq 7 ] || exit 91
        \\[ "$1" = '--no-pager' ] && [ "$2" = '--no-optional-locks' ] && [ "$3" = '-C' ] || exit 92
        \\[ "$5" = 'remote' ] && [ "$6" = 'get-url' ] && [ "$7" = 'origin' ] || exit 93
        \\exec git "$@"
        \\
    );
    defer std.testing.allocator.free(git);
    const gh = try writeExecutable(&repository, ".git/fake-gh",
        \\#!/bin/sh
        \\printf '%s\n' "$@" >> .git/gh-arguments
        \\cat .git/gh-response
        \\
    );
    defer std.testing.allocator.free(gh);
    var provider: GitHubCliProvider = .{ .allocator = std.testing.allocator, .executable = gh, .git_executable = git };
    const branch = try repository.revision("HEAD");
    defer std.testing.allocator.free(branch);
    const files = [_][]const u8{ ".git/index", ".git/HEAD", ".git/FETCH_HEAD", "tracked.txt", "untracked.txt" };
    var before: [files.len][]const u8 = undefined;
    for (files, &before) |path, *contents| contents.* = try repository.temporary.dir.readFileAlloc(std.testing.io, path, std.testing.allocator, .limited(1024 * 1024));
    defer for (before) |contents| std.testing.allocator.free(contents);

    try repository.write(".git/gh-response", sample_output);
    const first = try provider.interface().listOpenPullRequests(std.testing.io, repository.root);
    defer first.deinit();
    try std.testing.expectEqual(@as(usize, 2), first.pullRequests.len);
    try std.testing.expectEqual(@as(u32, 42), first.pullRequests[0].number);
    try std.testing.expectEqualStrings("Fix \"quoted\" text and 雪", first.pullRequests[0].title);
    try std.testing.expectEqualStrings("test-author", first.pullRequests[0].authorLogin);
    try std.testing.expectEqualStrings("https://github.com/owner/repo/pull/42", first.pullRequests[0].url);
    try std.testing.expect(first.pullRequests[0].isDraft);
    try std.testing.expectEqualStrings("main", first.pullRequests[0].baseRefName);
    try std.testing.expectEqualStrings("feature/雪", first.pullRequests[0].headRefName);
    try std.testing.expectEqual(@as(u32, 7), first.pullRequests[1].number);
    try std.testing.expect(!first.pullRequests[1].isDraft);
    try repository.git(&.{ "remote", "set-url", "origin", "https://github.com/owner/other.git" });
    try repository.write(".git/gh-response", "[]");
    const next = try provider.interface().listOpenPullRequests(std.testing.io, repository.root);
    defer next.deinit();
    try std.testing.expectEqual(@as(usize, 0), next.pullRequests.len);
    // A later request must not invalidate an earlier result.
    try std.testing.expectEqualStrings("feature/雪", first.pullRequests[0].headRefName);
    const arguments = try repository.temporary.dir.readFileAlloc(std.testing.io, ".git/gh-arguments", std.testing.allocator, .limited(4096));
    defer std.testing.allocator.free(arguments);
    try std.testing.expectEqualStrings(
        "pr\nlist\n--repo\ngithub.com/owner/repo\n--state\nopen\n--json\nnumber,title,author,url,isDraft,baseRefName,headRefName\n" ++
            "pr\nlist\n--repo\ngithub.com/owner/other\n--state\nopen\n--json\nnumber,title,author,url,isDraft,baseRefName,headRefName\n",
        arguments,
    );
    const after_branch = try repository.revision("HEAD");
    defer std.testing.allocator.free(after_branch);
    try std.testing.expectEqualStrings(branch, after_branch);
    for (files, before) |path, expected| {
        const actual = try repository.temporary.dir.readFileAlloc(std.testing.io, path, std.testing.allocator, .limited(1024 * 1024));
        defer std.testing.allocator.free(actual);
        try std.testing.expectEqualSlices(u8, expected, actual);
    }
}

test "GitHub CLI defines origin, Git, and executable failures" {
    var repository = try TestRepository.init(std.testing.allocator);
    defer repository.deinit();
    var provider: GitHubCliProvider = .{ .allocator = std.testing.allocator, .executable = "/rvw-missing-gh" };
    try std.testing.expectError(error.MissingOrigin, provider.interface().listOpenPullRequests(std.testing.io, repository.root));
    try repository.git(&.{ "remote", "add", "origin", "https://gitlab.com/owner/repo.git" });
    try std.testing.expectError(error.UnsupportedOrigin, provider.interface().listOpenPullRequests(std.testing.io, repository.root));
    try repository.git(&.{ "remote", "set-url", "origin", "https://github.com/owner/repo.git" });
    try std.testing.expectError(error.PullRequestListUnavailable, provider.interface().listOpenPullRequests(std.testing.io, repository.root));
    provider.executable = "relative-gh";
    try std.testing.expectError(error.PullRequestListUnavailable, provider.interface().listOpenPullRequests(std.testing.io, repository.root));
    try repository.write(".git/not-executable", "not executable\n");
    const not_executable = try std.fs.path.join(std.testing.allocator, &.{ repository.root, ".git/not-executable" });
    defer std.testing.allocator.free(not_executable);
    provider.executable = not_executable;
    try std.testing.expectError(error.PullRequestListUnavailable, provider.interface().listOpenPullRequests(std.testing.io, repository.root));
    provider.git_executable = "/rvw-missing-git";
    try std.testing.expectError(error.RepositoryUnavailable, provider.interface().listOpenPullRequests(std.testing.io, repository.root));
    provider.git_executable = "relative-git";
    try std.testing.expectError(error.RepositoryUnavailable, provider.interface().listOpenPullRequests(std.testing.io, repository.root));
    provider.git_executable = "/usr/bin/false";
    try std.testing.expectError(error.RepositoryFailed, provider.interface().listOpenPullRequests(std.testing.io, repository.root));
    provider.git_executable = null;
    try std.testing.expectError(error.RepositoryFailed, provider.interface().listOpenPullRequests(std.testing.io, "/rvw-missing-repository"));
}

test "GitHub CLI classifies authentication, request, invalid data, and output failures" {
    var repository = try TestRepository.init(std.testing.allocator);
    defer repository.deinit();
    try repository.git(&.{ "remote", "add", "origin", "https://github.com/owner/repo.git" });
    for ([_]struct { script: []const u8, failure: Error }{
        .{ .script = "exit 4\n", .failure = error.PullRequestAuthenticationFailed },
        .{ .script = "echo 'HTTP 401: Bad credentials' >&2\nexit 1\n", .failure = error.PullRequestAuthenticationFailed },
        .{ .script = "echo 'HTTP 403: Resource not accessible' >&2\nexit 1\n", .failure = error.PullRequestListFailed },
        .{ .script = "exit 1\n", .failure = error.PullRequestListFailed },
        .{ .script = "exit 2\n", .failure = error.PullRequestListFailed },
        .{ .script = "kill -KILL $$\n", .failure = error.PullRequestListFailed },
        .{ .script = "printf 'invalid json'\n", .failure = error.InvalidPullRequestList },
        .{ .script = "exit 0\n", .failure = error.InvalidPullRequestList },
        .{ .script = "head -c 16777217 /dev/zero\n", .failure = error.PullRequestListFailed },
        .{ .script = "head -c 4097 /dev/zero >&2\n", .failure = error.PullRequestListFailed },
    }) |case| {
        const script = try std.mem.concat(std.testing.allocator, u8, &.{ "#!/bin/sh\n", case.script });
        defer std.testing.allocator.free(script);
        const gh = try writeExecutable(&repository, ".git/fake-gh", script);
        defer std.testing.allocator.free(gh);
        var provider: GitHubCliProvider = .{ .allocator = std.testing.allocator, .executable = gh };
        try std.testing.expectError(case.failure, provider.interface().listOpenPullRequests(std.testing.io, repository.root));
    }
}

test "pull request parser rejects invalid metadata" {
    for ([_][]const u8{ "", "{}", "null", "[null]", "[{}]", "[", "[\xff]" }) |input| {
        var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
        defer arena.deinit();
        try std.testing.expectError(error.InvalidPullRequestList, parsePullRequests(arena.allocator(), input));
    }
    const valid = try std.json.parseFromSlice(std.json.Value, std.testing.allocator, sample_request, .{});
    defer valid.deinit();
    const fields = [_][]const u8{ "number", "title", "author", "url", "isDraft", "baseRefName", "headRefName" };
    for (fields) |field| {
        const original = valid.value.object.get(field).?;
        for ([_]std.json.Value{ .null, .{ .integer = -1 }, .{ .string = "" } }) |invalid| {
            var object = valid.value;
            try object.object.put(std.testing.allocator, field, invalid);
            defer object.object.put(std.testing.allocator, field, original) catch unreachable;
            const input = try std.json.Stringify.valueAlloc(std.testing.allocator, &.{object}, .{});
            defer std.testing.allocator.free(input);
            var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
            defer arena.deinit();
            try std.testing.expectError(error.InvalidPullRequestList, parsePullRequests(arena.allocator(), input));
        }
        const missing = try std.json.parseFromSlice(std.json.Value, std.testing.allocator, sample_request, .{});
        defer missing.deinit();
        var object = missing.value;
        try std.testing.expect(object.object.swapRemove(field));
        const input = try std.json.Stringify.valueAlloc(std.testing.allocator, &.{object}, .{});
        defer std.testing.allocator.free(input);
        var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
        defer arena.deinit();
        try std.testing.expectError(error.InvalidPullRequestList, parsePullRequests(arena.allocator(), input));
    }
    for ([_][]const u8{ "-1", "4294967296", "1.5" }) |number| {
        const replacement = try std.fmt.allocPrint(std.testing.allocator, "\"number\":{s}", .{number});
        defer std.testing.allocator.free(replacement);
        const input = try std.mem.replaceOwned(u8, std.testing.allocator, "[" ++ sample_request ++ "]", "\"number\":42", replacement);
        defer std.testing.allocator.free(input);
        var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
        defer arena.deinit();
        try std.testing.expectError(error.InvalidPullRequestList, parsePullRequests(arena.allocator(), input));
    }
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    for ([_][]const u8{ "{}", "{\"login\":null}", "{\"login\":1}" }) |author| {
        const input = try std.mem.replaceOwned(u8, std.testing.allocator, "[" ++ sample_request ++ "]", "{\"login\":\"test-author\",\"is_bot\":false}", author);
        defer std.testing.allocator.free(input);
        try std.testing.expectError(error.InvalidPullRequestList, parsePullRequests(arena.allocator(), input));
    }
}

test "pull request parser accepts the list length from gh without a separate number policy" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const output = "[" ++ (sample_request ++ ",") ** 30 ++ sample_request ++ "]";
    try std.testing.expectEqual(@as(usize, 31), (try parsePullRequests(arena.allocator(), output)).len);
    const zero = try std.mem.replaceOwned(u8, arena.allocator(), "[" ++ sample_request ++ "]", "\"number\":42", "\"number\":0");
    try std.testing.expectEqual(@as(u32, 0), (try parsePullRequests(arena.allocator(), zero))[0].number);
}

test "GitHub CLI releases result memory on allocation failures" {
    var repository = try TestRepository.init(std.testing.allocator);
    defer repository.deinit();
    try repository.git(&.{ "remote", "add", "origin", "https://github.com/owner/repo.git" });
    try repository.write(".git/gh-response", sample_output);
    const gh = try writeExecutable(&repository, ".git/fake-gh", "#!/bin/sh\ncat .git/gh-response\n");
    defer std.testing.allocator.free(gh);
    const Test = struct {
        fn run(allocator: std.mem.Allocator, directory: []const u8, executable: []const u8) !void {
            var provider: GitHubCliProvider = .{ .allocator = allocator, .executable = executable };
            const result = try provider.interface().listOpenPullRequests(std.testing.io, directory);
            defer result.deinit();
            const encoded = try std.json.Stringify.valueAlloc(allocator, result, .{});
            defer allocator.free(encoded);
        }
    };
    try std.testing.checkAllAllocationFailures(std.testing.allocator, Test.run, .{ repository.root, gh });
}
