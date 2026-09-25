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
        let traceId = fileTimingTraceId(messageBody)
        let queued = traceId == nil ? nil : DispatchTime.now().uptimeNanoseconds
        coreQueue.async {
            let queueMs = queued.map { Double(DispatchTime.now().uptimeNanoseconds - $0) / 1_000_000 }
            let result = Result { try self.dispatchCore(messageBody) }
            if let traceId, let queueMs {
                _ = try? self.dispatchCore(fileTimingEvent(traceId, "native_queue", queueMs))
            }
            completion(result)
        }
    }
}

// Only the opt-in file request path sends trace IDs. Never retain request data.
func fileTimingTraceId(_ body: Any) -> String? {
    guard let request = body as? [String: Any],
          let operation = request["type"] as? String,
          operation == "get_file" || operation == "get_file_diff",
          let id = request["traceId"] as? String,
          !id.isEmpty, id.utf8.count <= 64,
          id.utf8.allSatisfy({ (48...57).contains($0) || (65...90).contains($0) || (97...122).contains($0) || $0 == 45 })
    else { return nil }
    return id
}

func fileTimingEvent(_ id: String, _ stage: String, _ durationMs: Double) -> [String: Any] {
    ["type": "log", "level": "debug", "message": "file load timing", "traceId": id,
     "context": ["stage": stage, "durationMs": durationMs]]
}
