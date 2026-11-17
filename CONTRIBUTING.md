# Contributing to Rvw

## Opening an Issue First

Before submitting a PR, please **open a GitHub issue** to discuss the proposed change and get alignment.
This helps avoid wasted effort on changes that may not align with the project's direction.

## Prerequisites

- Zig 0.17.1
- Node.js and npm
- Xcode command-line tools (`xcrun swiftc`) for the macOS app

Make `git` available on `PATH` for development scripts and tests. Make `rg`
available on `PATH` for the text-search tests. The tests use stand-ins for
`gh`. For app use, see [executable paths](docs/configuration.md#executable-paths)
to set paths for Git, GitHub CLI, and ripgrep.

## Build from source

Run these commands from the repository root.

```bash
npm ci --prefix frontend
zig build
```

`npm ci` installs the frontend dependencies. `zig build` uses them to build
the frontend and puts it in `zig-out/Rvw.app`.

To launch the app, run `zig-out/Rvw.app/Contents/MacOS/rvw-cli` from your
checkout or pass a repository path. Keep the CLI inside the app bundle so it
can find the GUI.

## Development commands

Run these commands from the repository root.

| Command | Purpose |
| --- | --- |
| `zig build` | Build the macOS application bundle at `zig-out/Rvw.app`. |
| `zig build test` | Run Zig tests, frontend Node tests, and platform specific tests. |
| `zig build test-native-core` | Test the Swift request queue with the real Zig core on macOS. |
| `zig build dev -- --directory /path/to/repository` | Start the Zig HTTP server and Vite development server against a repository. Add `--range A..B` to review a commit range or `--pr 100` to review a GitHub PR. |
| `zig build serve -- serve --directory /path/to/repository` | Run only the Zig HTTP service. Add `--host` or `--port` as needed. |
| `npm run lint --prefix frontend` | Lint the React frontend. |
| `npm test --prefix frontend` | Run frontend unit tests. |
| `npm run build --prefix frontend` | Build frontend assets into `frontend/dist`. |
| `zig fmt src build` | Format Zig source files after backend or build-script changes. |

Without `--directory`, `zig build dev` selects a fixture repository (use
`--repo NAME` or `random` to choose one), creates an ephemeral Git worktree,
and fabricates staged and unstaged additions, modifications, and deletions for
reviewing. The worktree is removed when development stops. Set `RVW_PORT` to
use a different development port.

## Release builds

See [macOS releases](docs/releases.md) for signing credentials, local and CI
build commands, cleanup, and real artifact verification. Release preparation
requires the explicit `-Drelease=true` option.

## Tech stack

- **Zig:** application core, Git and filesystem providers, HTTP server, CLI, configuration, logging, and macOS C bindings.
- **Swift/AppKit/WebKit:** native macOS application shell and the bridge between the bundled frontend and Zig core.
- **React 19 and Vite:** review interface and local frontend development server.
- **Node.js:** frontend tooling plus build, development, and installation scripts.

## Architecture

The macOS app starts a review session and loads the bundled frontend. The
frontend sends JSON requests through the native bridge or, in development,
through the HTTP service. The dispatcher sends the requests to
`src/app/core.zig`. The core uses providers to read repository data and
manage comments.

- `src/app/` contains the request/response model, dispatcher, startup, and
  application core.
- `src/provider/` defines interfaces and implementations for repository data,
  text search, pull requests, and comments.
- `src/transport/http.zig` handles HTTP requests. `src/bindings/cabi.zig`
  exposes the core to the macOS app.
- `src/config/`, `src/log/`, and `src/output/` handle user configuration,
  structured logging, and clipboard/Markdown output.
- `frontend/src/review/` contains request helpers and review-session state.
  `frontend/src/actions/` handles UI actions. `frontend/src/components/`
  contains UI components.
- `macos/app/` contains application startup, menus, and window lifecycle code.
- `macos/bridge/` connects native requests to the Zig core.
- `macos/web/` handles bundled web assets and navigation.
- `macos/resources/` contains the application plist and icon.
- macOS tests are beside their source files. `macos/testing/` contains shared
  test helpers.
- `build/` contains the build scripts for the frontend, macOS bundle, and
  release artifacts.

Keep changes at the appropriate boundary: define new user operations in
`src/app/model.zig` and handle them in the core, keep provider-specific behavior
behind a provider interface, and place UI state or rendering in the frontend.
Include focused tests alongside the code you change, then run the relevant
commands above before opening a pull request.
