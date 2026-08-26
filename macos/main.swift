import AppKit
import Foundation
import RvwCore
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    private var window: NSWindow?
    private var core: OpaquePointer?
    private var bridge: NativeBridge?
    private var assets: AssetHandler?

    func applicationDidFinishLaunching(_ notification: Notification) {
        guard let core = rvw_core_create() else { fatalError("Unable to start rvw") }
        guard let resources = Bundle.main.resourceURL?.appendingPathComponent("web") else {
            fatalError("Unable to find the frontend")
        }

        let bridge = NativeBridge(core: core)
        let assets = AssetHandler(root: resources)
        let controller = WKUserContentController()
        controller.addScriptMessageHandler(bridge, contentWorld: .page, name: "native")

        let configuration = WKWebViewConfiguration()
        configuration.userContentController = controller
        configuration.setURLSchemeHandler(assets, forURLScheme: "app")

        let webView = WKWebView(frame: .zero, configuration: configuration)
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1200, height: 800),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "rvw"
        window.contentView = webView
        window.delegate = self
        window.center()
        window.makeKeyAndOrderFront(nil)

        self.core = core
        self.bridge = bridge
        self.assets = assets
        self.window = window

        webView.load(URLRequest(url: URL(string: "app://bundle/index.html")!))
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationWillTerminate(_ notification: Notification) {
        rvw_core_destroy(core)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }
}

final class NativeBridge: NSObject, WKScriptMessageHandlerWithReply {
    private let core: OpaquePointer

    init(core: OpaquePointer) {
        self.core = core
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @escaping (Any?, String?) -> Void
    ) {
        do {
            let request = try JSONSerialization.data(withJSONObject: message.body)
            let response = request.withUnsafeBytes { bytes in
                rvw_core_dispatch(core, bytes.bindMemory(to: UInt8.self).baseAddress, bytes.count)
            }
            guard let pointer = response.ptr, response.len > 0 else {
                replyHandler(nil, "rvw returned an empty response")
                return
            }
            defer { rvw_buffer_free(core, response) }

            guard let envelope = try JSONSerialization.jsonObject(
                with: Data(bytes: pointer, count: response.len)
            ) as? [String: Any] else {
                replyHandler(nil, "rvw returned an invalid response")
                return
            }
            if envelope["ok"] as? Bool == true {
                replyHandler(envelope["data"], nil)
            } else {
                let error = envelope["error"] as? [String: Any]
                replyHandler(nil, error?["message"] as? String ?? "rvw request failed")
            }
        } catch {
            replyHandler(nil, error.localizedDescription)
        }
    }
}

final class AssetHandler: NSObject, WKURLSchemeHandler {
    private let root: URL

    init(root: URL) {
        self.root = root.standardizedFileURL
    }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let requestURL = task.request.url,
              requestURL.scheme == "app",
              requestURL.host == "bundle"
        else { return task.didFailWithError(URLError(.badURL)) }

        let path = requestURL.path == "/" ? "/index.html" : requestURL.path
        let fileURL = root.appendingPathComponent(String(path.dropFirst())).standardizedFileURL
        guard fileURL.path.hasPrefix(root.path + "/") else {
            return task.didFailWithError(URLError(.noPermissionsToReadFile))
        }

        do {
            let data = try Data(contentsOf: fileURL)
            let response = URLResponse(
                url: requestURL,
                mimeType: mimeType(fileURL.pathExtension),
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

    private func mimeType(_ extensionName: String) -> String {
        switch extensionName {
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
}

let application = NSApplication.shared
let delegate = AppDelegate()

application.setActivationPolicy(.regular)
application.delegate = delegate
application.run()
