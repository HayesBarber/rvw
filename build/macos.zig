const std = @import("std");

pub const Context = struct {
    b: *std.Build,
    optimize: std.builtin.OptimizeMode,
    test_step: *std.Build.Step,
};

const AppArtifacts = struct {
    executable: std.Build.LazyPath,
    cli: *std.Build.Step.Compile,
    frontend: *std.Build.Step.Run,
};

pub fn addApp(context: Context) void {
    const artifacts = addAppArtifacts(context);
    addSwiftTests(context);
    addBundleInstallation(context.b, artifacts);
    addRunStep(context.b);
}

fn addAppArtifacts(context: Context) AppArtifacts {
    const b = context.b;
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
        .optimize = context.optimize,
    });
    const library = b.addLibrary(.{
        .name = "rvw_macos",
        .linkage = .static,
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/bindings/cabi.zig"),
            .target = target,
            .optimize = context.optimize,
            .imports = &.{.{ .name = "rvw", .module = rvw }},
        }),
    });
    const cli = b.addExecutable(.{
        .name = "rvw",
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/main.zig"),
            .target = target,
            .optimize = context.optimize,
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
    for ([_][]const u8{
        "macos/main.swift",
        "macos/launch_configuration.swift",
        "macos/application_menu.swift",
        "macos/native_host.swift",
        "macos/native_request_router.swift",
        "macos/native_bridge.swift",
        "macos/bundled_assets.swift",
        "macos/asset_handler.swift",
        "macos/navigation_policy.swift",
        "macos/window_lifecycle.swift",
        "macos/application_controller.swift",
    }) |source| swift.addFileArg(b.path(source));
    swift.step.dependOn(&library.step);
    swift.addFileArg(library.getEmittedBin());
    swift.addArg("-o");

    return .{
        .executable = swift.addOutputFileArg("Rvw"),
        .cli = cli,
        .frontend = frontend,
    };
}

fn addSwiftTests(context: Context) void {
    const b = context.b;
    const swift_tests = b.addSystemCommand(&.{ "xcrun", "swiftc" });
    for ([_][]const u8{
        "macos/launch_configuration.swift",
        "macos/native_host.swift",
        "macos/native_request_router.swift",
        "macos/bundled_assets.swift",
        "macos/navigation_policy.swift",
        "macos/window_lifecycle.swift",
        "macos/test_support.swift",
        "macos/launch_configuration_tests.swift",
        "macos/bundled_assets_tests.swift",
        "macos/navigation_policy_tests.swift",
        "macos/window_lifecycle_tests.swift",
        "macos/native_host_tests.swift",
        "macos/native_request_router_tests.swift",
    }) |source| swift_tests.addFileArg(b.path(source));
    swift_tests.addArg("-o");
    const swift_test_executable = swift_tests.addOutputFileArg("NativeHostTests");
    const run_swift_tests = b.addSystemCommand(&.{"/usr/bin/env"});
    run_swift_tests.addFileArg(swift_test_executable);
    context.test_step.dependOn(&run_swift_tests.step);
}

fn addBundleInstallation(b: *std.Build, artifacts: AppArtifacts) void {
    const install_executable = b.addInstallFileWithDir(
        artifacts.executable,
        .prefix,
        "Rvw.app/Contents/MacOS/Rvw",
    );
    const install_cli = b.addInstallFileWithDir(
        artifacts.cli.getEmittedBin(),
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
    install_frontend.step.dependOn(&artifacts.frontend.step);

    b.getInstallStep().dependOn(&install_executable.step);
    b.getInstallStep().dependOn(&install_cli.step);
    b.getInstallStep().dependOn(&install_plist.step);
    b.getInstallStep().dependOn(&install_frontend.step);
}

fn addRunStep(b: *std.Build) void {
    const run = b.addSystemCommand(&.{b.getInstallPath(
        .prefix,
        "Rvw.app/Contents/MacOS/rvw-cli",
    )});
    if (b.args) |args| run.addArgs(args);
    run.step.dependOn(b.getInstallStep());
    b.step("run", "Build and launch the macOS app").dependOn(&run.step);
}
