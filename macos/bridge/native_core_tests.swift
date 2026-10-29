import Foundation

private enum NativeCoreTestError: Error {
    case gitFailed
    case requestTimedOut
    case invalidResponse
}

private func git(_ directory: URL, _ arguments: [String]) throws {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/git")
    process.arguments = ["-C", directory.path, "-c", "core.hooksPath=/dev/null"] + arguments
    try process.run()
    process.waitUntilExit()
    guard process.terminationStatus == 0 else { throw NativeCoreTestError.gitFailed }
}

private func response(_ router: NativeRequestRouter, _ body: [String: Any]) throws -> [String: Any] {
    let finished = DispatchSemaphore(value: 0)
    var result: Result<Any?, Error>?
    router.handle(body) { value in
        result = value
        finished.signal()
    }
    guard finished.wait(timeout: .now() + 5) == .success else {
        throw NativeCoreTestError.requestTimedOut
    }
    guard let data = try result?.get() as? [String: Any] else {
        throw NativeCoreTestError.invalidResponse
    }
    return data
}

private func routerBlockingTermination(_ core: NativeCore) -> NativeRequestRouter {
    NativeRequestRouter(nativeHost: NativeHost {}) { body in
        // Make the regression deterministic even if a future libdispatch
        // version changes the signal mask on its worker threads.
        var blocked = sigset_t()
        sigemptyset(&blocked)
        sigaddset(&blocked, SIGTERM)
        var previous = sigset_t()
        expect(pthread_sigmask(SIG_BLOCK, &blocked, &previous) == 0, "block SIGTERM for the search child")
        defer { pthread_sigmask(SIG_SETMASK, &previous, nil) }
        return try core.dispatch(body)
    }
}

private func testNativeTextSearch() throws {
    try withTemporaryDirectory { directory in
        try git(directory, ["init", "--quiet"])
        try "ignored.txt\n".write(to: directory.appendingPathComponent(".gitignore"), atomically: true, encoding: .utf8)
        try "needle\n".write(to: directory.appendingPathComponent("tracked.txt"), atomically: true, encoding: .utf8)
        try git(directory, ["add", "."])
        try git(directory, ["-c", "user.name=rvw tests", "-c", "user.email=rvw-tests@example.invalid",
                            "-c", "commit.gpgSign=false", "commit", "--quiet", "-m", "search fixture"])
        // The JSON output exceeds the provider's 4 MiB limit while rg is still
        // writing. A small fixture can exit before the provider must stop it.
        try String(repeating: "needle\n", count: 100_000).write(
            to: directory.appendingPathComponent("ignored.txt"), atomically: true, encoding: .utf8
        )

        let core = try NativeCore(launchConfiguration: LaunchConfiguration(directory: directory, range: nil))
        let router = routerBlockingTermination(core)

        for _ in 0..<2 {
            let visible = try response(router, ["type": "search_text", "mode": "ignore-aware", "query": "needle"])
            let visibleMatches = visible["matches"] as? [[String: Any]]
            expect(visibleMatches?.count == 1, "ignore-aware search should exclude the large ignored file")
            expect(visibleMatches?.first?["path"] as? String == "tracked.txt", "search should find the tracked file")
            expect(visible["truncated"] as? Bool == false, "small search should finish normally")

            let all = try response(router, ["type": "search_text", "mode": "all-files", "query": "needle"])
            let matches = all["matches"] as? [[String: Any]]
            expect(matches?.count == 1000, "large native search should return the match limit")
            expect(all["truncated"] as? Bool == true, "large native search should report truncation")
            expect(matches?.contains { $0["path"] as? String == "ignored.txt" } == true,
                   "all-files search should include the ignored file")
            expect(matches?.allSatisfy { $0["lineText"] as? String == "needle" } == true,
                   "truncated output should contain complete matches")

            _ = try response(router, ["type": "get_configuration"])
            let empty = try response(router, ["type": "search_text", "mode": "all-files", "query": "absent"])
            expect((empty["matches"] as? [Any])?.isEmpty == true, "later searches should still complete")
            expect(empty["truncated"] as? Bool == false, "no-match search should finish normally")
        }

        try testNativeSearchFailure(directory)
    }
}

