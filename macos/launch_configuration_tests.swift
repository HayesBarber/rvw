func testLaunchConfiguration() {
    switch LaunchConfiguration.parse(arguments: ["Rvw"]) {
    case .notLaunchedFromCLI: break
    default: fatalError("ordinary application launches should exit without starting")
    }

    let arguments = [
        "Rvw", "--rvw-cli-launch", "--directory", "/tmp/repository", "--range", "main...HEAD",
    ]
    switch LaunchConfiguration.parse(arguments: arguments) {
    case let .configuration(configuration):
        expect(configuration.directory.path == "/tmp/repository", "directory should be parsed")
        expect(configuration.range == "main...HEAD", "range should be parsed")
    default:
        fatalError("valid CLI launch arguments should be accepted")
    }

    switch LaunchConfiguration.parse(
        arguments: ["Rvw", "--rvw-cli-launch", "--directory", "/tmp/repository", "extra"]
    ) {
    case .invalid: break
    default: fatalError("trailing launch arguments should be rejected")
    }
}
