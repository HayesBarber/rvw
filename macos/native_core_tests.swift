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

@main
struct NativeCoreTests {
    static func main() {
        do {
            try testNativeTextSearch()
            print("Native core tests passed")
        } catch {
            FileHandle.standardError.write(Data("Native core test failed: \(error)\n".utf8))
            exit(1)
        }
    }
}