private func testNativeSearchFailure(_ directory: URL) throws {
    let executable = directory.appendingPathComponent("noisy-rg")
    try "#!/bin/sh\necho $$ > child.pid\nexec /usr/bin/yes search-error >&2\n".write(
        to: executable, atomically: true, encoding: .utf8
    )
    try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: executable.path)
    let previous = getenv("RVW_RIPGREP").map { String(cString: $0) }
    setenv("RVW_RIPGREP", executable.path, 1)
    defer {
        if let previous { setenv("RVW_RIPGREP", previous, 1) } else { unsetenv("RVW_RIPGREP") }
    }

    let core = try NativeCore(launchConfiguration: LaunchConfiguration(directory: directory, range: nil))
    let router = routerBlockingTermination(core)
    for _ in 0..<2 {
        do {
            _ = try response(router, ["type": "search_text", "mode": "all-files", "query": "needle"])
            fatalError("excessive stderr should fail the search")
        } catch {
            expect(error.localizedDescription == "Search failed; check directory access and try again",
                   "search failure should reach Swift without a timeout")
        }
        let pidText = try String(contentsOf: directory.appendingPathComponent("child.pid"), encoding: .utf8)
        guard let pid = Int32(pidText.trimmingCharacters(in: .whitespacesAndNewlines)) else {
            throw NativeCoreTestError.invalidResponse
        }
        var status: Int32 = 0
        expect(waitpid(pid, &status, WNOHANG) == -1 && errno == ECHILD, "search cleanup must reap its child")
        _ = try response(router, ["type": "get_configuration"])
    }
}

private func commitRepository(_ directory: URL, _ message: String) throws {
    try git(directory, ["add", "."])
    try git(directory, ["-c", "user.name=rvw tests", "-c", "user.email=rvw-tests@example.invalid",
                        "-c", "commit.gpgSign=false", "commit", "--quiet", "--allow-empty", "-m", message])
}

private func withNativeRepository(range: String? = nil,
                                  _ body: (URL, NativeCore, NativeRequestRouter) throws -> Void) throws {
    try withTemporaryDirectory { directory in
        try git(directory, ["init", "--quiet"])
        try "base\n".write(to: directory.appendingPathComponent("tracked.txt"), atomically: true, encoding: .utf8)
        try commitRepository(directory, "first")
        let core = try NativeCore(launchConfiguration: LaunchConfiguration(directory: directory, range: range))
        try body(directory, core, routerBlockingTermination(core))
    }
}

private func expectNativeError(_ router: NativeRequestRouter, _ operation: String, _ message: String) throws {
    do {
        _ = try response(router, ["type": operation])
        fatalError("\(operation) should fail")
    } catch {
        expect(error.localizedDescription == message, "\(operation) should return its error through the native queue")
    }
    _ = try response(router, ["type": "get_configuration"])
}

private func testNativeReviewComments() throws {
    try withNativeRepository { directory, core, router in
        let overview = try response(router, ["type": "get_diff_overview"])
        expect((overview["files"] as? [Any])?.isEmpty == true, "review should have no changed files")
        let first = try response(router, ["type": "create_comment", "body": "Summary", "commentType": "QUESTION",
                                          "target": ["kind": "review"]])
        let second = try response(router, ["type": "create_comment", "body": "Design", "target": ["kind": "review"]])
        guard let firstID = first["id"] as? String, let secondID = second["id"] as? String else {
            throw NativeCoreTestError.invalidResponse
        }
        expect(firstID != secondID, "review comments should have distinct IDs")
        let target = first["target"] as? [String: String]
        expect(target == ["kind": "review"], "review target should contain no location")
        expect(first["commentType"] as? String == "QUESTION", "review should retain its type")
        let edited = try response(router, ["type": "edit_comment", "commentId": firstID, "body": "Revised"])
        expect(edited["id"] as? String == firstID, "editing should preserve the ID")
        expect(edited["target"] as? [String: String] == target, "editing should preserve the review target")
        _ = try response(router, ["type": "reload_review"])
        let saved = try core.dispatch(["type": "get_comments"]) as? [[String: Any]]
        expect(saved?.count == 2, "reload should preserve both review comments")
        expect(saved?.first?["body"] as? String == "Revised", "reload should preserve edited text")
        _ = try response(router, ["type": "delete_comment", "commentId": firstID])
        let remaining = try core.dispatch(["type": "get_comments"]) as? [[String: Any]]
        expect(remaining?.count == 1 && remaining?.first?["id"] as? String == secondID,
               "deleting should affect only the selected comment")
        let cleared = try response(router, ["type": "clear_comments"])
        expect(cleared["commentCount"] as? Int == 1, "clear should report the review comment count")
        let empty = try core.dispatch(["type": "get_comments"]) as? [Any]
        expect(empty?.isEmpty == true,
               "clear should remove review comments")
        _ = try response(router, ["type": "create_comment", "body": "Session only", "target": ["kind": "review"]])
        let nextSession = try NativeCore(launchConfiguration: LaunchConfiguration(directory: directory, range: nil))
        let fresh = try nextSession.dispatch(["type": "get_comments"]) as? [Any]
        expect(fresh?.isEmpty == true,
               "a new session should start without saved comments")
    }
}

