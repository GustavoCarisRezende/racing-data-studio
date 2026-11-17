# Releases and automatic updates

## Implementation status

Implemented in the working tree:

- Explicit application icons for Linux and Windows packaging.
- A manually triggered/tag-triggered GitHub Actions candidate build for Linux x64
  (AppImage and a tar.gz containing it) and Windows x64 (NSIS EXE and WiX MSI).
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
Windows Installer has numeric-version constraints; verify MSI beta-to-beta
upgrade identity/version handling separately. EXE is the planned primary
Windows updater target, not an untested MSI→EXE migration.
The WiX UpgradeCode is pinned to the value reported by `tauri inspect wix-upgrade-code`;
NSIS uses per-user installation. Choose one installer format; do not install both
as though they were a single managed installation.

## Maintainer setup: signing

1. The maintainer generates a Tauri signing key outside the repository:
   `npm run tauri signer generate -- -w <private-location>/rds-updater.key`
   from `app/`. Do not paste private keys into issues, chat, or source files.
2. Store the private key/password as GitHub Actions secrets
   `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
   The private-key secret contains the key file's full content, not a local path.
   Store the public key's content as repository variable `TAURI_UPDATER_PUBLIC_KEY`.
   The signed-build overlay embeds it in the application. Losing the private key
   can prevent upgrades of installations trusting its public key.
3. `prepare-updater.py` validates the public-key format and generates
   `tauri.release.generated.json`; it writes no private key. The signed workflow
   enables `bundle.createUpdaterArtifacts` and `requireSignedVersion`.
   Updater signatures do not replace Windows
   Authenticode signing or guarantee SmartScreen reputation.
4. Configure required reviewers on GitHub environments `release-signing`, `release`, and
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

The remote branch and feeds have **not** been created by this implementation.
Create the dedicated `updates` branch before running promotion, with no secrets
and only public channel metadata (an initial README is enough). Do not use GitHub's
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

## Release gate

- [ ] Validate clean install and update between two signed disposable versions.
- [ ] Test bad signatures, no network, interrupted downloads, and unwritable paths.
- [ ] Test Linux AppImage (including extracted tar.gz), EXE→EXE, and MSI behavior.
- [ ] Preserve imports, models, preferences, and database migration behavior.
- [ ] Confirm beta/stable isolation and no automatic downgrades.
- [ ] Review native dependency licenses, notices, SBOM, and Windows signing status.
- [ ] Require explicit maintainer approval before release/channel publication.

See the [official Tauri updater documentation](https://v2.tauri.app/plugin/updater/).
