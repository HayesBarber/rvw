# macOS releases

Release preparation requires macOS, Xcode command-line tools, Node.js, Zig 0.16,
an active Apple Developer Program account, and network access to Apple. Ordinary
`zig build` remains credential-free.

## Configure credentials

Create a Developer ID Application certificate. Export the certificate **with its
private key** from Keychain Access as a password-protected `.p12` file. Create an
App Store Connect **team API key** and download its `.p8` file. Record its key ID
and issuer ID. Keep both files outside the repository.

Set these environment variables for a local build. Set GitHub repository secrets
with the same names before pushing a release tag.

| Name | Value |
| --- | --- |
| `RVW_CERTIFICATE_BASE64` | Base64-encoded `.p12` file. |
| `RVW_CERTIFICATE_PASSWORD` | `.p12` password. |
| `RVW_SIGNING_IDENTITY` | Full name, such as `Developer ID Application: Your Name (ABCDEFGHIJ)`. |
| `RVW_NOTARY_KEY_BASE64` | Base64-encoded `.p8` team API key. |
| `RVW_NOTARY_KEY_ID` | Ten-character team API key ID. |
| `RVW_NOTARY_ISSUER_ID` | Team API issuer UUID. |

On macOS, `base64 -i /secure/path/file.p12` and
`base64 -i /secure/path/AuthKey.p8` produce the encoded values. Use
`security find-identity -v -p codesigning` to find the full signing name.
Do not pass credentials as Zig `-D` values, commit them, or enable shell tracing
while loading them. The script selects the certificate imported from the `.p12`
by hash, even if another certificate has the same name in the login keychain.

## Build and publish

```sh
npm ci --prefix frontend
zig build -Drelease=true -Dversion=1.2.3 -Doptimize=ReleaseFast
```

The build writes `zig-out/release/Rvw-1.2.3.zip`,
`Rvw-1.2.3.zip.sha256`, and `Rvw-1.2.3.notary.json`. The JSON file contains the
Apple submission ID and available diagnostics. The ZIP contains a signed,
notarized, stapled app and bundled CLI. Use a numeric `major.minor.patch`
version, with an optional prerelease or build suffix. `--prefix` changes the
output root.

The GitHub release workflow runs on `v*` tags. It removes the leading `v` to
set the build version, then publishes the ZIP and checksum produced by the
build. For example, `v1.2.3` publishes `Rvw-1.2.3.zip` and its checksum.
A local build does not publish a GitHub release.

The script signs a private copy after bundle assembly. It signs nested code
first, uses secure timestamps and hardened runtime, submits an intermediate ZIP
to Apple, staples the accepted ticket, and verifies the extracted final ZIP
before writing its checksum. A failed step removes the ZIP and checksum.
Release steps run on every release build; old assets do not count as a new
release. Run builds that use the same output prefix and macOS user serially.

## Verify an artifact

The release script checks the signature, stapled ticket, and Gatekeeper result
for a fresh extraction. To repeat those checks:

```sh
cd zig-out/release
shasum -a 256 -c Rvw-1.2.3.zip.sha256
check_dir="$(mktemp -d)"
ditto -x -k Rvw-1.2.3.zip "$check_dir"
codesign --verify --deep --strict "$check_dir/Rvw.app"
codesign --verify --strict "$check_dir/Rvw.app/Contents/MacOS/rvw-cli"
xcrun stapler validate "$check_dir/Rvw.app"
spctl --assess --type execute --verbose=2 "$check_dir/Rvw.app"
```

Run the bundled CLI against a Git repository to check app launch, file and diff
loading, Git operations, text search, and copying comments. A browser download
on a clean supported Mac checks the quarantined first-launch experience.

## Recover an interrupted build

The script creates `zig-out/release/.release-lock` and a temporary keychain. It
restores the prior user keychain search list and removes temporary credentials
on success, failure, SIGINT, and SIGTERM. The next build refuses a remaining
lock. A forced kill or power loss can require manual recovery.

First confirm that no release process is running. Read
`.release-lock/original-keychains.json`, then restore its paths with
`security list-keychains -d user -s`, using one quoted argument per path. Delete
`.release-lock/release.keychain-db` with `security delete-keychain` if it exists.
Remove `.release-lock` and rerun the build. Do not upload an interrupted run's
assets. GitHub-hosted runners are disposable; a persistent runner needs an
external teardown step for forced cancellation.

See [Apple's notarization documentation](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)
for the Developer ID and notarization requirements.
