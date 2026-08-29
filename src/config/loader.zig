const std = @import("std");
const config = @import("interface.zig");

const Allocator = std.mem.Allocator;
const Io = std.Io;

const maximum_configuration_size = 1024 * 1024;
const relative_configuration_path = ".config/rvw/config.json";

pub const Environment = struct {
    home: ?[]const u8 = null,
};

/// Owns the user configuration loaded once for an application process. Invalid
/// input is represented by an empty configuration and a diagnostic rather than
/// an initialization error.
pub const Loaded = struct {
    arena: std.heap.ArenaAllocator,
    snapshot: config.Snapshot,

    pub fn deinit(self: *Loaded) void {
        self.arena.deinit();
        self.* = undefined;
    }
};

pub fn load(backing_allocator: Allocator, io: Io, environment: Environment) Allocator.Error!Loaded {
    var arena = std.heap.ArenaAllocator.init(backing_allocator);
    errdefer arena.deinit();
    const allocator = arena.allocator();

    const path = resolvePath(allocator, environment.home) catch |err| switch (err) {
        error.OutOfMemory => return error.OutOfMemory,
    } orelse {
        return .{
            .arena = arena,
            .snapshot = diagnosticSnapshot(
                .file_read_failure,
                "unable to resolve user configuration because HOME is not set",
                "~/.config/rvw/config.json",
            ),
        };
    };

    const input = Io.Dir.cwd().readFileAlloc(
        io,
        path,
        allocator,
        .limited(maximum_configuration_size),
    ) catch |err| switch (err) {
        error.OutOfMemory => return error.OutOfMemory,
        error.FileNotFound => return .{
            .arena = arena,
            .snapshot = emptySnapshot(),
        },
        else => return .{
            .arena = arena,
            .snapshot = diagnosticSnapshot(
                .file_read_failure,
                try std.fmt.allocPrint(
                    allocator,
                    "unable to read user configuration: {s}",
                    .{@errorName(err)},
                ),
                path,
            ),
        },
    };

    const parsed = try parseConfiguration(allocator, input);
    const snapshot = switch (parsed) {
        .configuration => |configuration| config.Snapshot{
            .configuration = configuration,
            .diagnostic = null,
        },
        .malformed_json => diagnosticSnapshot(
            .malformed_json,
            "user configuration contains malformed JSON",
            path,
        ),
        .invalid_schema => |schema_error| diagnosticSnapshot(
            .invalid_schema,
            schemaErrorMessage(schema_error),
            path,
        ),
    };
    return .{ .arena = arena, .snapshot = snapshot };
}

pub fn resolvePath(allocator: Allocator, home: ?[]const u8) Allocator.Error!?[]u8 {
    const directory = home orelse return null;
    return try std.fs.path.join(allocator, &.{ directory, relative_configuration_path });
}

const ParseResult = union(enum) {
    configuration: std.json.Value,
    malformed_json,
    invalid_schema: SchemaError,
};

const SchemaError = error{
    duplicate_field,
    root_not_object,
    unknown_root_field,
    keybindings_not_object,
    unknown_keybindings_field,
    normal_not_object,
    empty_action,
    sequences_not_array,
    sequence_not_array,
    empty_sequence,
    key_not_string,
    empty_key,
    invalid_utf8_key,
};

fn parseConfiguration(allocator: Allocator, input: []const u8) Allocator.Error!ParseResult {
    const value = std.json.parseFromSliceLeaky(std.json.Value, allocator, input, .{
        .allocate = .alloc_always,
    }) catch |err| switch (err) {
        error.OutOfMemory => return error.OutOfMemory,
        error.DuplicateField => return .{ .invalid_schema = error.duplicate_field },
        else => return .malformed_json,
    };
    validateConfiguration(value) catch |err| return .{ .invalid_schema = err };
    return .{ .configuration = value };
}

