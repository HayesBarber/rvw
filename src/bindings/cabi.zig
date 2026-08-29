const std = @import("std");
const rvw = @import("rvw");

const allocator = std.heap.page_allocator;

const RvwCore = struct {
    threaded: std.Io.Threaded,
    git: rvw.provider.diff.git.GitProvider,
    files: rvw.provider.file.filesystem.FilesystemProvider,
    comments: rvw.provider.comment.memory.MemoryProvider,
    clipboard: rvw.output.SystemClipboard,
    default_logger: rvw.log.DefaultLogger,
    logger: rvw.log.Logger,
    core: rvw.core.Core,
};

pub const RvwBuffer = extern struct {
    ptr: [*c]u8,
    len: usize,
};

pub export fn rvw_core_create(
    directory_ptr: ?[*:0]const u8,
    range_ptr: ?[*:0]const u8,
    error_out: ?*RvwBuffer,
) callconv(.c) ?*RvwCore {
    if (error_out) |output| output.* = emptyBuffer();
    const directory = std.mem.span(directory_ptr orelse {
        setCreationError(error_out, "missing repository directory");
        return null;
    });
    const range: ?[]const u8 = if (range_ptr) |value| std.mem.span(value) else null;
    const handle = allocator.create(RvwCore) catch return null;
    handle.threaded = .init(allocator, .{});
    handle.default_logger = rvw.log.DefaultLogger.init(allocator, handle.threaded.io(), .{
        .home = environmentVariable("HOME"),
        .xdg_state_home = environmentVariable("XDG_STATE_HOME"),
        .temporary_directory = environmentVariable("TMPDIR"),
    });
    handle.logger = handle.default_logger.interface();
    handle.logger.log(handle.threaded.io(), .{
        .level = .info,
        .source = .backend,
        .message = "application started",
    });
    handle.git = rvw.provider.diff.git.GitProvider.init(allocator, handle.threaded.io(), directory, range) catch |err| {
        handle.default_logger.deinit();
        handle.threaded.deinit();
        const message = std.fmt.allocPrint(allocator, "unable to open Git diff: {s}", .{rvw.provider.diff.git.errorMessage(err)}) catch null;
        if (message) |value| {
            if (error_out) |output| output.* = .{ .ptr = value.ptr, .len = value.len } else allocator.free(value);
        }
        allocator.destroy(handle);
        return null;
    };
    handle.files = rvw.provider.file.filesystem.FilesystemProvider.init(
        allocator,
        handle.threaded.io(),
        directory,
    ) catch |err| {
        handle.git.deinit();
        handle.threaded.deinit();
        const message = std.fmt.allocPrint(allocator, "unable to enumerate repository files: {t}", .{err}) catch null;
        if (message) |value| {
            if (error_out) |output| output.* = .{ .ptr = value.ptr, .len = value.len } else allocator.free(value);
        }
        allocator.destroy(handle);
        return null;
    };
    handle.comments = rvw.provider.comment.memory.MemoryProvider.init(allocator);
    handle.clipboard = .{};
    handle.core = rvw.core.Core.init(
        allocator,
        handle.threaded.io(),
        handle.git.interface(),
        handle.files.interface(),
        handle.comments.interface(),
        handle.clipboard.interface(),
        handle.logger,
    );
    return handle;
}

pub export fn rvw_core_dispatch(
    handle: ?*RvwCore,
    request_ptr: [*c]const u8,
    request_len: usize,
) callconv(.c) RvwBuffer {
    const core = handle orelse return emptyBuffer();
    if (request_ptr == null and request_len != 0) return emptyBuffer();
    const request = request_ptr[0..request_len];
    const response = rvw.json_protocol.dispatchJson(allocator, core.core.dispatcher(), request) catch
        return emptyBuffer();
    return .{ .ptr = response.ptr, .len = response.len };
}

pub export fn rvw_buffer_free(_: ?*RvwCore, buffer: RvwBuffer) callconv(.c) void {
    if (buffer.ptr == null or buffer.len == 0) return;
    // The C ABI carries pointer and length separately. Zig allocators free the
    // slice returned by alloc, so reconstruct that same slice here.
    allocator.free(buffer.ptr[0..buffer.len]);
}

pub export fn rvw_core_destroy(handle: ?*RvwCore) callconv(.c) void {
    const core = handle orelse return;
    core.comments.deinit();
    core.files.deinit();
    core.git.deinit();
    core.default_logger.deinit();
    core.threaded.deinit();
    allocator.destroy(core);
}

fn environmentVariable(comptime name: [:0]const u8) ?[]const u8 {
    const value = std.c.getenv(name) orelse return null;
    return std.mem.span(value);
}

fn emptyBuffer() RvwBuffer {
    return .{ .ptr = null, .len = 0 };
}

fn setCreationError(error_out: ?*RvwBuffer, message: []const u8) void {
    const output = error_out orelse return;
    const owned = allocator.dupe(u8, message) catch return;
    output.* = .{ .ptr = owned.ptr, .len = owned.len };
}
