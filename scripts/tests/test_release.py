import importlib.util
import json
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("release", Path(__file__).parents[1] / "release.py")
release = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = release
SPEC.loader.exec_module(release)


def load_script(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).parents[1] / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


collector = load_script("collect_candidate", "collect-candidate.py")
verifier = load_script("verify_release", "verify-release.py")
materials = load_script("release_materials", "release-materials.py")


class ReleaseTests(unittest.TestCase):
    def fixture(self, root):
        (root / "app/src-tauri").mkdir(parents=True)
        (root / "app/package.json").write_text('{"version": "0.1.0", "dependencies": {"x": "1.2.3"}}\n')
        (root / "app/package-lock.json").write_text(json.dumps({
            "version": "0.1.0",
            "packages": {"": {"version": "0.1.0"}, "node_modules/x": {"version": "1.2.3"}},
        }))
        (root / "app/src-tauri/tauri.conf.json").write_text('{"version": "0.1.0"}\n')
        (root / "app/src-tauri/Cargo.toml").write_text('[package]\nversion = "0.1.0"\n')
        (root / "app/src-tauri/Cargo.lock").write_text(
            '[[package]]\nname = "racing-data-studio"\nversion = "0.1.0"\n\n'
            '[[package]]\nname = "other"\nversion = "1.2.3"\n'
        )

    def test_synchronized_version_and_preserved_dependencies(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.fixture(root)
            release.set_version("0.0.1-beta.1", root)
            self.assertEqual(release.check_version(root=root), "0.0.1-beta.1")
            lock = json.loads((root / "app/package-lock.json").read_text())
            self.assertEqual(lock["packages"]["node_modules/x"]["version"], "1.2.3")
            self.assertIn('name = "other"\nversion = "1.2.3"', (root / "app/src-tauri/Cargo.lock").read_text())
            with self.assertRaises(ValueError):
                release.check_version("0.0.1-beta.2", root)

    def test_invalid_versions_do_not_write(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.fixture(root)
            for version in ("v0.0.1", "0.0.1-beta.0", "0.0.1-beta.01", "01.0.0", "256.0.0", "1.2.65536", "1.0.0-rc.1"):
                with self.assertRaises(ValueError):
                    release.set_version(version, root)
            self.assertEqual(release.check_version(root=root), "0.1.0")

    def test_collect_signed_windows_beta_without_msi(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.fixture(root)
            release.set_version("0.0.1-beta.1", root)
            bundle = root / "app/src-tauri/target/release/bundle/nsis"
            bundle.mkdir(parents=True)
            setup = bundle / "Racing Data Studio_0.0.1-beta.1_x64-setup.exe"
            signature = setup.with_suffix(".exe.sig")
            setup.write_bytes(b"installer fixture")
            signature.write_text("signature fixture")
            for path in (root / "LICENSE", root / "release-notices.txt"):
                path.write_text("fixture")
            output = collector.collect("windows-x64", root, signed=True)
            asset = "racing-data-studio_0.0.1-beta.1_windows_x64-setup.exe"
            self.assertEqual({path.name for path in output.iterdir()}, {
                asset, f"{asset}.sig", "LICENSE", "THIRD-PARTY-NOTICES.txt", "SHA256SUMS",
            })
            self.assertEqual((output / asset).read_bytes(), setup.read_bytes())
            self.assertEqual((output / f"{asset}.sig").read_bytes(), signature.read_bytes())

    def test_release_verification_requires_msi_only_for_stable(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(verifier.feed, "verify_artifact") as check:
            root = Path(temp)
            for asset in ("app.AppImage", "setup.exe"):
                (root / asset).touch()
                (root / f"{asset}.sig").write_text("signature")
            verifier.verify(root, "0.0.1-beta.1", "public-key")
            self.assertEqual([call.args[0].suffix for call in check.call_args_list], [".AppImage", ".exe"])
            with self.assertRaisesRegex(ValueError, r"exactly one \.msi"):
                verifier.verify(root, "0.0.1", "public-key")

    def test_rust_materials_remove_machine_path_and_include_mpl_source(self):
        root_reference = "file:///D:/runner/work/rds/app/src-tauri"
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "rust.cdx.json").write_text(json.dumps({
                "metadata": {"component": {"bom-ref": f"{root_reference}#racing-data-studio@0.0.1"}},
                "dependencies": [{"ref": f"{root_reference}#racing-data-studio@0.0.1"}],
            }))
            (root / "cargo-about.json").write_text(json.dumps({"licenses": [{
                "id": "MPL-2.0",
                "text": "fixture text",
                "source_path": "/private/runner/fixture",
                "used_by": [{"crate": {"name": "example-crate", "version": "1.2.3"}}],
            }]}))
            notices, sbom = materials.rust_materials(root, "0.0.1")
            self.assertIn("https://static.crates.io/crates/example-crate/example-crate-1.2.3.crate",
                          notices.read_text())
            self.assertNotIn("/private/runner", notices.read_text())
            self.assertNotIn(root_reference, sbom.read_text())
            document = json.loads(sbom.read_text())
            self.assertEqual(document["dependencies"][0]["ref"],
                             document["metadata"]["component"]["bom-ref"])

    def test_archive_whitelist_and_executable_mode(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for locale in ("en-US", "pt-BR"):
                path = root / "docs" / locale
                path.mkdir(parents=True)
                (path / "LINUX_TEST_BUILD.md").write_text("test instructions")
            (root / "LICENSE").write_text("license")
            (root / "private.sqlite").write_text("never distribute")
            image = root / "fixture.AppImage"
            header = bytearray(64)
            header[:4] = b"\x7fELF"
            header[8:11] = b"AI\x02"
            header[18:20] = b"\x3e\x00"
            image.write_bytes(header)
            notices = root / "notices.txt"
            notices.write_text("third-party notices")
            bundle_materials = root / "linux-third-party.zip"
            bundle_materials.write_bytes(b"materials fixture")
            archive = release.linux_archive(image, root / "out", "0.0.1-beta.1", notices, root)
            with tarfile.open(archive) as tar:
                entries = tar.getmembers()
                self.assertEqual(len(entries), 5)
                self.assertEqual(entries[0].mode, 0o755)
                self.assertFalse(any("sqlite" in entry.name for entry in entries))
            archive = release.linux_archive(image, root / "out", "0.0.1-beta.1", notices, root, bundle_materials)
            with tarfile.open(archive) as tar:
                self.assertTrue(any(name.endswith("/linux-third-party.zip") for name in tar.getnames()))
            release.checksums(root / "out")
            self.assertIn(archive.name, (root / "out/SHA256SUMS").read_text())
            image.write_bytes(b"not an appimage")
            with self.assertRaises(ValueError):
                release.linux_archive(image, root / "out", "0.0.1", notices, root)


if __name__ == "__main__":
    unittest.main()
