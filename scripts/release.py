#!/usr/bin/env python3
"""Release preparation helpers. No network access or publication side effects."""

import argparse
import hashlib
import json
import re
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VERSION = re.compile(r"(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-beta\.([1-9]\d*))?")
WINDOWS_INSTALLER_EXTENSIONS = {"nsis": ".exe", "msi": ".msi"}


def version_files(root):
    return {
        "package": root / "app/package.json",
        "lock": root / "app/package-lock.json",
        "tauri": root / "app/src-tauri/tauri.conf.json",
        "cargo": root / "app/src-tauri/Cargo.toml",
        "cargo_lock": root / "app/src-tauri/Cargo.lock",
    }


def validate_version(version):
    if not VERSION.fullmatch(version):
        raise ValueError("Expected X.Y.Z or X.Y.Z-beta.N, without a leading v")
    major, minor, patch = map(int, version.split("-")[0].split("."))
    # Windows Installer uses a three-component numeric product version.
    if major > 255 or minor > 255 or patch > 65535:
        raise ValueError("Version exceeds Windows Installer numeric limits")
    return version


def bundle_formats(platform, version):
    validate_version(version)
    if platform == "linux-x64":
        return ("appimage",)
    # WiX requires numeric pre-release components, unlike the app's beta.N suffix.
    return ("nsis",) if "-beta." in version else ("nsis", "msi")


def read_versions(root=ROOT):
    paths = version_files(root)
    package = json.loads(paths["package"].read_text())
    lock = json.loads(paths["lock"].read_text())
    tauri = json.loads(paths["tauri"].read_text())
    cargo = paths["cargo"].read_text()
    cargo_lock = paths["cargo_lock"].read_text()
    manifest = re.search(r'(?m)^version = "([^"]+)"', cargo)
    locked = re.search(
        r'\[\[package\]\]\nname = "racing-data-studio"\nversion = "([^"]+)"', cargo_lock
    )
    if not manifest or not locked:
        raise ValueError("Application version not found in Cargo files")
    return {
        "package": package["version"],
        "lock": lock["version"],
        "lock_root": lock["packages"][""]["version"],
        "tauri": tauri["version"],
        "cargo": manifest[1],
        "cargo_lock": locked[1],
    }


def check_version(expected=None, root=ROOT):
    versions = read_versions(root)
    version = expected or versions["tauri"]
    validate_version(version)
    if any(v != version for v in versions.values()):
        raise ValueError(f"Version mismatch: expected {version}; found {versions}")
    return version


def set_version(version, root=ROOT):
    validate_version(version)
    paths = version_files(root)
    # Read/validate every file before writing anything.
    read_versions(root)
    replacements = {}
    for name in ("package", "lock", "tauri"):
        path = paths[name]
        text = path.read_text()
        # Keep existing formatting and dependency versions intact.
        text = re.sub(r'("version"\s*:\s*")[^"]+(")', rf'\g<1>{version}\2', text, count=1)
        if name == "lock":
            text = re.sub(
                r'("packages"\s*:\s*\{\s*""\s*:\s*\{.*?"version"\s*:\s*")[^"]+(")',
                rf'\g<1>{version}\2', text, count=1, flags=re.S,
            )
        replacements[path] = text
    replacements[paths["cargo"]] = re.sub(
        r'(?m)^version = "[^"]+"', f'version = "{version}"',
        paths["cargo"].read_text(), count=1,
    )
    replacements[paths["cargo_lock"]] = re.sub(
        r'(\[\[package\]\]\nname = "racing-data-studio"\nversion = ")[^"]+(")',
        rf'\g<1>{version}\2', paths["cargo_lock"].read_text(), count=1,
    )
    for path, text in replacements.items():
        path.write_text(text)
    check_version(version, root)


def linux_archive(appimage, output, version, notices, root=ROOT, materials=None):
    """Package an AppImage, not a misleading supposedly portable raw ELF."""
    validate_version(version)
    appimage, output, notices = map(Path, (appimage, output, notices))
    if not appimage.is_file() or not notices.is_file():
        raise ValueError("AppImage and generated third-party notices must exist")
    if not appimage.name.endswith(".AppImage"):
        raise ValueError("Expected an .AppImage")
    with appimage.open("rb") as source:
        if source.read(4) != b"\x7fELF":
            raise ValueError("AppImage must be an ELF executable")
        source.seek(8)
        if source.read(3) != b"AI\x02":
            raise ValueError("Expected a type-2 AppImage")
        source.seek(18)
        if source.read(2) != b"\x3e\x00":
            raise ValueError("Expected an x86-64 AppImage")
    output.mkdir(parents=True, exist_ok=True)
    name = f"racing-data-studio_{version}_linux_x64"
    archive = output / f"{name}.tar.gz"
    # No database, user configuration, or arbitrary working-tree files.
    with tarfile.open(archive, "w:gz") as tar:
        info = tar.gettarinfo(str(appimage), arcname=f"{name}/RacingDataStudio.AppImage")
        info.mode = 0o755
        with appimage.open("rb") as source:
            tar.addfile(info, source)
        tar.add(root / "LICENSE", arcname=f"{name}/LICENSE", recursive=False)
        tar.add(notices, arcname=f"{name}/THIRD-PARTY-NOTICES.txt", recursive=False)
        if materials is not None:
            tar.add(materials, arcname=f"{name}/{materials.name}", recursive=False)
        tar.add(root / "docs/en-US/LINUX_TEST_BUILD.md", arcname=f"{name}/README.en-US.md", recursive=False)
        tar.add(root / "docs/pt-BR/LINUX_TEST_BUILD.md", arcname=f"{name}/README.pt-BR.md", recursive=False)
    return archive


def checksums(directory):
    directory = Path(directory)
    files = sorted(p for p in directory.iterdir() if p.is_file() and p.name != "SHA256SUMS")
    if not files:
        raise ValueError("No artifacts to checksum")
    lines = []
    for path in files:
        digest = hashlib.sha256()
        with path.open("rb") as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(chunk)
        lines.append(f"{digest.hexdigest()}  {path.name}\n")
    (directory / "SHA256SUMS").write_text("".join(lines))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    check = sub.add_parser("check")
    check.add_argument("--version")
    update = sub.add_parser("version")
    update.add_argument("version")
    bundles = sub.add_parser("bundles")
    bundles.add_argument("--platform", choices=("linux-x64", "windows-x64"), required=True)
    archive = sub.add_parser("linux-archive")
    archive.add_argument("--appimage", required=True)
    archive.add_argument("--output", required=True)
    archive.add_argument("--version", required=True)
    archive.add_argument("--notices", required=True)
    sha = sub.add_parser("checksums")
    sha.add_argument("directory")
    args = parser.parse_args()
    try:
        if args.command == "check":
            print(check_version(args.version))
        elif args.command == "version":
            set_version(args.version)
            print(check_version(args.version))
        elif args.command == "bundles":
            print(",".join(bundle_formats(args.platform, check_version())))
        elif args.command == "linux-archive":
            print(linux_archive(args.appimage, args.output, args.version, args.notices))
        else:
            checksums(args.directory)
    except (ValueError, OSError, KeyError) as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    main()
