"""Regression checks for shared extension modules in standalone VSIX files."""

import json
from pathlib import Path
import tempfile
import unittest
import zipfile

from package_vsix import package_extension


class SharedModulePackagingTests(unittest.TestCase):
    def make_extension(self, root, shared):
        (root / "src").mkdir()
        (root / "src" / "custom-css.js").write_text("module.exports = require('../../shared/custom-css');\n", encoding="utf-8")
        manifest = {
            "name": "packaging-test", "version": "1.0.0", "publisher": "local",
            "engines": {"vscode": "^1.90.0"}, "files": ["src/*.js"],
            "repositorySharedFiles": shared,
        }
        (root / "package.json").write_text(json.dumps(manifest), encoding="utf-8")

    def test_shared_implementation_replaces_only_the_archive_shim(self):
        with tempfile.TemporaryDirectory(prefix="vsix-shared-test-") as directory:
            root = Path(directory)
            self.make_extension(root, {"src/custom-css.js": "custom-css.js"})
            original = (root / "src" / "custom-css.js").read_bytes()
            package = package_extension(root)
            shared = Path(__file__).resolve().parents[1] / "shared" / "custom-css.js"
            with zipfile.ZipFile(package) as archive:
                self.assertEqual(archive.read("extension/src/custom-css.js"), shared.read_bytes())
            self.assertEqual((root / "src" / "custom-css.js").read_bytes(), original)

    def test_shared_sources_cannot_escape_the_shared_directory(self):
        with tempfile.TemporaryDirectory(prefix="vsix-shared-test-") as directory:
            root = Path(directory)
            self.make_extension(root, {"src/custom-css.js": "../README.md"})
            with self.assertRaisesRegex(ValueError, "Invalid shared package resource"):
                package_extension(root)

    def test_shared_destinations_must_be_in_the_extension_allowlist(self):
        with tempfile.TemporaryDirectory(prefix="vsix-shared-test-") as directory:
            root = Path(directory)
            self.make_extension(root, {"outside.js": "custom-css.js"})
            with self.assertRaisesRegex(ValueError, "Invalid shared package resource"):
                package_extension(root)


if __name__ == "__main__":
    unittest.main()
