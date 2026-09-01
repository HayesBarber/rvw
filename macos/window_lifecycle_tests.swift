import AppKit

func testWindowLifecycle() {
    let window = NSWindow(
        contentRect: .zero,
        styleMask: [.titled],
        backing: .buffered,
        defer: false
    )
    expect(window.isReleasedWhenClosed, "AppKit windows should release themselves by default")

    retainApplicationWindowAfterClose(window)

    expect(
        !window.isReleasedWhenClosed,
        "the application session should retain its window after it closes"
    )
}
