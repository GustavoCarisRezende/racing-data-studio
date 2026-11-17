#!/usr/bin/env python3
"""Collect only explicit distributable files, never local databases or keys."""

import argparse
import shutil
from pathlib import Path

from release import ROOT, check_version, checksums, linux_archive


def collect(platform, root=ROOT, signed=False):
    version = check_version(root=root)
    bundle = root / "app/src-tauri/target/release/bundle"
    output = root / "artifacts"
    notices = root / "release-notices.txt"
    if not notices.is_file():
        raise ValueError("Generate release-notices.txt before collecting artifacts")
    # Refuse stale or mixed artifacts instead of deleting existing user files.
    if output.exists() and any(output.iterdir()):
        raise ValueError("artifacts/ must be empty; move previous candidates elsewhere")
    output.mkdir(parents=True, exist_ok=True)
    if platform == "linux-x64":
        images = list((bundle / "appimage").glob("*.AppImage"))
        if len(images) != 1:
            raise ValueError("Expected exactly one AppImage")
        linux_archive(images[0], output, version, notices, root)
        target = output / f"racing-data-studio_{version}_linux_x64.AppImage"
        shutil.copy2(images[0], target)
        target.chmod(0o755)
        if signed:
            shutil.copy2(images[0].with_name(images[0].name + ".sig"), output / (target.name + ".sig"))
    else:
        for subdir, extension in (("nsis", "exe"), ("msi", "msi")):
            candidates = list((bundle / subdir).glob(f"*.{extension}"))
            if len(candidates) != 1:
                raise ValueError(f"Expected exactly one {extension} installer")
            shutil.copy2(candidates[0], output / candidates[0].name)
            if signed:
                signature = candidates[0].with_name(candidates[0].name + ".sig")
                shutil.copy2(signature, output / signature.name)
    shutil.copy2(root / "LICENSE", output / "LICENSE")
    shutil.copy2(notices, output / "THIRD-PARTY-NOTICES.txt")
    checksums(output)
    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--platform", choices=("linux-x64", "windows-x64"), required=True)
    parser.add_argument("--signed", action="store_true")
    args = parser.parse_args()
    try:
        print(collect(args.platform, signed=args.signed))
    except (ValueError, OSError) as error:
        parser.exit(1, f"{error}\n")