private func testNativeRepositoryLists() throws {
    try withNativeRepository(range: "HEAD..HEAD") { directory, _, router in
        let tracked = directory.appendingPathComponent("tracked.txt")
        let before = try response(router, ["type": "get_diff_overview"])
        let first = try response(router, ["type": "list_commits"])
        let initial = first["commits"] as? [[String: Any]]
        expect(initial?.count == 1, "native history should include HEAD")
        expect(initial?.first?["subject"] as? String == "first", "native history should return the subject")
        expect(initial?.first?["authorName"] as? String == "rvw tests", "native history should return the author")
        expect((initial?.first?["sha"] as? String)?.count == 40, "native history should return the full SHA")
        expect(initial?.first?["commitDate"] is String, "native history should return the commit date")
        let clean = try response(router, ["type": "list_working_tree_changes"])
        expect((clean["files"] as? [Any])?.isEmpty == true, "a clean worktree should return no summaries")

        try "staged\n".write(to: tracked, atomically: true, encoding: .utf8)
        try git(directory, ["add", "tracked.txt"])
        try "unstaged\nextra\n".write(to: tracked, atomically: true, encoding: .utf8)
        try "new\n".write(to: directory.appendingPathComponent("雪.txt"), atomically: true, encoding: .utf8)
        let changed = try response(router, ["type": "list_working_tree_changes"])
        let files = changed["files"] as? [[String: Any]]
        expect(files?.count == 2, "native listing should return current tracked and untracked files")
        expect(files?.first?["path"] as? String == "tracked.txt", "summaries should follow path order")
        expect(files?.first?["status"] as? String == "modified", "tracked changes should be modified")
        expect(files?.first?["additions"] as? Int == 2 && files?.first?["deletions"] as? Int == 1,
               "counts should combine staged and unstaged changes against HEAD")
        expect(files?.last?["path"] as? String == "雪.txt", "paths should retain Unicode text")

        try git(directory, ["checkout", "--quiet", "--detach"])
        try commitRepository(directory, "second\nnext line")
        let next = try response(router, ["type": "list_commits"])
        let current = next["commits"] as? [[String: Any]]
        expect(current?.count == 2, "later native requests should read the current detached HEAD")
        expect(current?.first?["subject"] as? String == "second", "subjects should contain only the first message line")
        expect(current?.last?["sha"] as? String == initial?.first?["sha"] as? String,
               "native history should retain reachable parents")
        let updated = try response(router, ["type": "list_working_tree_changes"])
        expect((updated["files"] as? [Any])?.isEmpty == true, "later requests should read the new HEAD")
        let after = try response(router, ["type": "get_diff_overview"])
        expect(NSDictionary(dictionary: before).isEqual(to: after), "listing should preserve the active commit-range review")

        try git(directory, ["symbolic-ref", "HEAD", "refs/heads/unborn"])
        let empty = try response(router, ["type": "list_commits"])
        expect((empty["commits"] as? [Any])?.isEmpty == true, "an unborn branch should return an empty list")
        try expectNativeError(router, "list_working_tree_changes", "Revision does not identify a commit")
        try "invalid HEAD\n".write(to: directory.appendingPathComponent(".git/HEAD"), atomically: true, encoding: .utf8)
        try expectNativeError(router, "list_commits", "Unable to read repository history")
    }
}

