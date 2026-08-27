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

    const dev = b.addSystemCommand(&.{"node"});
    dev.addFileArg(b.path("scripts/dev.mjs"));
    dev.addArtifactArg(server);
    if (b.args) |args| dev.addArgs(args);
    dev.setCwd(b.path("."));
    b.step("dev", "Run the HTTP service and frontend development server").dependOn(&dev.step);

    const provider_tests = b.addTest(.{
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/rvw_core.zig"),
            .target = target,
            .optimize = optimize,
        }),
    });
    const run_provider_tests = b.addRunArtifact(provider_tests);
    b.step("test", "Run Git provider tests").dependOn(&run_provider_tests.step);

    if (b.graph.host.result.os.tag == .macos) addMacApp(b, optimize);
}

fn addMacApp(b: *std.Build, optimize: std.builtin.OptimizeMode) void {
    const host = b.graph.host;
    const swift_target = switch (host.result.cpu.arch) {
        .aarch64 => "arm64-apple-macosx14.0",
        .x86_64 => "x86_64-apple-macosx14.0",
        else => @panic("The macOS app supports Apple Silicon and Intel Macs"),
    };
    const target = b.resolveTargetQuery(.{
        .cpu_arch = host.result.cpu.arch,
        .cpu_model = .native,
        .os_tag = .macos,
        .os_version_min = .{ .semver = .{ .major = 14, .minor = 0, .patch = 0 } },
    });
    const rvw = b.createModule(.{
        .root_source_file = b.path("src/rvw_core.zig"),
        .target = target,
        .optimize = optimize,
    });
    const library = b.addLibrary(.{
        .name = "rvw_macos",
        .linkage = .static,
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/bindings/cabi.zig"),
            .target = target,
            .optimize = optimize,
            .imports = &.{.{ .name = "rvw", .module = rvw }},
        }),
    });
    const cli = b.addExecutable(.{
        .name = "rvw",
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/main.zig"),
            .target = target,
            .optimize = optimize,
        }),
    });

    const frontend = b.addSystemCommand(&.{ "npm", "--prefix", "frontend", "run", "build" });
    const swift = b.addSystemCommand(&.{
        "xcrun",      "swiftc",
        "-target",    swift_target,
        "-I",         "include",
        "-framework", "AppKit",
        "-framework", "WebKit",
    });
    swift.addFileArg(b.path("macos/main.swift"));
    swift.step.dependOn(&library.step);
    swift.addFileArg(library.getEmittedBin());
    swift.addArg("-o");
    const executable = swift.addOutputFileArg("Rvw");

    const install_executable = b.addInstallFileWithDir(
        executable,
        .prefix,
        "Rvw.app/Contents/MacOS/Rvw",
    );
    const install_cli = b.addInstallFileWithDir(
        cli.getEmittedBin(),
        .prefix,
        // macOS installations normally use a case-insensitive filesystem, so
        // "rvw" would overwrite the bundle executable named "Rvw".
        "Rvw.app/Contents/MacOS/rvw-cli",
    );
    const install_plist = b.addInstallFileWithDir(
        b.path("macos/Info.plist"),
        .prefix,
        "Rvw.app/Contents/Info.plist",
    );
    const install_frontend = b.addInstallDirectory(.{
        .source_dir = b.path("frontend/dist"),
        .install_dir = .prefix,
        .install_subdir = "Rvw.app/Contents/Resources/web",
    });
    install_frontend.step.dependOn(&frontend.step);

    b.getInstallStep().dependOn(&install_executable.step);
    b.getInstallStep().dependOn(&install_cli.step);
    b.getInstallStep().dependOn(&install_plist.step);
    b.getInstallStep().dependOn(&install_frontend.step);

    const run = b.addSystemCommand(&.{b.getInstallPath(
        .prefix,
        "Rvw.app/Contents/MacOS/rvw-cli",
    )});
    if (b.args) |args| run.addArgs(args);
    run.step.dependOn(b.getInstallStep());
    b.step("run", "Build and launch the macOS app").dependOn(&run.step);
}
