const std = @import("std");
const model = @import("../../app/model.zig");

pub const TextSearchProvider = struct {
    context: *anyopaque,
    vtable: *const VTable,

    pub const VTable = struct {
        search: *const fn (*anyopaque, std.Io, []const u8, []const u8) anyerror!model.TextSearchResult,
    };

    pub fn search(self: TextSearchProvider, io: std.Io, directory: []const u8, query: []const u8) !model.TextSearchResult {
        if (!model.validTextSearchQuery(query)) return error.InvalidSearchQuery;
        if (query.len == 0) return .{ .matches = &.{}, .truncated = false };
        return self.vtable.search(self.context, io, directory, query);
    }
};
