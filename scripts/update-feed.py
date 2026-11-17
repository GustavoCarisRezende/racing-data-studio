#!/usr/bin/env python3
"""Prepare an update manifest from downloaded, already published release assets.

The CLI validates metadata and verifies signatures/version binding with minisign.
The pure create_feed function may omit verification only for structural unit tests.
The application independently verifies downloaded bytes against its embedded key.
This script does not upload anything or move an update channel.
"""

import argparse
import base64
import binascii
import json
import os
import subprocess
import tempfile
from pathlib import Path
from urllib.parse import quote

from release import validate_version

REPOSITORY = "GustavoCarisRezende/racing-data-studio"


def version_order(version):
    validate_version(version)
    numeric, _, beta = version.partition("-beta.")
    return (*map(int, numeric.split(".")), 0 if beta else 1, int(beta or 0))


def verify_artifact(artifact, signature, public_key, version):
    """minisign verifies both the artifact and its signed trusted comment."""
    with tempfile.TemporaryDirectory(prefix="rds-verify-") as temp:
        key = Path(temp) / "public.key"
        sig = Path(temp) / "artifact.minisig"
        key.write_bytes(base64.b64decode(public_key.strip(), validate=True))
        sig.write_bytes(base64.b64decode(signature, validate=True))
        subprocess.run(
            ["minisign", "-Vm", str(artifact.resolve()), "-p", str(key), "-x", str(sig)],
            check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120,
        )
        # Read the comment only AFTER minisign verified its global signature.
        trusted = sig.read_text().splitlines()[2].removeprefix("trusted comment: ")
        signed = next((part[8:] for part in trusted.split("\t") if part.startswith("version:")), None)
        if signed != version:
            raise ValueError("Signature is not bound to the announced version")


def create_feed(version, channel, assets, release, public_key=None):
    validate_version(version)
    if channel not in ("beta", "stable"):
        raise ValueError("Unknown channel")
    if "-beta." in version and channel != "beta":
        raise ValueError("Version and channel do not match")
    if release.get("tag_name") != f"v{version}" or release.get("draft") is not False:
        raise ValueError("Expected an already published release with the exact version tag")
    if release.get("prerelease") is not ("-beta." in version):
        raise ValueError("GitHub prerelease flag does not match channel")
    if not release.get("published_at"):
        raise ValueError("Release has no publication timestamp")
    assets = Path(assets)
    published = {entry["name"]: entry for entry in release.get("assets", [])}
    platforms = {}
    for target, extension in (("linux-x86_64", ".AppImage"), ("windows-x86_64", ".exe")):
        # EXE is the initial update target; MSI migration needs separate validation.
        matches = list(assets.glob(f"*{extension}"))
        if len(matches) != 1:
            raise ValueError(f"Expected exactly one {extension} artifact")
        artifact = matches[0]
        signature_file = artifact.with_name(artifact.name + ".sig")
        signature = signature_file.read_text().strip()
        try:
            decoded = base64.b64decode(signature, validate=True)
        except (ValueError, binascii.Error) as error:
            raise ValueError("Invalid signature encoding") from error
        if not decoded.startswith(b"untrusted comment:") or len(decoded.splitlines()) != 4:
            raise ValueError("Expected a base64-encoded minisign signature")
        url = (
            f"https://github.com/{REPOSITORY}/releases/download/"
            f"v{version}/{quote(artifact.name, safe='')}"
        )
        for path in (artifact, signature_file):
            metadata = published.get(path.name, {})
            expected_url = (
                f"https://github.com/{REPOSITORY}/releases/download/"
                f"v{version}/{quote(path.name, safe='')}"
            )
            if metadata.get("browser_download_url") != expected_url:
                raise ValueError(f"Asset not published at the expected URL: {path.name}")
            if metadata.get("size") != path.stat().st_size:
                raise ValueError(f"Asset size mismatch: {path.name}")
            if metadata.get("state") != "uploaded":
                raise ValueError(f"Asset not completely uploaded: {path.name}")
        if public_key is not None:
            verify_artifact(artifact, signature, public_key, version)
        platforms[target] = {"url": url, "signature": signature}
    return {
        "version": version,
        "notes": release.get("body") or "",
        "pub_date": release["published_at"],
        "platforms": platforms,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", required=True)
    parser.add_argument("--channel", choices=("beta", "stable"), required=True)
    parser.add_argument("--assets", type=Path, required=True)
    parser.add_argument("--release-json", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--previous", type=Path)
    args = parser.parse_args()
    try:
        public_key = os.environ.get("TAURI_UPDATER_PUBLIC_KEY")
        if not public_key:
            raise ValueError("TAURI_UPDATER_PUBLIC_KEY is required for cryptographic verification")
        if args.previous and args.previous.exists():
            previous = json.loads(args.previous.read_text())
            if version_order(args.version) <= version_order(previous["version"]):
                raise ValueError("Channel promotion must strictly increase the version")
        feed = create_feed(
            args.version, args.channel, args.assets,
            json.loads(args.release_json.read_text()), public_key=public_key,
        )
        # Exclusive creation avoids silently replacing an existing channel file.
        with args.output.open("x") as destination:
            destination.write(json.dumps(feed, ensure_ascii=False, indent=2) + "\n")
        print(args.output)
    except (ValueError, OSError, KeyError, subprocess.SubprocessError) as error:
        parser.exit(1, f"{error}\n")
