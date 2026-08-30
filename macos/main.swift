import AppKit
import Darwin
import Foundation
import RvwCore
import WebKit

private let launchMarker = "--rvw-cli-launch"

private func installMainMenu(on application: NSApplication) {
    let mainMenu = NSMenu()

    let applicationMenuItem = NSMenuItem()
    let applicationMenu = NSMenu(title: "Application")
    applicationMenu.addItem(
        withTitle: "Quit rvw",
        action: #selector(NSApplication.terminate(_:)),
        keyEquivalent: "q"
    )
    applicationMenuItem.submenu = applicationMenu
    mainMenu.addItem(applicationMenuItem)

    let editMenuItem = NSMenuItem()
    let editMenu = NSMenu(title: "Edit")
    editMenu.addItem(
        withTitle: "Undo",
        action: #selector(UndoManager.undo),
        keyEquivalent: "z"
    )
    let redo = editMenu.addItem(
        withTitle: "Redo",
        action: #selector(UndoManager.redo),
        keyEquivalent: "z"
    )
    redo.keyEquivalentModifierMask = [.command, .shift]
    editMenu.addItem(.separator())
    editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
    editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
    editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
    editMenu.addItem(.separator())
    editMenu.addItem(
        withTitle: "Select All",
        action: #selector(NSText.selectAll(_:)),
        keyEquivalent: "a"
    )
    editMenuItem.submenu = editMenu
    mainMenu.addItem(editMenuItem)

    application.mainMenu = mainMenu
}

struct LaunchConfiguration {
    let directory: URL
    let range: String?

    init?(arguments: [String]) {
        guard let markerIndex = arguments.firstIndex(of: launchMarker) else { return nil }
        var index = arguments.index(after: markerIndex)

        guard index < arguments.endIndex, arguments[index] == "--directory" else { return nil }
        index = arguments.index(after: index)
        guard index < arguments.endIndex, !arguments[index].isEmpty else { return nil }
        directory = URL(fileURLWithPath: arguments[index], isDirectory: true)
        index = arguments.index(after: index)

        if index < arguments.endIndex {
            guard arguments[index] == "--range" else { return nil }
            index = arguments.index(after: index)
            guard index < arguments.endIndex, !arguments[index].isEmpty else { return nil }
            range = arguments[index]
            index = arguments.index(after: index)
        } else {
            range = nil
        }

        guard index == arguments.endIndex else { return nil }
    }
}

guard CommandLine.arguments.contains(launchMarker) else {
    exit(EXIT_SUCCESS)
}
guard let launchConfiguration = LaunchConfiguration(arguments: CommandLine.arguments) else {
    fputs("rvw received invalid launch arguments\n", stderr)
    exit(EXIT_FAILURE)
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate {
    private let launchConfiguration: LaunchConfiguration
    private var window: NSWindow?
    private var core: OpaquePointer?
    private var bridge: NativeBridge?
    private var assets: AssetHandler?

    init(launchConfiguration: LaunchConfiguration) {
        self.launchConfiguration = launchConfiguration
        super.init()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        var creationError = rvw_buffer(ptr: nil, len: 0)
        let core = launchConfiguration.directory.path.withCString { directory in
            if let range = launchConfiguration.range {
                return range.withCString { rvw_core_create(directory, $0, &creationError) }
            }
            return rvw_core_create(directory, nil, &creationError)
        }
        guard let core else {
            let detail: String
            if let pointer = creationError.ptr, creationError.len > 0 {
                detail = String(decoding: UnsafeBufferPointer(start: pointer, count: creationError.len), as: UTF8.self)
                rvw_buffer_free(nil, creationError)
            } else {
                detail = "The Git diff provider could not be initialized."
            }
            let alert = NSAlert()
            alert.messageText = "Unable to open review"
            alert.informativeText = detail
            alert.alertStyle = .critical
            alert.runModal()
            NSApp.terminate(nil)
            return
        }
        guard let resources = Bundle.main.resourceURL?.appendingPathComponent("web") else {
            fatalError("Unable to find the frontend")
        }

        let nativeHost = NativeHost {
            DispatchQueue.main.async {
                NSApp.terminate(nil)
            }
        }
        let bridge = NativeBridge(core: core, nativeHost: nativeHost)
        let assets = AssetHandler(root: resources)
        let controller = WKUserContentController()
        controller.addScriptMessageHandler(bridge, contentWorld: .page, name: "native")

        let configuration = WKWebViewConfiguration()
        configuration.userContentController = controller
        configuration.setURLSchemeHandler(assets, forURLScheme: "app")

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1200, height: 800),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = "rvw"
        window.contentView = webView
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
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
        guard let core else { return }
        self.core = nil
        rvw_core_destroy(core)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }

        if url.scheme == "app", url.host == "bundle" {
            decisionHandler(.allow)
        } else if url.scheme == "http" || url.scheme == "https" {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
        } else {
            decisionHandler(.cancel)
        }
    }
}

final class NativeBridge: NSObject, WKScriptMessageHandlerWithReply {
    private let core: OpaquePointer
    private let nativeHost: NativeHost

    init(core: OpaquePointer, nativeHost: NativeHost) {
        self.core = core
        self.nativeHost = nativeHost
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @escaping (Any?, String?) -> Void
    ) {
        if let response = nativeHost.handle(message.body) {
            replyHandler(response, nil)
            return
        }

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
let delegate = AppDelegate(launchConfiguration: launchConfiguration)

application.setActivationPolicy(.regular)
installMainMenu(on: application)
application.delegate = delegate
application.run()
