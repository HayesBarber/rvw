# macOS releases

Release preparation is opt-in. Ordinary `zig build` and
`zig build -Doptimize=ReleaseFast` require no release credentials. They do not
contact Apple or create a distribution ZIP.

## Prerequisites

Use a Mac with the project toolchain, Xcode command-line tools, and network
access to Apple. Release preparation requires an active Apple Developer Program
membership and owner-provided signing and notarization credentials.

1. Create a **Developer ID Application** certificate. Export the certificate
   and its private key from Keychain Access as a password-protected `.p12` file.
2. Create an App Store Connect **team API key** with access to notarization.
   Save its `.p8` private key, key ID, and issuer ID.
3. Set the environment variables below through a secure local environment or
   GitHub repository secrets. Use the same names for both.

| Environment variable / GitHub secret | Value |
| --- | --- |
| `RVW_CERTIFICATE_BASE64` | Base64 data from the exported `.p12` file. |
| `RVW_CERTIFICATE_PASSWORD` | Password for the `.p12` file. |
| `RVW_SIGNING_IDENTITY` | Full identity, such as `Developer ID Application: Your Name (ABCDEFGHIJ)`. |
| `RVW_NOTARY_KEY_BASE64` | Base64 data from the `.p8` private key. |
| `RVW_NOTARY_KEY_ID` | Ten-character team API key ID. |
| `RVW_NOTARY_ISSUER_ID` | Issuer UUID for that team API key. |

This implementation supports team API keys. It does not support individual API
keys, Apple ID passwords, or an existing keychain profile. Do not put credentials
in Zig `-D` options, source files, shell tracing, or build logs. A certificate
without its private key cannot sign the app. Invalid or missing credentials
cause release preparation to fail; there is no unsigned fallback.

To load base64 values from local files without printing them:

```sh
export RVW_CERTIFICATE_BASE64="$(base64 -i /secure/location/developer-id.p12)"
export RVW_NOTARY_KEY_BASE64="$(base64 -i /secure/location/AuthKey.p8)"
```

Set the other values with your secret manager or a private shell session.
Do not commit a credential environment file. Clear the variables when finished.
Apple tools require the certificate password and temporary keychain password
as process arguments. The script never prints these arguments or raw tool
output. Run it under a trusted local user or on an isolated CI runner.

## Local build

```sh
npm ci --prefix frontend
zig build -Drelease=true -Dversion=1.2.3 -Doptimize=ReleaseFast
```

The build assembles `zig-out/Rvw.app` before release preparation starts. The
script signs a private copy, so the installed development bundle and compiler
cache remain untouched. The script produces:

- `zig-out/release/Rvw-1.2.3.zip`: signed, notarized, stapled distribution.
- `zig-out/release/Rvw-1.2.3.zip.sha256`: SHA-256 checksum of that exact ZIP.
- `zig-out/release/Rvw-1.2.3.notary.json`: selected notarization diagnostics,
  including the submission ID and available issues. This is not a release asset.

`--prefix /absolute/path` moves these outputs to `/absolute/path/release`.
Versions must have a numeric `major.minor.patch`, with optional prerelease and
build suffixes. The CLI and ZIP retain the complete version. The bundle's
`CFBundleVersion` and `CFBundleShortVersionString` use the numeric portion.

The preflight step removes old ZIP, checksum, and diagnostic files for that
version before compilation starts. The release script repeats this check.
Release steps are never cached. Do not run concurrent builds in the same install
prefix or concurrent signing jobs under the same macOS user. The script locks
its release directory while it operates. The lock does not cover bundle assembly
between the preflight and release steps.

## Release process

Zig controls dependency order. `build/prepare-release.mjs` controls credentials,
signing, notarization, validation, packaging, and cleanup. The script:

1. Checks the host, configuration, and Apple tools.
2. Copies the complete app into a private working directory.
3. Finds nested Mach-O code and signs it before its containing bundle. The
   current app contains `Contents/MacOS/rvw-cli` and `Contents/MacOS/Rvw`.
4. Signs with Developer ID, secure timestamps, and hardened runtime.
5. Verifies the app and submits an intermediate ZIP with `notarytool --wait`.
   The wait has a 30-minute limit. A timeout fails the build; Apple can continue
   to process the submission. A later build makes a new submission.
6. Requires an `Accepted` result, then staples and validates the app ticket.
7. Creates the final ZIP, extracts it, and runs strict signature checks, ticket
   validation, and Gatekeeper assessment against the extracted app.
