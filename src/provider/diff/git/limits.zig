const shared = @import("../../git/process.zig");

pub const maximum_text_size = 512 * 1024;
pub const maximum_metadata_size = shared.maximum_metadata_size;
pub const maximum_revision_size = shared.maximum_revision_size;
pub const maximum_stderr_size = shared.maximum_stderr_size;