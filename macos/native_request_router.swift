import Foundation

final class NativeRequestRouter {
    private let coreQueue = DispatchQueue(label: "rvw.core.requests", qos: .userInitiated)
    private let nativeHost: NativeHost
    private let dispatchCore: (Any) throws -> Any?

    init(nativeHost: NativeHost, dispatchCore: @escaping (Any) throws -> Any?) {
        self.nativeHost = nativeHost
        self.dispatchCore = dispatchCore
    }

    // Host actions stay on the calling UI thread. Core requests run in order.
    // The bridge sends each completion back to the main queue.
    func handle(_ messageBody: Any, completion: @escaping (Result<Any?, Error>) -> Void) {
        if let response = nativeHost.handle(messageBody) {
            completion(.success(response))
            return
        }
        coreQueue.async {
            completion(Result { try self.dispatchCore(messageBody) })
        }
    }
}
