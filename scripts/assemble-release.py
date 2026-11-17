#!/usr/bin/env python3
"""Merge CI candidate directories, checking their checksums before promotion."""
import argparse
import hashlib
import shutil
from pathlib import Path

from release import checksums


def assemble(source, output):
    source, output = Path(source), Path(output)
    if output.exists():
        raise ValueError("Output directory must not exist")
    directories = [source / f"racing-data-studio-{p}" for p in ("linux-x64", "windows-x64")]
    verified = {}
    for directory in directories:
        manifest = directory / "SHA256SUMS"
        for line in manifest.read_text().splitlines():
            digest, name = line.split("  ", 1)
            if Path(name).name != name or name in (".", ".."):
                raise ValueError("Invalid artifact filename")
            path = directory / name
            if path.is_symlink() or not path.is_file():
                raise ValueError("Invalid artifact file")
            with path.open("rb") as file:
                digest_state = hashlib.sha256()
                for chunk in iter(lambda: file.read(1024 * 1024), b""):
                    digest_state.update(chunk)
                actual = digest_state.hexdigest()
            if actual != digest:
                raise ValueError(f"Artifact checksum failed: {name}")
            if name in verified and verified[name][0] != digest:
                raise ValueError(f"Conflicting platform artifact: {name}")
            verified[name] = (digest, path)
        if not manifest.read_text().strip():
            raise ValueError("Empty artifact manifest")
    output.mkdir(parents=True)
    for name, (_, path) in verified.items():
        shutil.copy2(path, output / name)
    checksums(output)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    try:
        assemble(args.source, args.output)
    except (ValueError, OSError) as error:
        parser.exit(1, f"{error}\n")
