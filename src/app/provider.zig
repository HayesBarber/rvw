const model = @import("model.zig");

pub const ReviewProvider = struct {
    context: *anyopaque,
    vtable: *const VTable,

    pub const VTable = struct {
        getOverview: *const fn (*anyopaque) anyerror!model.ReviewOverview,
        getFileReview: *const fn (*anyopaque, []const u8, []const u8) anyerror!model.FileReview,
    };

    pub fn getOverview(self: ReviewProvider) !model.ReviewOverview {
        return self.vtable.getOverview(self.context);
    }

    pub fn getFileReview(self: ReviewProvider, review_id: []const u8, path: []const u8) !model.FileReview {
        return self.vtable.getFileReview(self.context, review_id, path);
    }
};
