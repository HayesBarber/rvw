const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});
    const httpz = b.dependency("httpz", .{
        .target = target,
        .optimize = optimize,
    }).module("httpz");

    const rvw = b.addModule("rvw", .{
        .root_source_file = b.path("src/rvw.zig"),
        .target = target,
        .optimize = optimize,
        .imports = &.{.{ .name = "httpz", .module = httpz }},
    });

    const exe = b.addExecutable(.{
        .name = "rvw",
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/main.zig"),
            .target = target,
            .optimize = optimize,
            .imports = &.{.{ .name = "rvw", .module = rvw }},
        }),
    });
    b.installArtifact(exe);

    const library = b.addLibrary(.{
        .name = "rvw",
        .linkage = .static,
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/bindings/cabi.zig"),
            .target = target,
            .optimize = optimize,
            .imports = &.{.{ .name = "rvw", .module = rvw }},
        }),
    });
    b.installArtifact(library);
    library.installHeader(b.path("include/rvw.h"), "rvw.h");

    const run = b.addRunArtifact(exe);
    run.step.dependOn(b.getInstallStep());
    if (b.args) |args| run.addArgs(args);
    b.step("run", "Run the HTTP service").dependOn(&run.step);

    const dev = b.addSystemCommand(&.{"node"});
    dev.addFileArg(b.path("scripts/dev.mjs"));
    dev.addArtifactArg(exe);
    dev.setCwd(b.path("."));
    b.step("dev", "Run the HTTP service and frontend development server").dependOn(&dev.step);
}
