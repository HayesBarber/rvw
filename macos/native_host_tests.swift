func testNativeHost() {
    expect(
        nativeHostAction(for: ["type": "application_close"]) == .closeApplication,
        "application close request should be recognized"
    )
    expect(
        nativeHostAction(for: ["type": "get_configuration"]) == nil,
        "core requests should remain unhandled by the native host"
    )
    expect(
        nativeHostAction(for: ["type": "application_close", "extra": true]) == nil,
        "application close request should reject unsupported fields"
    )

    var terminationRequests = 0
    let host = NativeHost {
        terminationRequests += 1
    }
    let response = host.handle(["type": "application_close"])

    expect(terminationRequests == 1, "application close should request termination once")
    expect(response?["closing"] as? Bool == true, "application close should acknowledge the request")
    expect(host.handle(["type": "get_configuration"]) == nil, "unknown requests should fall through")
    expect(terminationRequests == 1, "unknown requests should not request termination")
}

@main
struct NativeHostTests {
    static func main() {
        testLaunchConfiguration()
        testBundledAssets()
        testNavigationPolicy()
        testNativeHost()
    }
}
