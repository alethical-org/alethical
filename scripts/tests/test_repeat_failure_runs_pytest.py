"""Integration check requiring the project's installed pytest (backend CI)."""

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


if __name__ == "__main__":
    unittest.main()
