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

Review a GitHub pull request with `rvw --pr 100 [DIR]`. The repository must have
an `origin` remote and GitHub head and merge refs for the PR. Rvw reuses cached
PR refs when present, or fetches them before launch. The review uses the merge
base and PR head without changing your checkout. The footer identifies the
working tree, commit range, or PR being reviewed.

## Usage

Open a Git repository with Rvw. Navigate the diff/files. Leave PR style comments. Export those comments to your clipboard. Paste to your preferred AI tool.

Rvw is built with Vim in mind. See the docs for [configuring the keybindings and user settings](./docs/configuration.md).

> Pre v1.0 holds comments in memory, and review sessions are not persisted. The Rvw app window is meant to be short lived (e.g. yank the comments and then close the window)

## Acknowledgements

- Rvw was inspired by [tuicr](https://tuicr.dev/)
- The frontend is centered around [pierre/diffs](https://diffs.com/) and [pierre/trees](https://trees.software/)

