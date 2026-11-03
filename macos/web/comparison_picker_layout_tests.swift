import AppKit
import WebKit

// Use markup from the frontend tests and the production stylesheet.
final class LayoutCheck: NSObject, WKNavigationDelegate {
    let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 720),
                          styleMask: [.borderless], backing: .buffered, defer: false)
    let webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 1280, height: 720))
    let sizes = [NSSize(width: 1280, height: 720), NSSize(width: 1600, height: 900), NSSize(width: 800, height: 500)]
    var index = 0

    override init() {
        super.init()
        window.contentView = webView
        webView.navigationDelegate = self
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { checkSize() }

    func checkSize() {
        guard index < sizes.count else {
            print("WebKit comparison layout passed at all window sizes")
            exit(0)
        }
        let size = sizes[index]
        window.setContentSize(size)
        webView.setFrameSize(size)
        webView.evaluateJavaScript("""
            (() => {
                const dialog = document.querySelector('dialog');
                if (!dialog.open) dialog.showModal();
                const scroll = document.querySelector('.comparison-picker-scroll');
                const button = document.querySelector('.comparison-picker-submit');
                const bounds = dialog.getBoundingClientRect();
                const visible = () => {
                    const rect = button.getBoundingClientRect();
                    return rect.height > 0 && rect.top >= bounds.top && rect.bottom <= bounds.bottom
                        && rect.bottom <= innerHeight;
                };
                const before = visible();
                scroll.scrollTop = scroll.scrollHeight;
                const after = visible();
                const footer = document.querySelector('.comparison-picker-footer');
                const footerBounds = footer.getBoundingClientRect();
                const rightAligned = Math.abs(button.getBoundingClientRect().right
                    - footerBounds.right + parseFloat(getComputedStyle(footer).paddingRight)) < 1;
                const bodyHeight = scroll.clientHeight;
                const listScrolls = scroll.scrollHeight > scroll.clientHeight;
                const body = document.querySelector('.review-source-picker-body');
                const comparison = body.innerHTML;
                let modeHeightStable = true;
                for (const id of ['pull-requests-0', 'pull-requests-1']) {
                    body.dataset.mode = 'pull-requests';
                    body.innerHTML = document.getElementById(id).innerHTML;
                    modeHeightStable &&= Math.abs(dialog.getBoundingClientRect().height - bounds.height) < 1;
                    body.dataset.mode = 'commits';
                    body.innerHTML = comparison;
                    modeHeightStable &&= Math.abs(dialog.getBoundingClientRect().height - bounds.height) < 1;
                }
                return {
                    bodyVisible: bodyHeight > 100,
                    listScrolls,
                    submitVisibleBeforeScroll: before,
                    submitVisibleAfterScroll: after,
                    rightAligned,
                    modeHeightStable,
                    viewportHeight: innerHeight,
                    bodyHeight
                };
            })()
            """) { result, error in
            guard error == nil, let checks = result as? [String: Any],
                  checks["bodyVisible"] as? Bool == true,
                  checks["listScrolls"] as? Bool == true,
                  checks["submitVisibleBeforeScroll"] as? Bool == true,
                  checks["submitVisibleAfterScroll"] as? Bool == true,
                  checks["rightAligned"] as? Bool == true,
                  checks["modeHeightStable"] as? Bool == true else {
                fputs("WebKit layout failed at \(size): \(String(describing: result)), \(String(describing: error))\n", stderr)
                exit(1)
            }
            self.index += 1
            self.checkSize()
        }
    }
}

let application = NSApplication.shared
application.setActivationPolicy(.prohibited)
let check = LayoutCheck()
let fixture = URL(fileURLWithPath: CommandLine.arguments[1])
check.webView.loadFileURL(fixture, allowingReadAccessTo: fixture.deletingLastPathComponent())
DispatchQueue.main.asyncAfter(deadline: .now() + 20) {
    fputs("WebKit layout test timed out\n", stderr)
    exit(1)
}
application.run()
