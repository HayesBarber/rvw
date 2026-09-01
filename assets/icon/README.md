# Application icon source

Place the approved 1024×1024 PNG master at:

```text
assets/icon/rvw-icon-1024.png
```

The master must be a PNG with an alpha channel. Keep any editable vector or
design source beside it when that source can be committed to the repository.

Generate the complete macOS iconset and distributable icon with:

```sh
node scripts/generate-icon.mjs
```

The command recreates the ignored `assets/icon/Rvw.iconset` directory and
writes `macos/Rvw.icns`. Commit the approved master, any editable source, and
`macos/Rvw.icns`; do not commit the generated iconset directory.

Icon generation uses the macOS-native `sips` and `iconutil` commands and must
be run on macOS. Normal application builds do not run icon generation, so the
repository continues to build before the approved master is supplied.
