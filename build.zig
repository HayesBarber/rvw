const std = @import("std");
const macos = @import("build/macos.zig");

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

    const server = b.addExecutable(.{
        .name = "rvw-server",
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/dev_server.zig"),
            .target = target,
            .optimize = optimize,
            .imports = &.{.{ .name = "rvw", .module = rvw }},
        }),
    });

    const serve = b.addRunArtifact(server);
    if (b.args) |args| serve.addArgs(args);
    b.step("serve", "Run the HTTP service").dependOn(&serve.step);

    const tests = b.addTest(.{
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/rvw.zig"),
            .target = target,
            .optimize = optimize,
            .imports = &.{.{ .name = "httpz", .module = httpz }},
        }),
    });
    const run_tests = b.addRunArtifact(tests);
    const test_step = b.step("test", "Run unit tests");
    test_step.dependOn(&run_tests.step);

    const cli_tests = b.addTest(.{
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/main.zig"),
            .target = target,
            .optimize = optimize,
        }),
    });
    test_step.dependOn(&b.addRunArtifact(cli_tests).step);

    const dev = b.addSystemCommand(&.{"node"});
    dev.addFileArg(b.path("scripts/dev.mjs"));
    dev.addArtifactArg(server);
    if (b.args) |args| dev.addArgs(args);
    dev.setCwd(b.path("."));
    b.step("dev", "Run the HTTP service and frontend development server").dependOn(&dev.step);

    if (b.graph.host.result.os.tag == .macos) {
        macos.addApp(.{
            .b = b,
            .optimize = optimize,
            .test_step = test_step,
        });
    }
}
