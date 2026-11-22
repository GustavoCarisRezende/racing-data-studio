#!/usr/bin/env bash
set -euo pipefail

platform=$1
materials="$PWD/.release-materials"
manifest=app/src-tauri/Cargo.toml
mkdir "$materials"

case "$platform" in
  linux-x64)
    target=x86_64-unknown-linux-gnu
    about_asset=cargo-about-0.9.3-x86_64-unknown-linux-musl.tar.gz
    about_hash=3ad1e94ea1e63d69d1961f4fb15ccbbe9575d906111f96d2cb4dce6df48f71b4
    sbom_asset=cargo-cyclonedx-x86_64-unknown-linux-musl.tar.xz
    sbom_hash=528be9dd99ae522c3ee14fb881fd0cbf51767e8f12b74248f437e6a66b1a3c1b
    suffix=
    ;;
  windows-x64)
    target=x86_64-pc-windows-msvc
    about_asset=cargo-about-0.9.3-x86_64-pc-windows-msvc.tar.gz
    about_hash=9e2942533ef1c592c4a70bdb384cae1550a3f5fc9ae40379b6662e3d2f16fe02
    sbom_asset=cargo-cyclonedx-x86_64-pc-windows-msvc.zip
    sbom_hash=b0cdf58875a4b3c83e13fbea19eb6a85d63498aeab90f50456179173c370b3ce
    suffix=.exe
    ;;
  *) printf 'Unsupported platform: %s\n' "$platform" >&2; exit 1 ;;
esac

download_tool() (
  cd "$materials"
  local release_url=$1 archive=$2 digest=$3
  curl --fail --silent --show-error --location --retry 3 -o "$archive" "$release_url/$archive"
  printf '%s  %s\n' "$digest" "$archive" | sha256sum --check
  if [[ "$archive" == *.zip ]]; then
    python -m zipfile --extract "$archive" .
  else
    tar -xf "$archive"
  fi
)

download_tool https://github.com/EmbarkStudios/cargo-about/releases/download/0.9.3 "$about_asset" "$about_hash"
download_tool https://github.com/CycloneDX/cyclonedx-rust-cargo/releases/download/cargo-cyclonedx-0.5.10 "$sbom_asset" "$sbom_hash"
about=$(find "$materials" -type f -name "cargo-about$suffix" -print -quit)
sbom=$(find "$materials" -type f -name "cargo-cyclonedx$suffix" -print -quit)

cargo fetch --manifest-path "$manifest" --locked
"$about" about generate --manifest-path "$manifest" --target "$target" \
  --features tauri/custom-protocol --format json --fail --frozen > "$materials/cargo-about.json"
CARGO_NET_OFFLINE=true "$sbom" cyclonedx --manifest-path "$manifest" --target "$target" \
  --features tauri/custom-protocol --format json --spec-version 1.6 \
  --no-build-deps --override-filename release-rust
mv app/src-tauri/release-rust.json "$materials/rust.cdx.json"
(cd app && npm sbom --omit=dev --package-lock-only --sbom-format cyclonedx) > "$materials/frontend.cdx.json"
(cd packages && npm sbom --omit=dev --package-lock-only --sbom-format cyclonedx) > "$materials/sandbox.cdx.json"
cp release-notices.txt "$materials/JAVASCRIPT-NOTICES.txt"

args=()
if [[ "$platform" == linux-x64 ]]; then
  shopt -s nullglob
  images=(app/src-tauri/target/release/bundle/appimage/*.AppImage)
  if [[ "${#images[@]}" -ne 1 ]]; then
    printf 'Expected exactly one AppImage\n' >&2
    exit 1
  fi
  image="$PWD/${images[0]}"
  (cd "$materials" && env -u APPIMAGE_EXTRACT_AND_RUN "$image" --appimage-extract >/dev/null)
  args+=(--app-dir "$materials/squashfs-root")
fi
python -B scripts/release-materials.py --directory "$materials" --platform "$platform" "${args[@]}"
