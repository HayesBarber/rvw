import AppKit
import Foundation
import WebKit

private enum ApplicationLaunchError: LocalizedError {
    case frontendMissing

    var errorDescription: String? {
        switch self {
        case .frontendMissing: "Unable to find the frontend."
        }
    }
}

private final class ReviewWindowSession {
    let window: NSWindow
    let webView: WKWebView
    let userContentController: WKUserContentController
    let bridge: NativeBridge
    let assets: AssetHandler
    let core: NativeCore
    private var isInvalidated = false

    init(
        window: NSWindow,
        webView: WKWebView,
        userContentController: WKUserContentController,
        bridge: NativeBridge,
        assets: AssetHandler,
        core: NativeCore
    ) {
        self.window = window
        self.webView = webView
        self.userContentController = userContentController
        self.bridge = bridge
        self.assets = assets
        self.core = core
    }

    func invalidate() {
        guard !isInvalidated else { return }
        isInvalidated = true
        userContentController.removeScriptMessageHandler(
            forName: "native",
            contentWorld: .page
        )
        webView.navigationDelegate = nil
        window.delegate = nil
    }

    deinit {
        invalidate()
    }
}

final class ApplicationController: NSObject, NSApplicationDelegate, NSWindowDelegate,
    WKNavigationDelegate
{
    private let launchConfiguration: LaunchConfiguration
    private var session: ReviewWindowSession?

    init(launchConfiguration: LaunchConfiguration) {
        self.launchConfiguration = launchConfiguration
        super.init()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        do {
            session = try makeWindowSession()
            session?.webView.load(
                URLRequest(url: URL(string: "app://bundle/index.html")!)
            )
            NSApp.activate(ignoringOtherApps: true)
        } catch {
            showLaunchError(error.localizedDescription)
            NSApp.terminate(nil)
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        session?.invalidate()
        session = nil
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        switch NavigationPolicy.destination(for: navigationAction.request.url) {
        case .bundledAsset:
            decisionHandler(.allow)
        case let .external(url):
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
        case .rejected:
            decisionHandler(.cancel)
        }
    }

    private func makeWindowSession() throws -> ReviewWindowSession {
        let core = try NativeCore(launchConfiguration: launchConfiguration)
        guard let resources = Bundle.main.resourceURL?.appendingPathComponent("web") else {
            throw ApplicationLaunchError.frontendMissing
        }

        let nativeHost = NativeHost {
            DispatchQueue.main.async {
                NSApp.terminate(nil)
            }
        }
        let bridge = NativeBridge(core: core, nativeHost: nativeHost)
        let assets = AssetHandler(root: resources)
        let userContentController = WKUserContentController()
        userContentController.addScriptMessageHandler(
            bridge,
            contentWorld: .page,
            name: "native"
        )

        let configuration = WKWebViewConfiguration()
        configuration.userContentController = userContentController
        configuration.setURLSchemeHandler(assets, forURLScheme: BundledAssets.scheme)

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

        return ReviewWindowSession(
            window: window,
            webView: webView,
            userContentController: userContentController,
            bridge: bridge,
            assets: assets,
            core: core
        )
    }

    private func showLaunchError(_ detail: String) {
        let alert = NSAlert()
        alert.messageText = "Unable to open review"
        alert.informativeText = detail
        alert.alertStyle = .critical
        alert.runModal()
    }
}
