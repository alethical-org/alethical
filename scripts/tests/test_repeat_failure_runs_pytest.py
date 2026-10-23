"""Integration check requiring the project's installed pytest (backend CI)."""

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts import repeat_failure_runs as runs


class PytestOutputTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.xml = self.root / "report.xml"

    def test_real_pytest_output_works_and_comment_only_test_fails(self):
        # A tiny real pytest subprocess proves output parsing and collection agree.
        # It uses no application conftest, database, paid service or browser.
        testfile = self.root / "test_example.py"
        testfile.write_text("def test_example():\n    assert True\n")
        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "pytest",
                str(testfile),
                "--confcutdir",
                str(self.root),
                "--junitxml",
                str(self.xml),
                "-q",
            ],
            cwd=self.root,
            capture_output=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        with patch.object(runs, "EXPECTED", {("test_example", "test_example")}):
            self.assertEqual(len(runs.junit_results(self.xml)), 1)
            testfile.write_text("# def test_example():\n#     assert True\n")
            result = subprocess.run(
                [
                    sys.executable,
                    "-m",
                    "pytest",
                    str(testfile),
                    "--confcutdir",
                    str(self.root),
                    "--junitxml",
                    str(self.xml),
                    "-q",
                ],
                cwd=self.root,
                capture_output=True,
            )
            self.assertEqual(result.returncode, 5)
            with self.assertRaises(runs.ReviewError):
                runs.junit_results(self.xml)

    def test_real_groups_combine_new_files_class_members_and_matching_attempt(self):
        (self.root / ".gitignore").write_text(".tmp/\n__pycache__/\n.pytest_cache/\n")
        (self.root / ".env").write_text("")
        (self.root / "test_money.py").write_text(
            "import pytest\n"
            "@pytest.mark.parametrize('delta', [1, -1])\n"
            "def test_changed(delta):\n    assert delta\n"
            "def test_carried():\n    assert True\n"
        )
        (self.root / "test_new.py").write_text(
            "class TestGroup:\n    def test_member(self):\n        assert True\n"
        )
        timings = self.root / runs.FILE_DURATIONS
        timings.parent.mkdir()
        timings.write_text(json.dumps({"seconds": {"test_money.py": 20}}))
        for args in (
            ("init", "-q"),
            ("config", "user.name", "Test"),
            ("config", "user.email", "test@example.invalid"),
            ("add", "."),
            ("commit", "-qm", "Real group fixture"),
        ):
            runs.git(self.root, *args)
        expected = {
            ("test_money", "test_changed[1]"),
            ("test_money", "test_changed[-1]"),
            ("test_money", "test_carried"),
        }
        outputs = [self.root / ".tmp" / f"group-{group}" for group in (1, 2)]
        with (
            patch.object(runs, "EXPECTED", expected),
            patch.object(runs, "CLASSNAME", "test_money"),
            patch.object(runs, "CHANGED", "test_changed"),
            patch.object(runs, "CARRIED", "test_carried"),
            patch.object(runs, "expected_cases", return_value=[]),
            patch.object(runs, "expected_skips", return_value=set()),
            patch.dict(os.environ, {"GITHUB_RUN_ID": "123", "GITHUB_RUN_ATTEMPT": "2"}),
        ):
            for group, output in enumerate(outputs, 1):
                runs.run(self.root, "backend", output, group=group)
            commit = runs.git(self.root, "rev-parse", "HEAD").decode().strip()
            result = runs.combined_results(self.root, outputs, commit)
        self.assertEqual(result["coverage"]["collected"], 4)
        self.assertEqual(result["coverage"]["passed"], 4)
        self.assertEqual(len(result["passed_tests"]), 3)

    def test_real_collection_lists_every_test_and_rejects_a_broken_file(self):
        (self.root / "test_listing.py").write_text(
            "import pytest\n\n"
            "@pytest.mark.parametrize('value', [1, 2])\n"
            "def test_value(value):\n    assert value\n\n"
            "class TestGroup:\n    def test_member(self):\n        assert True\n"
        )
        output = self.root / "out"
        output.mkdir()
        env = {"PATH": os.environ.get("PATH", "")}
        self.assertEqual(
            runs.collect(self.root, env, output),
            [
                ("test_listing", "test_value[1]"),
                ("test_listing", "test_value[2]"),
                ("test_listing.TestGroup", "test_member"),
            ],
        )
        (self.root / "test_broken.py").write_text("def test_broken(:\n")
        with self.assertRaisesRegex(runs.ReviewError, "collection failed"):
            runs.collect(self.root, env, output)


if __name__ == "__main__":
    unittest.main()