fn validateConfiguration(value: std.json.Value) SchemaError!void {
    const root = switch (value) {
        .object => |object| object,
        else => return error.root_not_object,
    };
    if (!onlyFields(root, &.{"keybindings"})) return error.unknown_root_field;

    const keybindings_value = root.get("keybindings") orelse return;
    const keybindings = switch (keybindings_value) {
        .object => |object| object,
        else => return error.keybindings_not_object,
    };
    if (!onlyFields(keybindings, &.{"normal"})) return error.unknown_keybindings_field;

    const normal_value = keybindings.get("normal") orelse return;
    const normal = switch (normal_value) {
        .object => |object| object,
        else => return error.normal_not_object,
    };
    var bindings = normal.iterator();
    while (bindings.next()) |binding| {
        if (binding.key_ptr.len == 0) return error.empty_action;
        try validateSequences(binding.value_ptr.*);
    }
}

fn validateSequences(value: std.json.Value) SchemaError!void {
    const sequences = switch (value) {
        .array => |array| array.items,
        else => return error.sequences_not_array,
    };
    for (sequences) |sequence_value| {
        const sequence = switch (sequence_value) {
            .array => |array| array.items,
            else => return error.sequence_not_array,
        };
        if (sequence.len == 0) return error.empty_sequence;
        for (sequence) |key_value| {
            const key = switch (key_value) {
                .string => |string| string,
                else => return error.key_not_string,
            };
            if (key.len == 0) return error.empty_key;
            if (!std.unicode.utf8ValidateSlice(key)) return error.invalid_utf8_key;
        }
    }
}

fn onlyFields(object: std.json.ObjectMap, allowed: []const []const u8) bool {
    var fields = object.iterator();
    while (fields.next()) |field| {
        for (allowed) |name| {
            if (std.mem.eql(u8, field.key_ptr.*, name)) break;
        } else return false;
    }
    return true;
}

fn schemaErrorMessage(schema_error: SchemaError) []const u8 {
    return switch (schema_error) {
        error.duplicate_field => "user configuration contains a duplicate JSON field",
        error.root_not_object => "user configuration root must be a JSON object",
        error.unknown_root_field => "user configuration contains an unsupported top-level field",
        error.keybindings_not_object => "user configuration keybindings must be a JSON object",
        error.unknown_keybindings_field => "user configuration keybindings contains an unsupported field",
        error.normal_not_object => "user configuration keybindings.normal must be a JSON object",
        error.empty_action => "user configuration keybindings.normal action identifiers cannot be empty",
        error.sequences_not_array => "each keybindings.normal action must contain a list of key sequences",
        error.sequence_not_array => "each keybinding sequence must be an ordered array of keys",
        error.empty_sequence => "keybinding sequences cannot be empty",
        error.key_not_string => "each keybinding key must be a string",
        error.empty_key => "keybinding keys cannot be empty",
        error.invalid_utf8_key => "keybinding keys must contain valid UTF-8",
    };
}

fn emptySnapshot() config.Snapshot {
    return .{
        .configuration = .{ .object = .empty },
        .diagnostic = null,
    };
}

fn diagnosticSnapshot(
    code: config.DiagnosticCode,
    message: []const u8,
    path: []const u8,
) config.Snapshot {
    return .{
        .configuration = .{ .object = .empty },
        .diagnostic = .{ .code = code, .message = message, .path = path },
    };
}

test "configuration path resolves below the user home directory" {
    const path = try resolvePath(std.testing.allocator, "/Users/example");
    defer std.testing.allocator.free(path.?);
    try std.testing.expectEqualStrings(
        "/Users/example/.config/rvw/config.json",
        path.?,
    );
    try std.testing.expect((try resolvePath(std.testing.allocator, null)) == null);
}

test "valid keybinding configuration preserves ordered multi-key sequences" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const parsed = try parseConfiguration(arena.allocator(),
        \\{
        \\  "keybindings": {
        \\    "normal": {
        \\      "focus.file_tree": [["g", "t"], ["<C-w>", "h"]],
        \\      "comments.copy": []
        \\    }
        \\  }
        \\}
    );
    const configuration = switch (parsed) {
        .configuration => |value| value,
        else => return error.TestUnexpectedResult,
    };
    const root = configuration.object;
    const keybindings = root.get("keybindings").?.object;
    const normal = keybindings.get("normal").?.object;
    const sequences = normal.get("focus.file_tree").?.array.items;
    try std.testing.expectEqual(@as(usize, 2), sequences.len);
    try std.testing.expectEqualStrings("g", sequences[0].array.items[0].string);
    try std.testing.expectEqualStrings("t", sequences[0].array.items[1].string);
    try std.testing.expectEqualStrings("<C-w>", sequences[1].array.items[0].string);
    try std.testing.expectEqualStrings("h", sequences[1].array.items[1].string);
    try std.testing.expectEqual(@as(usize, 0), normal.get("comments.copy").?.array.items.len);
}

