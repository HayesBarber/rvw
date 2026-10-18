import Foundation

enum BundledAssets {
    static let scheme = "app"
    static let host = "bundle"

    static func fileURL(forPath path: String, under root: URL) -> URL? {
        let relativePath = path == "/" ? "index.html" : String(path.drop(while: { $0 == "/" }))
        guard !relativePath.isEmpty else { return nil }

        let standardizedRoot = root.standardizedFileURL.resolvingSymlinksInPath()
        let fileURL = standardizedRoot
            .appendingPathComponent(relativePath)
            .standardizedFileURL
            .resolvingSymlinksInPath()
        guard fileURL.path.hasPrefix(standardizedRoot.path + "/") else { return nil }
        return fileURL
    }

    static func mimeType(forExtension extensionName: String) -> String {
        switch extensionName.lowercased() {
        case "html": "text/html"
        case "css": "text/css"
        case "js": "text/javascript"
        case "json": "application/json"
        case "svg": "image/svg+xml"
        case "png": "image/png"
        case "woff2": "font/woff2"
        default: "application/octet-stream"
        }
    }

    static func load(path: String, under root: URL) throws -> (url: URL, mimeType: String, data: Data) {
        guard let url = fileURL(forPath: path, under: root) else {
            throw URLError(.noPermissionsToReadFile)
        }
        return (
            url,
            mimeType(forExtension: url.pathExtension),
            try Data(contentsOf: url)
        )
    }
}
