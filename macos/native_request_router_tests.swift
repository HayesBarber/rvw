func testNativeRequestRouter() {
    var terminationRequests = 0
    var coreRequests: [String] = []
    let host = NativeHost {
        terminationRequests += 1
    }
    let router = NativeRequestRouter(nativeHost: host) { messageBody in
        let request = messageBody as? [String: Any]
        coreRequests.append(request?["type"] as? String ?? "invalid")
        return ["source": "core"]
    }

    let close = try? router.handle(["type": "application_close"]) as? [String: Any]
    expect(close?["closing"] as? Bool == true, "native requests should be handled by the host")
    expect(terminationRequests == 1, "native requests should retain their host side effect")
    expect(coreRequests.isEmpty, "native requests should not reach the core")

    let core = try? router.handle(["type": "get_configuration"]) as? [String: Any]
    expect(core?["source"] as? String == "core", "core requests should return the core response")
    expect(coreRequests == ["get_configuration"], "unhandled requests should reach the core once")

    enum ExpectedFailure: Error { case requestFailed }
    let failingRouter = NativeRequestRouter(nativeHost: host) { _ in
        throw ExpectedFailure.requestFailed
    }
    do {
        _ = try failingRouter.handle(["type": "get_diff_overview"])
        fatalError("core failures should cross the native request boundary")
    } catch ExpectedFailure.requestFailed {
        // Expected: NativeBridge translates this error for its WebKit reply handler.
    } catch {
        fatalError("the native request router should preserve the core error")
    }
}