test "malformed JSON and invalid keybinding schema are distinct" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const malformed = try parseConfiguration(arena.allocator(), "{");
    try std.testing.expect(malformed == .malformed_json);

    const invalid = try parseConfiguration(arena.allocator(),
        \\{"keybindings":{"normal":{"cursor.up":["k"]}}}
    );
    try std.testing.expect(invalid == .invalid_schema);
    try std.testing.expectEqual(error.sequence_not_array, invalid.invalid_schema);
}

test "loader reads and serializes the user configuration file" {
    var temporary = std.testing.tmpDir(.{});
    defer temporary.cleanup();
    const home = try temporary.dir.realPathFileAlloc(std.testing.io, ".", std.testing.allocator);
    defer std.testing.allocator.free(home);
    try temporary.dir.createDirPath(std.testing.io, ".config/rvw");
    try temporary.dir.writeFile(std.testing.io, .{
        .sub_path = relative_configuration_path,
        .data =
        \\{"keybindings":{"normal":{"focus.file_tree":[["g","t"]]}}}
        ,
    });

    var loaded = try load(std.testing.allocator, std.testing.io, .{ .home = home });
    defer loaded.deinit();
    const encoded = try std.json.Stringify.valueAlloc(
        std.testing.allocator,
        loaded.snapshot,
        .{},
    );
    defer std.testing.allocator.free(encoded);
    try std.testing.expectEqualStrings(
        "{\"configuration\":{\"keybindings\":{\"normal\":{\"focus.file_tree\":[[\"g\",\"t\"]]}}},\"diagnostic\":null}",
        encoded,
    );
}

test "loader reports malformed JSON and invalid schema without failing" {
    var temporary = std.testing.tmpDir(.{});
    defer temporary.cleanup();
    const home = try temporary.dir.realPathFileAlloc(std.testing.io, ".", std.testing.allocator);
    defer std.testing.allocator.free(home);
    try temporary.dir.createDirPath(std.testing.io, ".config/rvw");

    try temporary.dir.writeFile(std.testing.io, .{
        .sub_path = relative_configuration_path,
        .data = "{",
    });
    var malformed = try load(std.testing.allocator, std.testing.io, .{ .home = home });
    defer malformed.deinit();
    try std.testing.expectEqual(config.DiagnosticCode.malformed_json, malformed.snapshot.diagnostic.?.code);
    try std.testing.expectEqual(@as(usize, 0), malformed.snapshot.configuration.object.count());

    try temporary.dir.writeFile(std.testing.io, .{
        .sub_path = relative_configuration_path,
        .data = "{\"keybindings\":[]}",
    });
    var invalid = try load(std.testing.allocator, std.testing.io, .{ .home = home });
    defer invalid.deinit();
    try std.testing.expectEqual(config.DiagnosticCode.invalid_schema, invalid.snapshot.diagnostic.?.code);
    try std.testing.expectEqual(@as(usize, 0), invalid.snapshot.configuration.object.count());
}

test "missing configuration is empty while read failures are diagnosed" {
    var temporary = std.testing.tmpDir(.{});
    defer temporary.cleanup();
    const home = try temporary.dir.realPathFileAlloc(std.testing.io, ".", std.testing.allocator);
    defer std.testing.allocator.free(home);

    var missing = try load(std.testing.allocator, std.testing.io, .{ .home = home });
    defer missing.deinit();
    try std.testing.expectEqual(@as(usize, 0), missing.snapshot.configuration.object.count());
    try std.testing.expect(missing.snapshot.diagnostic == null);

    try temporary.dir.createDirPath(std.testing.io, relative_configuration_path);
    var unreadable = try load(std.testing.allocator, std.testing.io, .{ .home = home });
    defer unreadable.deinit();
    try std.testing.expectEqual(config.DiagnosticCode.file_read_failure, unreadable.snapshot.diagnostic.?.code);
}
