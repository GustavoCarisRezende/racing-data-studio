#!/usr/bin/env python3
"""Package license and inventory evidence without publishing build-machine paths."""

import argparse
import json
import shutil
import subprocess
import zipfile
from collections import defaultdict
from pathlib import Path
from urllib.parse import quote

from release import ROOT, check_version

REPOSITORY = "https://github.com/GustavoCarisRezende/racing-data-studio"


def rust_materials(directory, version):
    report_path = directory / "cargo-about.json"
    report = json.loads(report_path.read_text(encoding="utf-8"))
    notices = directory / "RUST-NOTICES.txt"
    sources = set()
    with notices.open("w", encoding="utf-8", newline="\n") as output:
        for license_record in report["licenses"]:
            crates = {(item["crate"]["name"], item["crate"]["version"]) for item in license_record["used_by"]}
            names = ", ".join(f"{name} {version}" for name, version in sorted(crates))
            output.write(f'{license_record["id"]} | {names}\n\n{license_record["text"].strip()}\n\n')
            if license_record["id"] == "MPL-2.0":
                sources.update(crates)
        if sources:
            output.write("Source archives for Rust crates distributed under MPL-2.0\n\n")
            for name, crate_version in sorted(sources):
                output.write(f"https://static.crates.io/crates/{name}/{name}-{crate_version}.crate\n")

    inventory = directory / "rust.cdx.json"
    raw = inventory.read_text(encoding="utf-8")
    root_reference = json.loads(raw)["metadata"]["component"]["bom-ref"].split("#", 1)[0]
    if not root_reference.startswith("file://"):
        raise ValueError("Expected a Cargo SBOM for the local application")
    source_url = f"{REPOSITORY}/tree/v{version}"
    inventory.write_text(
        raw.replace(root_reference, f"{source_url}/app/src-tauri").replace('"file://."', f'"{source_url}"'),
        encoding="utf-8",
        newline="\n",
    )
    return [notices, inventory]


def ubuntu_package_index():
    fields = "${binary:Package}\t${Version}\t${Architecture}\t${source:Package}\t${source:Version}\t${db:Status-Abbrev}\n"
    inventory = subprocess.check_output(["dpkg-query", "-W", f"-f={fields}"], text=True, encoding="utf-8")
    packages = {}
    files = defaultdict(set)
    for line in inventory.splitlines():
        name, version, arch, source, source_version, status = line.split("\t")
        if status != "ii ":
            continue
        listing = Path("/var/lib/dpkg/info") / f"{name}.list"
        if not listing.is_file():
            continue
        packages[name] = {
            "version": version,
            "architecture": arch,
            "source": source,
            "source_version": source_version,
            "source_url": f"https://launchpad.net/ubuntu/+source/{quote(source)}/{quote(source_version, safe='')}",
            "bundled_paths": [],
        }
        for entry in listing.read_text(encoding="utf-8").splitlines():
            files[Path(entry).name].add((entry, name))
    return packages, files


def package_for(relative, file_index):
    candidates = file_index.get(relative.name, ())
    exact = {package for path, package in candidates if path == f"/{relative.as_posix()}"}
    owners = exact or {package for path, package in candidates if Path(path).is_file()}
    return next(iter(owners)) if len(owners) == 1 else None


def ubuntu_materials(directory, app_dir):
    packages, files = ubuntu_package_index()
    unmapped = []
    for path in sorted(app_dir.rglob("*")):
        if path.is_symlink() or not path.is_file():
            continue
        relative = path.relative_to(app_dir)
        package = package_for(relative, files)
        if package:
            packages[package]["bundled_paths"].append(relative.as_posix())
        else:
            unmapped.append(relative.as_posix())

    matched = {name: item for name, item in packages.items() if item["bundled_paths"]}
    if not matched:
        raise ValueError("No Ubuntu packages matched the AppImage payload")
    licenses = directory / "ubuntu-licenses"
    licenses.mkdir()
    missing = []
    for name in sorted(matched):
        package_name = name.split(":", 1)[0]
        notice = Path("/usr/share/doc") / package_name / "copyright"
        if notice.is_file():
            shutil.copyfile(notice, licenses / f"{package_name}.txt")
        else:
            missing.append(name)
    common = Path("/usr/share/common-licenses")
    for path in sorted(common.iterdir()):
        if path.is_file() and not path.is_symlink():
            shutil.copyfile(path, licenses / f"common-{path.name}.txt")

    inventory = directory / "ubuntu-packages.json"
    inventory.write_text(json.dumps({
        "method": "AppImage payload paths matched against installed Ubuntu package file lists",
        "packages": matched,
        "unmapped_payload_paths": unmapped,
        "packages_without_copyright_file": missing,
    }, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return [inventory, *sorted(licenses.iterdir())]


def collect(directory, platform, app_dir=None):
    version = check_version()
    common_notices = [ROOT / "LICENSE", ROOT / "docs/THIRD_PARTY_PACKAGING.md"]
    entries = [
        directory / "JAVASCRIPT-NOTICES.txt",
        directory / "frontend.cdx.json",
        directory / "sandbox.cdx.json",
        *rust_materials(directory, version),
    ]
    if platform == "linux-x64":
        if app_dir is None or not app_dir.is_dir():
            raise ValueError("The extracted Linux AppImage payload is required")
        entries.append(directory / "APPIMAGE-RUNTIME.txt")
        entries.extend(ubuntu_materials(directory, app_dir))
    destination = directory / f"racing-data-studio_{version}_{platform}-third-party.zip"
    with zipfile.ZipFile(destination, "x", compression=zipfile.ZIP_DEFLATED) as archive:
        for file in common_notices:
            archive.write(file, file.name)
        for file in entries:
            archive.write(file, file.relative_to(directory))
    return destination


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--platform", choices=("linux-x64", "windows-x64"), required=True)
    parser.add_argument("--app-dir", type=Path)
    args = parser.parse_args()
    try:
        print(collect(args.directory, args.platform, args.app_dir))
    except (ValueError, OSError, KeyError, subprocess.SubprocessError) as error:
        parser.exit(1, f"{error}\n")
