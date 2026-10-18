import Foundation

enum NavigationDestination: Equatable {
    case bundledAsset
    case external(URL)
    case rejected
}

enum NavigationPolicy {
    static func destination(for url: URL?) -> NavigationDestination {
        guard let url else { return .rejected }

        if url.scheme == BundledAssets.scheme, url.host == BundledAssets.host {
            return .bundledAsset
        }
        if url.scheme == "http" || url.scheme == "https" {
            return .external(url)
        }
        return .rejected
    }
}
