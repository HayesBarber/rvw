<h1 align="center">Rvw</h1>

<p align="center">
  Rvw (Review) is a code review and annotation tool designed for fast iteration with AI agents during development
</p>

<p align="center">
  <img width="130" alt="Rvw" src="./assets/icon/rvw-rounded.png"/>
</p>

<p align="center">
  <b><a href="#installation">Installation</a></b> | <b><a href="#usage">Usage</a></b> | <b><a href="./docs">Documentation</a></b>
</p>

<img src="./assets/screenshot.png" alt="Rvw" width="100%"/>

## Installation

Via Homebrew:

```bash
brew install --cask HayesBarber/tap/rvw
```

Or build from source (see [CONTRIBUTING.md](./CONTRIBUTING.md) for prerequisites):

```bash
npm ci --prefix frontend
zig build
```

Rvw uses a CLI to launch the GUI. After building the app, the CLI binary is located at
`zig-out/Rvw.app/Contents/MacOS/rvw-cli`, and the installed cask exposes it as the `rvw` command.

> Note that the CLI resolves the GUI path via relative locations, so don't relocate it

CLI usage is as follows:

```bash
usage: rvw [DIR] [-r RANGE | --range RANGE | --pr NUMBER] [--log-level LEVEL]
       rvw -h | --help
       rvw -v | --version
```

## Codebase text search prerequisite

The text-search API requires a local [ripgrep](https://github.com/BurntSushi/ripgrep)
installation. Rvw does not bundle ripgrep. On macOS, install it with:

```bash
brew install ripgrep
```

Rvw finds `rg` on its process `PATH`. To select an executable explicitly, set
`RVW_RIPGREP` to its absolute path before you start Rvw. This also works when the
GUI does not inherit your shell's `PATH`:

```bash
RVW_RIPGREP=/opt/homebrew/bin/rg rvw .
```

The HTTP server uses the same environment variable. The selected file must be
executable. Search reports an error if Rvw cannot find or run it. Other review
operations do not require ripgrep.

Search uses case-sensitive literal text and starts at the opened directory.
Normal mode uses ripgrep's ignore rules and skips hidden files. All-files mode
uses `--no-ignore --hidden` to include ignored and hidden files. Neither mode
follows symbolic links. Ripgrep configuration files are disabled for consistent
API behavior. Files with non-UTF-8 paths or matching lines are omitted.

Each response contains at most 1,000 matching lines. Process output is limited
to 4 MiB for standard output and 4 KiB for errors. A result or standard-output
limit sets `truncated` to `true`; only complete match records are returned.
An error-output limit produces a search error. Narrow the query if results are
truncated. The search modal is tracked separately in issue #186.

## Usage

Open a Git repository with Rvw. Navigate the diff/files. Leave PR style comments. Export those comments to your clipboard. Paste to your preferred AI tool.

Rvw is built with Vim in mind. See the docs for [configuring the keybindings and user settings](./docs/configuration.md).

> Pre v1.0 holds comments in memory, and review sessions are not persisted. The Rvw app window is meant to be short lived (e.g. yank the comments and then close the window)

## Acknowledgements

- Rvw was inspired by [tuicr](https://tuicr.dev/)
- The frontend is centered around [pierre/diffs](https://diffs.com/) and [pierre/trees](https://trees.software/)
