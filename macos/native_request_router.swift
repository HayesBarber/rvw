final class NativeRequestRouter {
    private let nativeHost: NativeHost
    private let dispatchCore: (Any) throws -> Any?

    init(nativeHost: NativeHost, dispatchCore: @escaping (Any) throws -> Any?) {
        self.nativeHost = nativeHost
        self.dispatchCore = dispatchCore
    }

    func handle(_ messageBody: Any) throws -> Any? {
        if let response = nativeHost.handle(messageBody) {
            return response
        }
        return try dispatchCore(messageBody)
    }
}
