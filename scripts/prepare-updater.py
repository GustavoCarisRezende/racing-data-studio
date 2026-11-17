#!/usr/bin/env python3
"""Generate the signed-build config overlay. Never writes the private key."""
import argparse
import base64
import json
import os
from pathlib import Path


def prepare(public_key, private_key_present):
    if not private_key_present:
        raise ValueError("Configure TAURI_SIGNING_PRIVATE_KEY before a signed build")
    try:
        lines = base64.b64decode(public_key.strip(), validate=True).decode().splitlines()
        raw = base64.b64decode(lines[1], validate=True)
        if len(lines) != 2 or not lines[0].startswith("untrusted comment:") or len(raw) != 42 or raw[:2] != b"Ed":
            raise ValueError()
    except (ValueError, IndexError, UnicodeError) as error:
        raise ValueError("TAURI_UPDATER_PUBLIC_KEY must contain the Tauri public key, not a path") from error
    return {
        "bundle": {"active": True, "createUpdaterArtifacts": True},
        "plugins": {"updater": {"pubkey": public_key.strip(), "requireSignedVersion": True}},
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        config = prepare(os.environ.get("TAURI_UPDATER_PUBLIC_KEY", ""), bool(os.environ.get("TAURI_SIGNING_PRIVATE_KEY")))
        args.output.write_text(json.dumps(config, indent=2) + "\n")
    except (ValueError, OSError) as error:
        parser.exit(1, f"{error}\n")
