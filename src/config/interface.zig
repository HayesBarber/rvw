const std = @import("std");

pub const DiagnosticCode = enum {
    malformed_json,
    invalid_schema,
    file_read_failure,
};

pub const Diagnostic = struct {
    code: DiagnosticCode,
    message: []const u8,
    path: []const u8,
};

/// The immutable user configuration and optional problem discovered while
/// loading it. A problem always accompanies the empty fallback configuration.
pub const Snapshot = struct {
    configuration: std.json.Value,
    diagnostic: ?Diagnostic,
};
