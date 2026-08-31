import Foundation

func testBundledAssets() {
    try! withTemporaryDirectory { temporary in
        let root = temporary.appendingPathComponent("web", isDirectory: true)
        let styles = root.appendingPathComponent("styles", isDirectory: true)
        try FileManager.default.createDirectory(at: styles, withIntermediateDirectories: true)
        try Data("app".utf8).write(to: root.appendingPathComponent("index.html"))
        try Data("body {}".utf8).write(to: styles.appendingPathComponent("app.css"))
        try Data("secret".utf8).write(to: temporary.appendingPathComponent("secret.txt"))
        try FileManager.default.createSymbolicLink(
            at: root.appendingPathComponent("escaped.txt"),
            withDestinationURL: temporary.appendingPathComponent("secret.txt")
        )

        let index = try BundledAssets.load(path: "/", under: root)
        expect(index.url.lastPathComponent == "index.html", "the asset root should load index.html")
        expect(index.mimeType == "text/html", "the asset root should use its HTML MIME type")
        expect(index.data == Data("app".utf8), "the asset root should load the bundled bytes")

        let stylesheet = try BundledAssets.load(path: "/styles/app.css", under: root)
        expect(stylesheet.mimeType == "text/css", "nested assets should use their MIME type")
        expect(stylesheet.data == Data("body {}".utf8), "nested bundled assets should load")
        expect(
            BundledAssets.fileURL(forPath: "/../secret.txt", under: root) == nil,
            "asset paths should not escape the asset root"
        )
        expect(
            BundledAssets.fileURL(forPath: "/escaped.txt", under: root) == nil,
            "asset symlinks should not escape the asset root"
        )
    }
    expect(
        BundledAssets.mimeType(forExtension: "JS") == "text/javascript",
        "MIME type resolution should be case insensitive"
    )
    expect(
        BundledAssets.mimeType(forExtension: "unknown") == "application/octet-stream",
        "unknown assets should use the binary MIME type"
    )
}
