import Foundation

private let launchMarker = "--rvw-cli-launch"

enum LaunchConfigurationResult {
    case notLaunchedFromCLI
    case invalid
    case configuration(LaunchConfiguration)
}

struct LaunchConfiguration: Equatable {
    let directory: URL
    let range: String?
    var pr: UInt32? = nil
    var logLevel: String? = nil

    static func parse(arguments: [String]) -> LaunchConfigurationResult {
        guard let markerIndex = arguments.firstIndex(of: launchMarker) else {
            return .notLaunchedFromCLI
        }
        var index = arguments.index(after: markerIndex)

        guard index < arguments.endIndex, arguments[index] == "--directory" else {
            return .invalid
        }
        index = arguments.index(after: index)
        guard index < arguments.endIndex, !arguments[index].isEmpty else {
            return .invalid
        }
        let directory = URL(fileURLWithPath: arguments[index], isDirectory: true)
        index = arguments.index(after: index)

        let range: String?
        if index < arguments.endIndex, arguments[index] == "--range" {
            index = arguments.index(after: index)
            guard index < arguments.endIndex, !arguments[index].isEmpty else {
                return .invalid
            }
            range = arguments[index]
            index = arguments.index(after: index)
        } else {
            range = nil
        }

        var pr: UInt32? = nil
        if index < arguments.endIndex, arguments[index] == "--pr" {
            index = arguments.index(after: index)
            guard range != nil, index < arguments.endIndex,
                  !arguments[index].isEmpty,
                  arguments[index].utf8.allSatisfy({ $0 >= 48 && $0 <= 57 }),
                  let number = UInt32(arguments[index]), number > 0 else { return .invalid }
            pr = number
            index = arguments.index(after: index)
        }
        var logLevel: String? = nil
        if index < arguments.endIndex, arguments[index] == "--log-level" {
            index = arguments.index(after: index)
            guard index < arguments.endIndex else { return .invalid }
            logLevel = arguments[index]
            index = arguments.index(after: index)
        }
        guard index == arguments.endIndex else { return .invalid }
        return .configuration(LaunchConfiguration(directory: directory, range: range, pr: pr, logLevel: logLevel))
    }
}