8. Computes the checksum from the final ZIP and completes cleanup. Any failure
   removes the ZIP and checksum and prevents the CI upload step.

No extra entitlements are applied. The current host uses system WebKit and links
its Zig core statically. Git, ripgrep, and clipboard operations use child
processes. Code inspection has not identified a need for a hardened-runtime
exception. This is a configuration to verify in the real release smoke test,
not proof that those operations work after signing. App Sandbox is not enabled.
Add an entitlement only if a real test identifies a required capability.

Apple references: [notarization requirements](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution),
[custom notarization workflow](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow),
and [hardened runtime](https://help.apple.com/xcode/mac/current/en.lproj/devf87a2ac8f.html).

## CI publication

The release workflow runs for `v*` tags. It removes the first `v` for the build
version: `v1.2.3` produces `Rvw-1.2.3.zip`. Configure all six repository secrets
before pushing a release tag. The workflow only sets up dependencies, supplies
configuration, calls the build, and publishes the ZIP and checksum. It does not
repackage the ZIP. The build command itself never publishes to GitHub.

## Cleanup and interrupted runs

The script creates `release/.release-lock` with mode `0700`. Credential files
inside it have mode `0600`. It records the original user keychain search list
before creating a temporary keychain. It restores that list and deletes the
temporary keychain on success, failure, SIGINT, and SIGTERM. It does not change
the default keychain. Do not change the keychain search list during a release.

A cleanup failure fails the build and removes distribution assets. The script
retains the original search-list file for recovery and attempts to remove all
secret files. An unhandled kill, power loss, or forced CI cancellation can prevent
cleanup. The next attempt refuses a remaining lock instead of assuming it is safe.

The workflow uses a disposable GitHub-hosted macOS runner. Forced cancellation
requires runner disposal, which GitHub provides. Before using a persistent or
self-hosted runner, add an external teardown procedure that performs the recovery
below even when the build process cannot run cleanup.

For local recovery, first confirm that no release process is still running.
Inspect `.release-lock/original-keychains.json`. Restore that recorded search
list with `security list-keychains -d user -s <each recorded path>`. Use each path
as a separate quoted argument. Delete the temporary keychain with:

```sh
security delete-keychain /absolute/path/release/.release-lock/release.keychain-db
```

If the keychain file no longer exists, skip deletion. If no search-list file
exists, the script had not started keychain creation. After recovery, remove the
`.release-lock` directory and its remaining files. Run the complete build again.
Do not upload assets left by an interrupted run.

## Validation and acceptance

Credential-free checks:

```sh
node --test build/prepare-release.test.mjs
zig build test
zig build -Doptimize=ReleaseFast
zig build -Drelease=true -Dversion=1.2.3 -Doptimize=ReleaseFast
```

With release variables unset, the last command must fail with a missing
configuration error. It must not create a ZIP. The focused tests simulate Apple
tool results and exercise order, failures, cleanup, interruption, diagnostics,
and retry behavior. They do not produce a valid signature or notarization ticket.

**Real signed-artifact acceptance is pending.** After renewal and credential
setup, run a complete release build. Keep the submission ID and validation
results in the PR. Check the resulting assets:

```sh
cd zig-out/release
shasum -a 256 -c Rvw-1.2.3.zip.sha256
ditto -x -k Rvw-1.2.3.zip /tmp/rvw-release-check
codesign --verify --deep --strict /tmp/rvw-release-check/Rvw.app
codesign --verify --strict /tmp/rvw-release-check/Rvw.app/Contents/MacOS/rvw-cli
xcrun stapler validate /tmp/rvw-release-check/Rvw.app
spctl --assess --type execute --verbose=2 /tmp/rvw-release-check/Rvw.app
```

Use a fresh extraction directory. Then download the ZIP through a browser on a
clean supported Mac so that the download has quarantine metadata. Confirm that
metadata with `xattr -l`, and do not remove it to bypass Gatekeeper. Perform these
native checks:

- Launch the downloaded app without an unidentified-developer bypass.
- Install the app and CLI through the normal installation path. Run
  `rvw /path/to/repository` and confirm that the GUI opens that repository.
- Load a file and a diff. Confirm that Git operations work.
- Create a comment, copy it, and paste it into another application.
- Confirm that text search works with the documented ripgrep dependency.

Record macOS version, CPU architecture, release version, and results. A passing
script test suite does not replace this real artifact test.
