enum NativeHostAction: Equatable {
    case closeApplication
}

func nativeHostAction(for messageBody: Any) -> NativeHostAction? {
    guard let request = messageBody as? [String: Any],
          request.count == 1,
          request["type"] as? String == "application_close"
    else { return nil }
    return .closeApplication
}

final class NativeHost {
    private let requestApplicationTermination: () -> Void

    init(requestApplicationTermination: @escaping () -> Void) {
        self.requestApplicationTermination = requestApplicationTermination
    }

    func handle(_ messageBody: Any) -> [String: Any]? {
        guard let action = nativeHostAction(for: messageBody) else { return nil }

        switch action {
        case .closeApplication:
            requestApplicationTermination()
            return ["closing": true]
        }
    }
}
