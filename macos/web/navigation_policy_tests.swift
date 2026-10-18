import Foundation

func testNavigationPolicy() {
    expect(
        NavigationPolicy.destination(for: URL(string: "app://bundle/index.html")) == .bundledAsset,
        "bundled navigation should be allowed"
    )
    let externalURL = URL(string: "https://example.com/review")!
    expect(
        NavigationPolicy.destination(for: externalURL) == .external(externalURL),
        "HTTP(S) navigation should be opened externally"
    )
    expect(
        NavigationPolicy.destination(for: URL(string: "file:///tmp/review")) == .rejected,
        "unsupported navigation should be rejected"
    )
    expect(
        NavigationPolicy.destination(for: URL(string: "app://other/index.html")) == .rejected,
        "non-bundle app navigation should be rejected"
    )
}
