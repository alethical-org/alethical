"""Changes to reviewed callers or dependencies must close the Pillow exception."""

from pathlib import Path
import subprocess
import tempfile
import unittest

import importlib.util

ROOT = Path(__file__).resolve().parents[3]
SPEC = importlib.util.spec_from_file_location(
    "pillow_source_guard", ROOT / "scripts/pillow_source_guard.py"
)
guard = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(guard)


class SourceBoundaryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.repo = ROOT
        cls.seed = {
            relative: (cls.repo / relative).read_bytes()
            for relative in {
                "uv.lock",
                "pyproject.toml",
                guard.RENDERER,
                guard.PIL_TEST,
                guard.SERVICE,
            }
        }

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="pillow-source-mutation-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for relative, data in self.seed.items():
            path = self.root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        self.git("init", "--quiet")
        self.git("add", "--", ".")

    def git(self, *args):
        return subprocess.run(
            ["git", "-C", str(self.root), *args], check=True, capture_output=True
        )

    def add_source(self, source, relative="alethical/new_source.py"):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(source)
        self.git("add", "--", relative)

    def assert_held(self, needle):
        errors = guard.validate(self.root)
        self.assertTrue(any(needle in error for error in errors), errors)

    def test_baseline(self):
        self.assertEqual(guard.validate(self.root), [])

    def test_new_pil_import(self):
        self.add_source("from PIL import Image as Picture\n")
        self.assert_held("import boundary changed")

    def test_literal_dynamic_and_aliased_imports(self):
        for source in (
            "__import__('PIL.Image')\n",
            "import importlib as lib\nload=lib.import_module\nload('PIL.Image')\n",
            "from importlib import import_module as load\npart='P'+'IL'\nload(part)\n",
            "import importlib\nload=getattr(importlib, 'import_'+'module')\nload('PIL.Image')\n",
            "from builtins import __import__ as load\nload('pyarrow')\n",
            "load=getattr(__builtins__, '__import__')\nload('PIL.Image')\n",
            "load=__builtins__['__import__']\nload('PIL.Image')\n",
            "import importlib\nimportlib.import_module(runtime_name)\n",
        ):
            self.add_source(source)
            self.assert_held("dynamic import")

    def test_existing_benign_literal_dynamic_import(self):
        self.add_source("import importlib\nimportlib.import_module('pathlib')\n")
        self.assertEqual(guard.validate(self.root), [])

    def test_pyarrow_package(self):
        path = self.root / "uv.lock"
        path.write_text(
            path.read_text() + '\n[[package]]\nname = "pyarrow"\nversion = "99.0.0"\n'
        )
        self.assert_held("pyarrow package")

    def test_new_dependency_parent(self):
        path = self.root / "uv.lock"
        path.write_text(
            path.read_text()
            + '\n[[package]]\nname = "new-parent"\nversion = "1.0"\ndependencies = [{ name = "pillow" }]\n'
        )
        self.assert_held("dependency path changed")

    def test_extra_dependency_edge(self):
        path = self.root / "uv.lock"
        path.write_text(
            path.read_text()
            + '\n[[package]]\nname = "new-parent"\nversion = "1.0"\n[package.optional-dependencies]\nimage = [{ name = "pillow" }]\n'
        )
        self.assert_held("dependency path changed")

    def test_artifact_change(self):
        path = self.root / "uv.lock"
        path.write_text(
            path.read_text().replace(
                "sha256:cdcd1ba258178f7356d74170c9a81ba4eab6a5d55748bc402a5a2a6fe6be3510",
                "sha256:" + "0" * 64,
            )
        )
        self.assert_held("artifact fingerprint changed")

    def test_version_change(self):
        path = self.root / "uv.lock"
        path.write_text(
            path.read_text().replace(
                'name = "pillow"\nversion = "13.0.0"',
                'name = "pillow"\nversion = "13.0.1"',
            )
        )
        self.assert_held("artifact fingerprint changed")

    def test_requirement_change(self):
        path = self.root / "pyproject.toml"
        path.write_text(path.read_text().replace("pillow>=13.0.0", "pillow>=12.0.0"))
        self.assert_held("requirement changed")

    def test_arrow_and_reflection(self):
        for source in (
            "image.fromarrow(value)\n",
            "export = image.__arrow_c_array__\nexport()\n",
            "getattr(image, '__arrow_c_array__')()\n",
            "name='from'+'arrow'\ngetattr(image, name)(value)\n",
            "lookup=getattr\nlookup(image, 'fromarrow')(value)\n",
            "from builtins import getattr as lookup\nlookup(image, 'fromarrow')(value)\n",
        ):
            self.add_source("from PIL import Image as image\n" + source)
            self.assert_held("Arrow")

    def test_alignment(self):
        for source in (
            "import os\nos.environ['PILLOW_ALIGNMENT']='64'\n",
            "import os as env\nkey='PILLOW_'+'ALIGNMENT'\nenv.putenv(key, '64')\n",
            "import os\nsetenv=os.putenv\nsetenv('PILLOW_ALIGNMENT','64')\n",
            "import os\nos.environ.update(PILLOW_ALIGNMENT='64')\n",
            "import subprocess\nsubprocess.run(['test'], env={'PILLOW_ALIGNMENT':'64'})\n",
            "from PIL import Image as image\nimage.core.set_alignment(64)\n",
            "from PIL import Image as image\nsetter=getattr(image.core, 'set_'+'alignment')\nsetter(64)\n",
        ):
            self.add_source(source)
            self.assert_held("alignment" if "set_" in source else "PILLOW_ALIGNMENT")

    def test_alignment_read_by_checker(self):
        self.add_source(
            "import os\npresent = 'PILLOW_ALIGNMENT' in os.environ\n",
            "scripts/new_checker.py",
        )
        self.assertEqual(guard.validate(self.root), [])

    def test_renderer_change(self):
        path = self.root / guard.RENDERER
        path.write_text(path.read_text() + "\n# Requires a new review.\n")
        self.assert_held("caller fingerprint changed")

    def test_existing_pil_test_change(self):
        path = self.root / guard.PIL_TEST
        path.write_text(path.read_text() + "\n# Requires a new review.\n")
        self.assert_held("caller fingerprint changed")

    def test_new_burn_pixels_caller(self):
        self.add_source(
            "from alethical.pipeline.tv_ad_redaction import burn_pixels as paint\npaint(1,1,bytearray(3),[])\n"
        )
        self.assert_held("burn_pixels reference")

    def test_new_renderer_import(self):
        self.add_source(
            "from alethical.pipeline import tv_ad_redaction as renderer\nrenderer.render_redacted(data,[])\n"
        )
        self.assert_held("import boundary changed")

    def test_new_caller_in_existing_service(self):
        path = self.root / guard.SERVICE
        path.write_text(
            path.read_text()
            + "\ndef added_call(data):\n    paint = tv_ad_redaction.render_redacted\n    return paint(data, [])\n"
        )
        self.assert_held("new renderer caller")

    def test_changed_reviewed_caller(self):
        path = self.root / guard.SERVICE
        path.write_text(
            path.read_text().replace("include_pdf=False,", "include_pdf=True,")
        )
        self.assert_held("caller render_original_page changed")

    def test_benign_same_service_change(self):
        path = self.root / guard.SERVICE
        path.write_text(
            path.read_text() + "\ndef unrelated_new_helper():\n    return 42\n"
        )
        self.assertEqual(guard.validate(self.root), [])

    def test_benign_unrelated_source_test_and_fixture_string(self):
        self.add_source("def helper():\n    return 42\n")
        self.add_source(
            'fixture = "from PIL import Image\\nimage.fromarrow(value)"\n',
            "scripts/tests/test_new_fixture.py",
        )
        self.assertEqual(guard.validate(self.root), [])

    def test_parse_error(self):
        self.add_source("def broken(:\n")
        self.assert_held("cannot be read and parsed")

    def test_deleted_tracked_source(self):
        self.add_source("value = 1\n")
        (self.root / "alethical/new_source.py").unlink()
        self.assert_held("cannot be read and parsed")

    def test_working_tree_symlink(self):
        self.add_source("value = 1\n")
        path = self.root / "alethical/new_source.py"
        path.unlink()
        path.symlink_to(self.root / guard.RENDERER)
        self.assert_held("cannot be read and parsed")

    def test_tracked_symlink(self):
        path = self.root / "alethical/linked.py"
        path.symlink_to(self.root / guard.RENDERER)
        self.git("add", "--", "alethical/linked.py")
        self.assert_held("cannot establish tracked regular files")

    def test_bad_lock(self):
        (self.root / "uv.lock").write_text("not = [valid TOML")
        self.assert_held("cannot be validated")

    def test_missing_tracked_boundary(self):
        self.git("rm", "--cached", "--", guard.RENDERER)
        self.assert_held("cannot establish tracked regular files")

    def test_checker_can_scan_its_own_source(self):
        self.add_source(
            Path(guard.__file__).read_text(), "scripts/pillow_source_guard.py"
        )
        self.assertEqual(guard.validate(self.root), [])


if __name__ == "__main__":
    unittest.main()
