import AppKit
import Darwin

switch LaunchConfiguration.parse(arguments: CommandLine.arguments) {
case .notLaunchedFromCLI:
    exit(EXIT_SUCCESS)
case .invalid:
    fputs("rvw received invalid launch arguments\n", stderr)
    exit(EXIT_FAILURE)
case let .configuration(launchConfiguration):
    let application = NSApplication.shared
    let delegate = ApplicationController(launchConfiguration: launchConfiguration)

    application.setActivationPolicy(.regular)
    ApplicationMenu.install(on: application)
    application.delegate = delegate
    application.run()
}
