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
        do {
            let asset = try BundledAssets.load(path: requestURL.path, under: root)
            let response = URLResponse(
                url: requestURL,
                mimeType: asset.mimeType,
                expectedContentLength: asset.data.count,
                textEncodingName: nil
            )
            task.didReceive(response)
            task.didReceive(asset.data)
            task.didFinish()
        } catch {
            task.didFailWithError(error)
        }
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}
