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
        arguments: ["Rvw", "--rvw-cli-launch", "--directory", "/tmp/repository"]
    ) {
    case let .configuration(configuration):
        expect(configuration.range == nil, "working-tree launches should omit the range")
    default:
        fatalError("working-tree CLI launch arguments should be accepted")
    }

    for range in [[], ["--range", "main..HEAD"]] {
        for level in ["debug", "warn", "", "invalid-secret"] {
            let args = ["Rvw", "--rvw-cli-launch", "--directory", "/tmp/repository"]
                + range + ["--log-level", level]
            switch LaunchConfiguration.parse(arguments: args) {
            case let .configuration(configuration):
                expect(configuration.logLevel == level, "Swift must carry the raw level unchanged")
                expect(configuration.range == range.last, "range must survive logging options")
            default: fatalError("logging configuration must not prevent launch")
            }
        }
    }

    let invalidArguments = [
        ["Rvw", "--rvw-cli-launch"],
        ["Rvw", "--rvw-cli-launch", "--directory"],
        ["Rvw", "--rvw-cli-launch", "--directory", ""],
        ["Rvw", "--rvw-cli-launch", "--directory", "/tmp/repository", "--range"],
        ["Rvw", "--rvw-cli-launch", "--directory", "/tmp/repository", "--range", ""],
        ["Rvw", "--rvw-cli-launch", "--directory", "/tmp/repository", "extra"],
    ]
    for invalid in invalidArguments {
        switch LaunchConfiguration.parse(arguments: invalid) {
        case .invalid: break
        default: fatalError("incomplete or trailing launch arguments should be rejected")
        }
    }
}
