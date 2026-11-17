import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).parents[1]
sys.path.insert(0, str(SCRIPTS))
from release import checksums
SPEC = importlib.util.spec_from_file_location("assemble_release", SCRIPTS / "assemble-release.py")
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


class AssembleTests(unittest.TestCase):
    def test_checksums_and_duplicate_names_are_validated(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for platform in ("linux-x64", "windows-x64"):
                directory = root / f"racing-data-studio-{platform}"
                directory.mkdir()
                (directory / "LICENSE").write_text("same license")
                (directory / f"{platform}.fixture").write_text("synthetic artifact")
                checksums(directory)
            module.assemble(root, root / "output")
            self.assertEqual(len(list((root / "output").iterdir())), 4)
            with self.assertRaises(ValueError):
                module.assemble(root, root / "output")
            (root / "racing-data-studio-linux-x64/linux-x64.fixture").write_text("tampered")
            with self.assertRaises(ValueError):
                module.assemble(root, root / "bad-output")
            checksums(root / "racing-data-studio-linux-x64")
            (root / "racing-data-studio-linux-x64/LICENSE").write_text("conflicting license")
            checksums(root / "racing-data-studio-linux-x64")
            with self.assertRaises(ValueError):
                module.assemble(root, root / "conflicting-output")
