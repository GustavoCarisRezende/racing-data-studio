import base64
import copy
import importlib.util
import sys
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

SCRIPTS = Path(__file__).parents[1]
sys.path.insert(0, str(SCRIPTS))
SPEC = importlib.util.spec_from_file_location("update_feed", SCRIPTS / "update-feed.py")
feed = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(feed)


class FeedTests(unittest.TestCase):
    def fixture(self, directory):
        release = {
            "tag_name": "v0.0.1-beta.2", "draft": False, "prerelease": True,
            "published_at": "2026-11-16T12:00:00Z", "assets": [],
        }
        for extension in (".AppImage", ".exe"):
            artifact = directory / f"example{extension}"
            artifact.write_bytes(b"fixture, not a runnable application")
            signature = artifact.with_name(artifact.name + ".sig")
            # Structural fixture only; not a cryptographically valid signature.
            signature.write_text(base64.b64encode(
                b"untrusted comment: fixture\nfixture\ntrusted comment: fixture\nfixture\n"
            ).decode())
            for path in (artifact, signature):
                release["assets"].append({
                    "name": path.name, "size": path.stat().st_size, "state": "uploaded",
                    "browser_download_url": (
                        f"https://github.com/{feed.REPOSITORY}/releases/download/"
                        f"v0.0.1-beta.2/{path.name}"
                    ),
                })
        return release

    def test_complete_release_and_embedded_signature(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp)
            release = self.fixture(path)
            result = feed.create_feed("0.0.1-beta.2", "beta", path, release)
            self.assertEqual(set(result["platforms"]), {"linux-x86_64", "windows-x86_64"})
            self.assertEqual(result["platforms"]["linux-x86_64"]["signature"], (path / "example.AppImage.sig").read_text())

    def test_incomplete_draft_wrong_channel_or_url_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp)
            release = self.fixture(path)
            for key, value in (("draft", True), ("prerelease", False), ("published_at", None), ("tag_name", "v0.0.1-beta.1")):
                modified = {**release, key: value}
                with self.assertRaises(ValueError):
                    feed.create_feed("0.0.1-beta.2", "beta", path, modified)
            with self.assertRaises(ValueError):
                feed.create_feed("0.0.1-beta.2", "stable", path, release)
            modified = copy.deepcopy(release)
            modified["assets"][0]["browser_download_url"] = "https://example.com/payload"
            with self.assertRaises(ValueError):
                feed.create_feed("0.0.1-beta.2", "beta", path, modified)
            modified = copy.deepcopy(release)
            modified["assets"][0]["size"] += 1
            with self.assertRaises(ValueError):
                feed.create_feed("0.0.1-beta.2", "beta", path, modified)
            (path / "example.exe").unlink()
            with self.assertRaises(ValueError):
                feed.create_feed("0.0.1-beta.2", "beta", path, release)

    def test_version_order_and_graduation(self):
        self.assertLess(feed.version_order("0.0.1-beta.9"), feed.version_order("0.0.1-beta.10"))
        self.assertLess(feed.version_order("0.0.1-beta.10"), feed.version_order("0.0.1"))
        self.assertLess(feed.version_order("0.0.1"), feed.version_order("0.0.2-beta.1"))
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp)
            release = self.fixture(path)
            with patch.object(feed, "verify_artifact", side_effect=ValueError("bad signature")) as verify:
                with self.assertRaises(ValueError):
                    feed.create_feed("0.0.1-beta.2", "beta", path, release, public_key="fixture")
                verify.assert_called_once()


if __name__ == "__main__":
    unittest.main()
