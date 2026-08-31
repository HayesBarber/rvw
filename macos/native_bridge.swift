import Foundation
import RvwCore
import WebKit

private enum NativeCoreError: LocalizedError {
    case creationFailed(String)
    case emptyResponse
    case invalidResponse
    case requestFailed(String)

    var errorDescription: String? {
        switch self {
        case let .creationFailed(detail): detail
        case .emptyResponse: "rvw returned an empty response"
        case .invalidResponse: "rvw returned an invalid response"
        case let .requestFailed(message): message
        }
    }
}

final class NativeCore {
    private var pointer: OpaquePointer?

    init(launchConfiguration: LaunchConfiguration) throws {
        var creationError = rvw_buffer(ptr: nil, len: 0)
        let createdCore = launchConfiguration.directory.path.withCString { directory in
            if let range = launchConfiguration.range {
                return range.withCString { rvw_core_create(directory, $0, &creationError) }
            }
            return rvw_core_create(directory, nil, &creationError)
        }

        guard let createdCore else {
            let detail: String
            if let errorPointer = creationError.ptr {
                detail = String(
                    decoding: UnsafeBufferPointer(start: errorPointer, count: creationError.len),
                    as: UTF8.self
                )
                rvw_buffer_free(nil, creationError)
            } else {
                detail = "The Git diff provider could not be initialized."
            }
            throw NativeCoreError.creationFailed(detail)
        }
        pointer = createdCore
    }

    deinit {
        guard let pointer else { return }
        self.pointer = nil
        rvw_core_destroy(pointer)
    }

    func dispatch(_ messageBody: Any) throws -> Any? {
        guard let pointer else {
            throw NativeCoreError.requestFailed("rvw is no longer available")
        }
        let request = try JSONSerialization.data(withJSONObject: messageBody)
        let response = request.withUnsafeBytes { bytes in
            rvw_core_dispatch(pointer, bytes.bindMemory(to: UInt8.self).baseAddress, bytes.count)
        }
        guard let responsePointer = response.ptr, response.len > 0 else {
            throw NativeCoreError.emptyResponse
        }
        defer { rvw_buffer_free(pointer, response) }

        guard let envelope = try JSONSerialization.jsonObject(
            with: Data(bytes: responsePointer, count: response.len)
        ) as? [String: Any] else {
            throw NativeCoreError.invalidResponse
        }
        if envelope["ok"] as? Bool == true {
            return envelope["data"]
        }
        let error = envelope["error"] as? [String: Any]
        throw NativeCoreError.requestFailed(error?["message"] as? String ?? "rvw request failed")
    }
}

final class NativeBridge: NSObject, WKScriptMessageHandlerWithReply {
    private let core: NativeCore
    private let nativeHost: NativeHost

    init(core: NativeCore, nativeHost: NativeHost) {
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
            replyHandler(try core.dispatch(message.body), nil)
        } catch {
            replyHandler(nil, error.localizedDescription)
        }
    }
}
