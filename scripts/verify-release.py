#!/usr/bin/env python3
"""Verify every native release artifact before a draft can be published."""
import argparse
import importlib.util
import os
import subprocess
from pathlib import Path

from release import validate_version

spec = importlib.util.spec_from_file_location("update_feed", Path(__file__).with_name("update-feed.py"))
feed = importlib.util.module_from_spec(spec)
spec.loader.exec_module(feed)


def verify(directory, version, public_key):
    validate_version(version)
    if not public_key:
        raise ValueError("TAURI_UPDATER_PUBLIC_KEY is required")
    for extension in (".AppImage", ".exe", ".msi"):
        files = list(Path(directory).glob(f"*{extension}"))
        if len(files) != 1:
            raise ValueError(f"Expected exactly one {extension}")
        artifact = files[0]
        signature = artifact.with_name(artifact.name + ".sig").read_text().strip()
        feed.verify_artifact(artifact, signature, public_key, version)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--assets", required=True)
    parser.add_argument("--version", required=True)
    args = parser.parse_args()
    try:
        verify(args.assets, args.version, os.environ.get("TAURI_UPDATER_PUBLIC_KEY"))
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        parser.exit(1, f"{error}\n")
