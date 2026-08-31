import Foundation
import WebKit

final class AssetHandler: NSObject, WKURLSchemeHandler {
    private let root: URL

    init(root: URL) {
        self.root = root
    }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let requestURL = task.request.url,
              requestURL.scheme == BundledAssets.scheme,
              requestURL.host == BundledAssets.host
        else {
            task.didFailWithError(URLError(.badURL))
            return
        }
        guard let fileURL = BundledAssets.fileURL(forPath: requestURL.path, under: root) else {
            task.didFailWithError(URLError(.noPermissionsToReadFile))
            return
        }

        do {
            let data = try Data(contentsOf: fileURL)
            let response = URLResponse(
                url: requestURL,
                mimeType: BundledAssets.mimeType(forExtension: fileURL.pathExtension),
                expectedContentLength: data.count,
                textEncodingName: nil
            )
            task.didReceive(response)
            task.didReceive(data)
            task.didFinish()
        } catch {
            task.didFailWithError(error)
        }
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}
