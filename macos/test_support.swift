import Foundation

func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
    guard condition() else { fatalError(message) }
}

func withTemporaryDirectory(_ body: (URL) throws -> Void) throws {
    let directory = FileManager.default.temporaryDirectory
        .appendingPathComponent("rvw-tests-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
    defer { try? FileManager.default.removeItem(at: directory) }
    try body(directory)
}
