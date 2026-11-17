import base64
import importlib.util
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("prepare_updater", Path(__file__).parents[1] / "prepare-updater.py")
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


class SigningConfigTests(unittest.TestCase):
    def test_only_public_key_is_written_and_signing_is_mandatory(self):
        raw = b"Ed" + bytes(40)
        public = base64.b64encode(b"untrusted comment: fixture\n" + base64.b64encode(raw) + b"\n").decode()
        config = module.prepare(public, True)
        self.assertEqual(config["plugins"]["updater"]["pubkey"], public)
        self.assertEqual(config["plugins"]["updater"]["requireSignedVersion"], True)
        self.assertTrue(config["bundle"]["createUpdaterArtifacts"])
        with self.assertRaises(ValueError):
            module.prepare(public, False)
        for invalid in ("", "path/to/public.key", base64.b64encode(b"invalid").decode()):
            with self.assertRaises(ValueError):
                module.prepare(invalid, True)
