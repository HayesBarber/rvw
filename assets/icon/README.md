# Application icon source

The editable browser source lives under `assets/icon/source`. Open
`assets/icon/source/index.html` in a browser, review the large master and small
light/dark previews, then use **Download master PNG**. Save or move the
downloaded file to:

```text
assets/icon/rvw-icon-1024.png
```

The downloaded master is a 1024×1024 PNG with an alpha channel and transparent
padding. Adjust the geometry, typography, or colors in `source/icon.js`; the
page presentation is kept separately in `source/icon.css`.

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
