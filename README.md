# rvw

rvw is a native macOS application and command-line launcher for reviewing a Git
working tree or commit range.

## Prerequisites

Building the application requires:

- macOS 14 or newer on Apple Silicon or Intel
- Xcode with its command-line tools selected (`xcode-select -p`)
- Zig 0.16.0
- Node.js 20.19+, 22.13+, or 24+ and npm

Install the pinned frontend dependencies once after cloning:

```sh
npm ci --prefix frontend
```

If those dependencies are absent, the build stops with the command needed to
install them. Missing build tools are reported by Zig as failed system commands;
the installer does not download prebuilt executables or other release assets.

## Staged installation

The default install is local to the checkout:

```sh
zig build install
```

It builds the frontend, Zig core and CLI, and Swift native host, then creates the
complete application at `zig-out/Rvw.app`. It does not write to `/Applications`,
`/usr/local/bin`, or any other system location. Rebuilding replaces the staged
bundle, including its frontend resource directory, so obsolete content-hashed
assets are removed.

Run a working-tree review from the staged application with:

```sh
zig build run -- /path/to/repository
```

Pass a commit range with `--range` (or `-r`):

```sh
zig build run -- /path/to/repository --range main..feature
```

## System installation

System mode is opt-in:

```sh
zig build install -Dsystem=true
```

By default this replaces `/Applications/Rvw.app` and creates
`/usr/local/bin/rvw` as an absolute symlink to
`/Applications/Rvw.app/Contents/MacOS/rvw-cli`. The CLI resolves the installed
bundle even when invoked through that symlink:

```sh
rvw /path/to/repository
rvw /path/to/repository --range main..feature
```

Both destination directories must already exist and be writable by the current
user. You can check them before installing:

```sh
test -w /Applications
test -w /usr/local/bin
```

If either check fails, deliberately correct that directory's ownership or
permissions using your machine's administration policy, or use the overrides
below. The build reports the unwritable directory and never invokes `sudo` or
performs hidden privilege escalation.

The installer replaces only an existing application with bundle identifier
`dev.rvw.app`. It refreshes an existing CLI symlink only when that symlink
already targets the CLI at the requested application destination. It refuses to
overwrite any other application, a regular file at the CLI path, or an unrelated
symlink; move or remove such an item explicitly before retrying.

To install into nonstandard or temporary locations, override both destinations
with absolute paths. Their parent directories must exist:

```sh
install_root="$(mktemp -d)"
mkdir -p "$install_root/Applications" "$install_root/bin"
zig build install -Dsystem=true \
  -Dapplication-destination="$install_root/Applications/Rvw.app" \
  -Dcli-link-destination="$install_root/bin/rvw"
```

The application is copied into a temporary sibling before it replaces the
current bundle. Repeated installs replace the complete bundle and CLI symlink,
preventing interrupted copies and stale frontend files from accumulating.

## V1 bundle-size baseline

On 2026-08-31, a clean default (Debug, arm64) overridden system install contained
324 files and occupied 16,940 KiB. An immediate incremental system install had
the same manifest and occupied the same 16,940 KiB. The main baseline costs were
11,688 KiB of bundled frontend resources (syntax grammars and themes), 3,136 KiB
for the native host, and 2,112 KiB for the bundled CLI. Release optimization can
change these numbers; repeat installs should not grow when their inputs are
unchanged.

## Tests

Run the Zig, CLI, native host, and system-installer tests with:

```sh
zig build test
```

Run the frontend tests and lint checks with:

```sh
npm test --prefix frontend
npm run lint --prefix frontend
```
