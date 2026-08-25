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
            .root_source_file = b.path("src/dispatcher/cabi.zig"),
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

    const core_tests = b.addTest(.{ .root_module = rvw });
    const run_core_tests = b.addRunArtifact(core_tests);
    const cabi_tests = b.addTest(.{ .root_module = library.root_module });
    const run_cabi_tests = b.addRunArtifact(cabi_tests);
    const exe_tests = b.addTest(.{ .root_module = exe.root_module });
    const run_exe_tests = b.addRunArtifact(exe_tests);
    const test_step = b.step("test", "Run all tests");
    test_step.dependOn(&run_core_tests.step);
    test_step.dependOn(&run_cabi_tests.step);
    test_step.dependOn(&run_exe_tests.step);
}
