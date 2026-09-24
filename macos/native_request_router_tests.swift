import Foundation

func testNativeRequestRouter() {
    func response(_ router: NativeRequestRouter, _ body: Any) throws -> Any? {
        let finished = DispatchSemaphore(value: 0)
        var result: Result<Any?, Error>?
        router.handle(body) { value in
            result = value
            finished.signal()
        }
        expect(finished.wait(timeout: .now() + 5) == .success, "request should complete")
        return try result!.get()
    }

    var terminationRequests = 0
    var coreRequests: [String] = []
    let host = NativeHost {
        terminationRequests += 1
    }
    let router = NativeRequestRouter(nativeHost: host) { messageBody in
        expect(!Thread.isMainThread, "core requests must not block the UI thread")
        let request = messageBody as? [String: Any]
        coreRequests.append(request?["type"] as? String ?? "invalid")
        return ["source": "core"]
    }

    let close = try? response(router, ["type": "application_close"]) as? [String: Any]
    expect(close?["closing"] as? Bool == true, "native requests should be handled by the host")
    expect(terminationRequests == 1, "native requests should retain their host side effect")
    expect(coreRequests.isEmpty, "native requests should not reach the core")

    let core = try? response(router, ["type": "get_configuration"]) as? [String: Any]
    expect(core?["source"] as? String == "core", "core requests should return the core response")
    expect(coreRequests == ["get_configuration"], "unhandled requests should reach the core once")

    let started = DispatchSemaphore(value: 0)
    let release = DispatchSemaphore(value: 0)
    let completed = DispatchSemaphore(value: 0)
    var order: [Int] = []
    let queuedRouter = NativeRequestRouter(nativeHost: host) { body in
        let index = body as! Int
        if index == 1 {
            started.signal()
            expect(release.wait(timeout: .now() + 5) == .success, "test should release the first request")
        }
        order.append(index)
        return index
    }
    queuedRouter.handle(1) { _ in completed.signal() }
    expect(started.wait(timeout: .now() + 5) == .success, "core work should start asynchronously")
    queuedRouter.handle(2) { _ in completed.signal() }
    queuedRouter.handle(["type": "application_close"]) { result in
        expect((try? result.get() as? [String: Any])?["closing"] as? Bool == true,
               "host actions must remain available while core work is blocked")
    }
    release.signal()
    for _ in 0..<2 {
        expect(completed.wait(timeout: .now() + 5) == .success, "queued work should finish")
    }
    expect(order == [1, 2], "core requests must stay serial")

    enum ExpectedFailure: Error { case requestFailed }
    let failingRouter = NativeRequestRouter(nativeHost: host) { _ in
        throw ExpectedFailure.requestFailed
    }
    do {
        _ = try response(failingRouter, ["type": "get_diff_overview"])
        fatalError("core failures should cross the native request boundary")
    } catch ExpectedFailure.requestFailed {
        // Expected: NativeBridge translates this error for its WebKit reply handler.
    } catch {
        fatalError("the native request router should preserve the core error")
    }
}
