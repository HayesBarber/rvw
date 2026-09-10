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

Right now (pre v1.0) the only supported installation method is to build from source with Zig 0.16 on MacOS:

```bash
zig build
```

There is a `system` flag that will place the app in `/Applications` and sysmlink the CLI to `/usr/local/bin/rvw`, but it requires `sudo` and is subject to being removed:


```bash
sudo zig build -Dsystem
```

Rvw uses a CLI to launch the GUI. After building the app, the CLI binary is located at  
`zig-out/Rvw.app/Contents/MacOS/rvw-cli`. For pre v1.0, it is recommended to symlink or alias this path.

> Note that the CLI resolves the GUI path via relative locations, so don't relocate it

CLI usage is as follows:

```bash
usage: rvw [DIR] [-r RANGE | --range RANGE]
       rvw -h | --help
```

## Usage

Open a Git repository with Rvw. Navigate the diff/files. Leave PR style comments. Export those comments to your clipboard. Paste to your preferred AI tool.

Rvw is built with Vim in mind. See the docs for [configuring the keybindings](./docs/keyboard.md).

> Pre v1.0 holds comments in memory, and review sessions are not persisted. The Rvw app window is meant to be short lived (e.g. yank the comments and then close the window)

## Acknowledgements

- Rvw was inspired by [tuicr](https://tuicr.dev/)
- The frontend is centered around [pierre/diffs](https://diffs.com/) and [pierre/trees](https://trees.software/)

