# Implementation Plan: Homebrew install method (#133)

Add Homebrew support via the existing `HayesBarber/homebrew-tap`, remove the
`-Dsystem` option from `zig build`, and ship release zips with a `v*` tag
workflow.

## Findings from the codebase

- `rvw --version` reads an injected build option (`build.zig:8`, `src/main.zig:2`)
  defaulting to `dev`; release builds just pass `-Dversion=$VERSION`.
- The bundle (`zig-out/Rvw.app`) already contains both
  `Contents/MacOS/Rvw` and `Contents/MacOS/rvw-cli` (`build/macos.zig:126-172`).
- The CLI resolves the installed app through symlinks (`src/main.zig:148-151`),
  so a Homebrew `binary` symlink at
  `/usr/local/bin/rvw -> /Applications/Rvw.app/Contents/MacOS/rvw-cli` will work
  without code changes.
- The `-Dsystem` logic lives in `build/macos.zig:174-202`, with
  `build/system-install.mjs` and its Node test (`build/macos.zig:118-123`).
  `README.md:25-29` documents it.
- No `.github/` exists yet. Tags exist for all releases (e.g. `v1.0.0-alpha.5`),
  and all prior GitHub Releases have zero assets — the workflow must handle an
  existing release.
- Frontend uses a lockfile (`frontend/package-lock.json`), so
  `npm ci --prefix frontend` works on CI; `build/build-frontend.mjs` aborts if
  `node_modules` is missing.

## Changes — `rvw` repo

### 1. Remove `-Dsystem`

- `build/macos.zig`: delete the `system_install`,
  `application-destination`, and `cli-link-destination` options and the
  `install_system` step (lines 174-202); delete the `run_install_tests` Node
  test dependency (lines 118-123).
- Delete `build/system-install.mjs` and `build/system-install.test.mjs`.
- `README.md`: replace the `sudo zig build -Dsystem` section (lines 25-29) and
  the "only installation method is build from source" intro (line 19) with
  Homebrew instructions plus build-from-source as a fallback. Keep the
  `rvw-cli` path note for source builds.

### 2. Add `.github/workflows/release.yml` (new)

- Trigger: `push: tags: ['v*']` with `permissions: contents: write`, single
  job on `macos-latest`.
- Steps:
  1. `actions/checkout@v4`
  2. `mlugg/setup-zig@v2` with `version: 0.16.0` (defaults to the project's
     `minimum_zig_version` from `build.zig.zon` if omitted)
  3. `actions/setup-node@v4` (Node 22, npm cache on `frontend/package-lock.json`)
  4. `npm ci --prefix frontend`
  5. Extract version: `VERSION="${GITHUB_REF_NAME#v}"` and write to `GITHUB_ENV`
  6. `zig build -Dversion="$VERSION" -Doptimize=ReleaseFast`
  7. Package: `ditto -c -k --sequesterRsrc --keepParent zig-out/Rvw.app "Rvw-$VERSION.zip"`
  8. Print `shasum -a 256 "Rvw-$VERSION.zip"` for the manual cask update
  9. Upload: `gh release create "$GITHUB_REF_NAME" "Rvw-$VERSION.zip" --generate-notes`,
     falling back to `gh release upload "$GITHUB_REF_NAME" "Rvw-$VERSION.zip" --clobber`
     when the tag's release already exists (true for every current tag).

## Changes — `homebrew-tap` repo

### 3. Add `Casks/rvw.rb` (new dir `Casks/`)

Based on the starter from the issue, plus a `depends_on macos: ">= :sonoma"`.
The `sha256` ships as a placeholder and is filled in manually for each release.

```ruby
cask "rvw" do
  version "0.1.0"
  sha256 "..."            # fill from first release: shasum -a 256 Rvw-<version>.zip

  url "https://github.com/HayesBarber/rvw/releases/download/v#{version}/Rvw-#{version}.zip"

  name "Rvw"
  desc "Code review and annotation tool"
  homepage "https://github.com/HayesBarber/rvw"

  app "Rvw.app"
  binary "#{appdir}/Rvw.app/Contents/MacOS/rvw-cli", target: "rvw"
end
```

### 4. Update tap `README.md`

Add a "Casks" section listing `rvw`.

## Verification

- `zig build` and `zig build test` pass after removing the system-install path;
  `zig build -Dsystem` now errors as expected.
- Cut a test tag (e.g. `v0.4.0-test` or the next real tag) and confirm the
  workflow uploads `Rvw-<version>.zip` with a correct `rvw --version`.
- Update the cask's version and sha256 from that asset, then
  `brew audit --cask rvw` and `brew install --cask HayesBarber/tap/rvw`, and run
  `rvw` on a repository (unsigned-app Gatekeeper right-click-to-open caveat
  applies until signing is added later).

## Open decisions (resolved)

- **Optimize mode**: `ReleaseFast`.
- **Cask sha256**: placeholder until the first workflow-built release exists.

## Future work

- Apple Developer ID signing and notarization in the release workflow.
- Automating cask updates (e.g. `brew bump-cask-pr`) per release.