# Releases and automatic updates

## Implementation status

Implemented in the working tree:

- Explicit application icons for Linux and Windows packaging.
- A manually triggered/tag-triggered GitHub Actions candidate build for Linux x64
  (AppImage and a tar.gz containing it) and Windows x64 (NSIS EXE for beta and
  stable versions, WiX MSI for stable versions).
- Synchronized application-version checks and a version-setting tool.
- Whitelisted packaging, notices, checksums, and an update-manifest preparation tool.
- Unit tests for versioning, packaging, and manifest preparation.
- Native Tauri updater with a fixed beta/stable endpoint, signed-version checking,
  HTTPS-only bounded downloads, progress, and explicit installation/restart.
- PT-BR/en-US update dialog, manual menu action, background checks, and opt-in
  automatic downloads. Dirty edits block installation; the native synchronization
  gate and cooperative file lock prevent racing synchronization/reset.
- Signed release-draft and separately approved update-channel workflows.

**Production activation still requires the maintainer's public key and signing
secrets.** Without a public key, local builds do not check the network for updates.
Debug builds, raw Linux executables, non-x64 platforms, and MSI installations do
not self-update in this initial integration. AppImage and Windows NSIS are supported
targets; MSI remains a manual installer to avoid unvalidated MSI→EXE migrations.
Windows builds, GitHub workflows, and actual signed cross-version installation
must still be validated on their target systems before public distribution.

## Release candidates

A candidate is the set of installers built from a known commit for testing
before publication. Under **Actions → Build desktop candidate**, select
**Run workflow** and choose the branch to test. After the run, download the
packages under **Artifacts**. This workflow produces builds without updater
signatures. **Prepare signed release draft** builds signed candidates from a tag
and uploads the files to a release draft. The [beta guide](BETA.md) describes the
downloads for testers.

## Local Linux test build

See [Linux test build instructions](LINUX_TEST_BUILD.md). The initial local test
artifact was compiled as `0.1.0`, before adopting the public beta numbering.
It is not a release and cannot automatically update. Local builds use the host's
system-library baseline; the CI Linux candidate uses Ubuntu 22.04.

From the repository root, after installing the prerequisites in
[development](DEVELOPMENT.md):

```sh
cd packages
npm run build
npm run notices --silent > ../release-notices.txt
cd ../app
npm run tauri build -- --bundles appimage --config '{"bundle":{"active":true}}' -- --locked
cd ..
python3 -B scripts/collect-candidate.py --platform linux-x64
```

Apply the resource limits from the development guide when running native builds.
`artifacts/` must be empty: the collector refuses to mix old and new candidates.
Move an earlier candidate elsewhere rather than deleting unknown files.
The collector only includes explicit artifact paths, notices, instructions, and
LICENSE; it never archives the repository or application data directories.
Generated notices currently cover the JavaScript packages, not a complete native
dependency inventory. Complete the Rust/bundled-system-library license and SBOM
review before public distribution.

## Versioning

Public name: **Racing Data Studio 0.0.1 Beta**.
Technical version/tag: `0.0.1-beta.1` / `v0.0.1-beta.1`.
Use `beta.2`, `beta.3`, etc., followed by `0.0.1` for the stable release.

```sh
python3 -B scripts/release.py version 0.0.1-beta.1
python3 -B scripts/release.py check --version 0.0.1-beta.1
python3 -B -m unittest discover -s scripts/tests -v
```

The tool updates only the application package, npm lock root, Tauri config, Cargo
manifest, and application Cargo lock entry. Independent package versions stay
unchanged. The candidate workflow checks that a tag matches all application
versions. Creating/pushing a tag is an explicit publication-process action;
these instructions do not create one automatically.

`0.0.1-beta.1` is lower than the old development version `0.1.0`; existing
development installations cannot discover it through a normal upgrade comparison.
Beta builds produce the `*-setup.exe` installer with NSIS for per-user
installation and automatic updates. The MSI (WiX) is reserved for stable
versions because WiX requires numeric version components. It has a fixed
UpgradeCode and its installation and upgrades follow a separate manual process.

## Maintainer setup: signing

1. From `app/`, generate the key pair in a private directory outside the
   repository with `npm run tauri signer generate -- -w "$HOME/.tauri/rds-updater.key"`.
   Enter a strong password at the prompt. You can generate a random
   64-character hexadecimal password with `openssl rand -hex 32` in a private
   terminal or use a password manager. Tauri generates the keys and uses the
   password to protect the private key. Keep a safe copy of the private key and
   password to maintain compatibility with existing installations.
2. Under **Settings → Secrets and variables → Actions → Variables**, create the
   repository variable `TAURI_UPDATER_PUBLIC_KEY` containing `rds-updater.key.pub`.
3. Under **Settings → Environments → release-signing**, create the secrets
   `TAURI_SIGNING_PRIVATE_KEY` (the full contents of `rds-updater.key`) and
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (the password used during key generation).
4. `prepare-updater.py` validates the public-key format and generates
   `tauri.release.generated.json`; it writes no private key. The signed workflow
   enables `bundle.createUpdaterArtifacts` and `requireSignedVersion`.
   Updater signatures do not replace Windows
   Authenticode signing or guarantee SmartScreen reputation.
5. Configure required reviewers on GitHub environments `release-signing`, `release`, and
   `update-channel`. Creating these names in YAML does not itself enforce approval.
   Restrict workflow/tag changes and access to signing secrets to maintainers.

No workflow generates signing keys. Unsigned candidates are deliberately not
updater-ready. Private keys must never be committed or sent to the application.