private func testNativePullRequests() throws {
    try withTemporaryDirectory { directory in
        try git(directory, ["init", "--quiet"])
        try git(directory, ["-c", "user.name=rvw tests", "-c", "user.email=rvw-tests@example.invalid",
                            "-c", "commit.gpgSign=false", "commit", "--quiet", "--allow-empty", "-m", "PR fixture"])
        let bin = directory.appendingPathComponent(".git/test-bin")
        try FileManager.default.createDirectory(at: bin, withIntermediateDirectories: true)
        try FileManager.default.createSymbolicLink(atPath: bin.appendingPathComponent("git").path,
                                                  withDestinationPath: "/usr/bin/git")
        let gh = bin.appendingPathComponent("gh")
        let output = directory.appendingPathComponent(".git/gh-response")
        try "#!/bin/sh\n/bin/cat .git/gh-response\n".write(to: gh, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: gh.path)
        let previousPath = getenv("PATH").map { String(cString: $0) }
        setenv("PATH", bin.path, 1)
        defer {
            if let previousPath { setenv("PATH", previousPath, 1) } else { unsetenv("PATH") }
        }
        let core = try NativeCore(launchConfiguration: LaunchConfiguration(directory: directory, range: nil))
        let router = routerBlockingTermination(core)
        try expectNativeError(router, "list_open_pull_requests", "Pull request listing requires an origin remote")
        try git(directory, ["remote", "add", "origin", "https://github.com/owner/repo.git"])
        try #"[{"number":42,"title":"Draft 雪","author":{"login":"author"},"url":"https://github.com/owner/repo/pull/42","isDraft":true,"baseRefName":"main","headRefName":"feature"}]"#
            .write(to: output, atomically: true, encoding: .utf8)
        let first = try response(router, ["type": "list_open_pull_requests"])
        let requests = first["pullRequests"] as? [[String: Any]]
        expect(requests?.count == 1, "native listing should return open pull requests")
        expect(requests?.first?["number"] as? Int == 42, "native listing should return the PR number")
        expect(requests?.first?["title"] as? String == "Draft 雪", "native listing should preserve Unicode titles")
        expect(requests?.first?["authorLogin"] as? String == "author", "native listing should return the author login")
        expect(requests?.first?["url"] as? String == "https://github.com/owner/repo/pull/42", "native listing should return the URL")
        expect(requests?.first?["isDraft"] as? Bool == true, "native listing should include drafts")
        expect(requests?.first?["baseRefName"] as? String == "main", "native listing should return the base branch")
        expect(requests?.first?["headRefName"] as? String == "feature", "native listing should return the head branch")
        try "[]".write(to: output, atomically: true, encoding: .utf8)
        let empty = try response(router, ["type": "list_open_pull_requests"])
        expect((empty["pullRequests"] as? [Any])?.isEmpty == true, "later native requests should read the current list")
        for (script, message) in [
            ("#!/bin/sh\nexit 4\n", "GitHub authentication failed; sign in with gh auth login"),
            ("#!/bin/sh\nexit 1\n", "Unable to list open pull requests"),
            ("#!/bin/sh\nprintf 'invalid json'\n", "Pull request list data is invalid"),
        ] {
            try script.write(to: gh, atomically: true, encoding: .utf8)
            try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: gh.path)
            try expectNativeError(router, "list_open_pull_requests", message)
        }
        try FileManager.default.removeItem(at: gh)
        try expectNativeError(router, "list_open_pull_requests", "GitHub CLI is unavailable")
    }
}

@main
struct NativeCoreTests {
    static func main() {
        do {
            try testNativeTextSearch()
            try testNativeReviewComments()
            try testNativeRepositoryLists()
            try testNativePullRequests()
            print("Native core tests passed")
        } catch {
            FileHandle.standardError.write(Data("Native core test failed: \(error)\n".utf8))
            exit(1)
        }
    }
}
