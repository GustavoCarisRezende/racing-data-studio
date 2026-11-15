#!/usr/bin/env python3
"""Development-only Linux reset. Preview by default; --yes permanently deletes."""
import argparse
import os
from pathlib import Path
import shutil
import sys

APP_ID = "org.racingdatastudio.app"


def targets():
    home = Path.home()
    locations = [
        ("XDG_DATA_HOME", home / ".local/share"),
        ("XDG_CONFIG_HOME", home / ".config"),
        ("XDG_CACHE_HOME", home / ".cache"),
        ("XDG_STATE_HOME", home / ".local/state"),
    ]
    result = []
    for variable, fallback in locations:
        base = Path(os.environ.get(variable) or fallback)
        if not base.is_absolute():
            raise ValueError(f"{variable} must be an absolute path")
        target = base / APP_ID
        if target.is_symlink():
            raise ValueError(f"Refusing symbolic link: {target}")
        resolved = target.resolve()
        if resolved == home.resolve() or resolved == Path("/") or resolved.name != APP_ID:
            raise ValueError(f"Unsafe target: {target}")
        if resolved not in result:
            result.append(resolved)
    return result


def running_app():
    for process in Path("/proc").iterdir():
        if not process.name.isdigit():
            continue
        try:
            executable = (process / "exe").resolve(strict=True).name
            if executable in ("racing-data-studio", "racing-data-studio (deleted)"):
                return process.name
        except (OSError, RuntimeError):
            continue
    return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--yes", action="store_true", help="Permanently delete the listed app directories")
    args = parser.parse_args()
    if not sys.platform.startswith("linux"):
        parser.error("This development script currently supports Linux only.")
    paths = targets()
    for path in paths:
        print(f"{'DELETE' if args.yes else 'PREVIEW'} {path} {'(exists)' if path.exists() else '(absent)'}")
    if not args.yes:
        print("No changes made. Close the app, then pass --yes to reset snapshots, models, preferences and WebView storage.")
        return
    pid = running_app()
    if pid:
        raise ValueError(f"Close Racing Data Studio first (PID {pid}).")
    for path in paths:
        # Recheck immediately before removal; never follow an app-directory symlink.
        if path.is_symlink():
            raise ValueError(f"Refusing symbolic link: {path}")
        if path.exists():
            if not path.is_dir():
                raise ValueError(f"Expected an app directory: {path}")
            shutil.rmtree(path)
    print("Local app data reset. The next launch creates a fresh database.")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError) as error:
        print(f"Reset refused: {error}", file=sys.stderr)
        sys.exit(1)
