import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "reset-local-data.py"
spec = importlib.util.spec_from_file_location("reset_local_data", SCRIPT)
reset = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reset)


@unittest.skipUnless(sys.platform.startswith("linux"), "Linux-only reset helper")
class ResetTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.env = {name: str(self.base / name) for name in (
            "XDG_DATA_HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME"
        )}

    def test_preview_and_reset_only_app_directories(self):
        with patch.dict(os.environ, self.env), patch.object(reset, "running_app", return_value=None):
            paths = reset.targets()
            for path in paths:
                path.mkdir(parents=True)
                (path / "snapshot.sqlite").write_text("fixture")
                (path.parent / "other-app").mkdir()
            with patch("sys.argv", [str(SCRIPT)]):
                reset.main()
            self.assertTrue(all(path.exists() for path in paths))
            with patch("sys.argv", [str(SCRIPT), "--yes"]):
                reset.main()
            self.assertTrue(all(not path.exists() for path in paths))
            self.assertTrue(all((path.parent / "other-app").exists() for path in paths))

    def test_symlink_and_relative_base_refused(self):
        with patch.dict(os.environ, self.env):
            base = Path(self.env["XDG_DATA_HOME"])
            base.mkdir()
            (base / reset.APP_ID).symlink_to(self.base, target_is_directory=True)
            with self.assertRaises(ValueError):
                reset.targets()
        with patch.dict(os.environ, {**self.env, "XDG_DATA_HOME": "relative"}):
            with self.assertRaises(ValueError):
                reset.targets()

    def test_running_app_prevents_reset(self):
        with patch.dict(os.environ, self.env), patch.object(reset, "running_app", return_value="123"):
            path = reset.targets()[0]
            path.mkdir(parents=True)
            with patch("sys.argv", [str(SCRIPT), "--yes"]), self.assertRaises(ValueError):
                reset.main()
            self.assertTrue(path.exists())


if __name__ == "__main__":
    unittest.main()
