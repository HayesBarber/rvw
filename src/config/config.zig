pub const interface = @import("interface.zig");
pub const loader = @import("loader.zig");

pub const DiagnosticCode = interface.DiagnosticCode;
pub const Diagnostic = interface.Diagnostic;
pub const Snapshot = interface.Snapshot;
pub const Environment = loader.Environment;
pub const Loaded = loader.Loaded;
pub const load = loader.load;
pub const resolvePath = loader.resolvePath;

test {
    _ = loader;
}