## Publication and channel promotion

Use public GitHub Releases for immutable, version-specific artifact URLs:

```text
https://github.com/GustavoCarisRezende/racing-data-studio/releases/download/v0.0.1-beta.1/<asset>
```

Keep separate static manifests in a dedicated `updates` branch:

```text
https://raw.githubusercontent.com/GustavoCarisRezende/racing-data-studio/updates/beta.json
https://raw.githubusercontent.com/GustavoCarisRezende/racing-data-studio/updates/stable.json
```

The dedicated `updates` branch starts with a README. The promotion workflow
creates or updates a channel manifest after the release is published. Do not use GitHub's
`releases/latest` endpoint for beta discovery; it excludes pre-releases.
No GitHub token belongs in a publicly distributed app.

1. Commit reviewed code and push an existing version tag matching every application
   manifest. Do not tag an uncommitted working tree.
2. Run **Prepare signed release draft**, selecting that tag. It builds both
   platforms, verifies candidate checksums, signs artifacts, and creates a draft.
   It refuses to overwrite an existing release. Review the draft and release notes.
3. Test installation/update, then explicitly publish the draft as a pre-release
   for beta (the workflow never publishes it).
4. Run **Promote published release to update channel** from the matching version
   ref, selecting the tag/channel. It downloads published assets, checks metadata,
   verifies signatures using minisign and the trusted public key, verifies the
   signed version, rejects non-increasing versions, and pushes only the complete
   channel JSON. Promotions are serialized. A stable release may also be promoted
   to `beta` so testers can graduate; a beta may never enter `stable`.

For local manifest preparation, with `minisign` installed and
`TAURI_UPDATER_PUBLIC_KEY` set:

```sh
python3 -B scripts/update-feed.py --version 0.0.1-beta.1 --channel beta \
  --assets downloaded-release-assets --release-json published-release.json \
  --previous previous-beta.json --output beta.candidate.json
```

`published-release.json` is the GitHub release API response, not a handcrafted
claim of publication. The helper requires both Linux AppImage and Windows EXE,
their signatures, exact published URLs, matching sizes, and uploaded asset states.
The CLI requires cryptographic verification, including the signed version, before
writing a manifest. The helper itself never uploads/promotes a feed; only the
separately approved workflow does that.

## Application behavior

The native layer fixes endpoints, public key, target, and download URLs. Frontend
IPC cannot select arbitrary URLs or bypass verification; plugin IPC is not granted.
Both download and install verify signatures with `requireSignedVersion`, preventing
relabeling an old signed artifact as a newer release.

Checks start five seconds after opening and repeat every six hours while running;
manual requests also have a native 60-second cooldown. Checks time out after
15 seconds. Downloads use HTTPS (including redirects), a 180-second timeout and a
512 MiB ceiling even without Content-Length. Downloaded bytes are held in memory,
not restored across restarts. A verification failure never becomes installable.

Automatic download defaults off and is stored locally when enabled. Installation
is never automatic: open the update dialog, save pending edits, select
**Install and restart**, then confirm. Windows exits when launching the installer;
Linux replaces the writable AppImage and restarts. Imported data, templates, and
preferences are not reset. Linux needs write access to the AppImage location.
Offline checks fail without blocking local use or opening unsolicited dialogs.

## Installation and update validation

On pull requests, **Check desktop changes** builds the frontend and runs the
JavaScript, Rust and Python suites on Linux and Windows. Candidate builds use the
same validation action before packaging installers.
On Windows, it also silently installs and uninstalls the generated EXE
on the disposable runner.

On Linux x64, the following test takes two increasing AppImage versions signed
with the same disposable key. It verifies that a mismatched version is rejected,
uses the Tauri updater to replace a disposable copy of the AppImage and reopens
SQLite to check snapshots and templates.

```sh
RDS_SMOKE_CURRENT_APPIMAGE=/path/previous-version.AppImage \
RDS_SMOKE_NEXT_APPIMAGE=/path/new-version.AppImage \
RDS_SMOKE_CURRENT_VERSION=0.0.1-beta.1 \
RDS_SMOKE_NEXT_VERSION=0.0.1-beta.2 \
RDS_SMOKE_UPDATER_KEY=/path/test-key.pub \
cargo test --manifest-path app/src-tauri/Cargo.toml --locked \
  updates::tests::installs_signed_appimage_without_changing_local_data -- --ignored --exact
```

To validate the interface, network and restart, use disposable virtual machines
for AppImage and NSIS and signed builds from a staging repository with its own
update URLs. On the earlier version, create test data and a model, note the
active snapshot and export a backup. Run **Check for updates** and **Install and
restart**. After reopening the app, verify the new version, model, active
snapshot and query results. On Windows, test clean installation and EXE-to-EXE
updates. For stable versions, also test the MSI separately. Record the tested
versions and platforms.

## Release gate

- [ ] Validate clean install and update between two signed disposable versions.
- [ ] Test bad signatures, no network, interrupted downloads, and unwritable paths.
- [ ] Test Linux AppImage (including extracted tar.gz) and EXE→EXE. Test MSI for stable versions.
- [ ] Preserve imports, models, preferences, and database migration behavior.
- [ ] Confirm beta/stable isolation and no automatic downgrades.
- [ ] Review native dependency licenses, notices, SBOM, and Windows signing status.
- [ ] Require explicit maintainer approval before release/channel publication.

See the [official Tauri updater documentation](https://v2.tauri.app/plugin/updater/).
