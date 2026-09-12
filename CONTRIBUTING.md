# Contributing to Rvw

## Opening an Issue First

Before submitting a PR, please **open a GitHub issue** to discuss the proposed change and get alignment.
This helps avoid wasted effort on changes that may not align with the project's direction.

## Prerequisites

- Zig 0.16
- Node.js and npm
- Xcode command-line tools (`xcrun swiftc`) for the macOS app

Install frontend dependencies before building the app:

```bash
npm ci --prefix frontend
```

## Development commands

Run these commands from the repository root.

| Command | Purpose |
| --- | --- |
| `zig build` | Build the macOS application bundle at `zig-out/Rvw.app`. |
| `zig build test` | Run Zig tests, frontend Node tests, and platform specific tests. |
| `zig build dev -- --directory /path/to/repository` | Start the Zig HTTP server and Vite development server against a repository. Add `--range A..B` to review a commit range. |
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

## Tech stack

- **Zig:** application core, Git and filesystem providers, HTTP server, CLI, configuration, logging, and macOS C bindings.
- **Swift/AppKit/WebKit:** native macOS application shell and the bridge between the bundled frontend and Zig core.
- **React 19 and Vite:** review interface and local frontend development server.
- **Node.js:** frontend tooling plus build, development, and installation scripts.

## Architecture

The native application starts a local review session and hosts the bundled
frontend. The frontend sends JSON requests through its review API; the HTTP or
native transport decodes them and forwards them to `src/app/core.zig` through a
dispatcher. `Core` coordinates providers for Git diffs, repository files, and 
comments, then returns typed responses to the frontend.

Key areas of the repository:

- `src/app/` contains the request/response model, dispatcher, startup, and
  application core.
- `src/provider/` isolates Git diff, filesystem, and comment storage behind
  interfaces. Add integrations here rather than coupling them to the app core.
- `src/transport/` exposes the core through HTTP and Unix sockets.
- `src/config/`, `src/log/`, and `src/output/` handle user configuration,
  structured logging, and clipboard/Markdown output.
- `frontend/src/review/` owns request helpers and review-session state;
  `frontend/src/actions/` and `frontend/src/components/` implement UI behavior
  and presentation.
- `macos/` contains the Swift host, window lifecycle, WebKit handling, and
  native request bridge.
- `build/` assembles the macOS bundle and installation artifacts.

Keep changes at the appropriate boundary: define new user operations in
`src/app/model.zig` and handle them in the core, keep provider-specific behavior
behind a provider interface, and place UI state or rendering in the frontend.
Include focused tests alongside the code you change, then run the relevant
commands above before opening a pull request.
