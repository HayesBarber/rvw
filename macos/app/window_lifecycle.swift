import AppKit

func retainApplicationWindowAfterClose(_ window: NSWindow) {
    window.isReleasedWhenClosed = false
}
