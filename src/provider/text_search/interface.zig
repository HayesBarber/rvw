const std = @import("std");
const model = @import("../../app/model.zig");

pub const TextSearchProvider = struct {
    context: *anyopaque,
    vtable: *const VTable,

    pub const VTable = struct {
        search: *const fn (*anyopaque, std.Io, []const u8, model.TextSearchRequest) anyerror!model.TextSearchResult,
    };

    /// The core supplies the opened directory; requests cannot change it.
    /// Inputs are borrowed for this call only. The provider owns all result
    /// slices and strings until its next search call or destruction.
    /// The caller must serialize or copy results before the next search.
    /// Calls and result consumption must be serialized by the host.
    pub fn search(self: TextSearchProvider, io: std.Io, directory: []const u8, request: model.TextSearchRequest) !model.TextSearchResult {
        if (!model.validTextSearchQuery(request.query)) return error.InvalidSearchQuery;
        if (request.query.len == 0) return .{ .matches = &.{}, .truncated = false };
        return self.vtable.search(self.context, io, directory, request);
    }
};
