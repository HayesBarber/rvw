import Foundation

func testBundledAssets() {
    let root = URL(fileURLWithPath: "/tmp/rvw-assets", isDirectory: true)
    expect(
        BundledAssets.fileURL(forPath: "/", under: root)?.path == "/tmp/rvw-assets/index.html",
        "the asset root should resolve to index.html"
    )
    expect(
        BundledAssets.fileURL(forPath: "/styles/app.css", under: root)?.path
            == "/tmp/rvw-assets/styles/app.css",
        "nested bundled assets should resolve under the asset root"
    )
    expect(
        BundledAssets.fileURL(forPath: "/../secret.txt", under: root) == nil,
        "asset paths should not escape the asset root"
    )
    expect(
        BundledAssets.mimeType(forExtension: "JS") == "text/javascript",
        "MIME type resolution should be case insensitive"
    )
    expect(
        BundledAssets.mimeType(forExtension: "unknown") == "application/octet-stream",
        "unknown assets should use the binary MIME type"
    )
}
