# Application icon source

The editable browser source lives under `assets/icon/source`. Open
`assets/icon/source/index.html` in a browser, review the large source image and
small light/dark previews, then use **Download source PNG**. Save or move the
downloaded file to:

```text
assets/icon/rvw-icon-1024.png
```

The downloaded source image is a 1024×1024 PNG with an alpha channel and
transparent padding. Adjust the geometry, typography, or colors in
`source/icon.js`; the page presentation is kept separately in `source/icon.css`.

Generate the complete macOS iconset and distributable icon with:

```sh
node scripts/generate-icon.mjs
```

The command recreates the ignored `assets/icon/Rvw.iconset` directory and
writes `macos/Rvw.icns`. Commit the approved source image, any editable source, and
`macos/Rvw.icns`; do not commit the generated iconset directory.

When `macos/Rvw.icns` is present, `zig build install` automatically copies it
to `Rvw.app/Contents/Resources/Rvw.icns`. The bundle's `Info.plist` declares
`Rvw` as its icon. Builds continue to work without the generated file so the
source image can be reviewed before the distributable icon is committed.

Icon generation uses the macOS-native `sips` and `iconutil` commands and must
be run on macOS. Normal application builds do not run icon generation, so the
repository continues to build before the approved source image is supplied.
