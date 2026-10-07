"""Actual runner output, exact source matching, and honest absence of evidence."""

import copy
from contextlib import nullcontext
import json
import os
import subprocess
import signal
import time
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path
from unittest.mock import patch

from scripts import repeat_failure_runs as runs


def junit(names=None, outcome=None):
    suite = ET.Element("testsuite", tests="0", failures="0", errors="0", skipped="0")
    for classname, name in sorted(runs.EXPECTED if names is None else names):
        test = ET.SubElement(suite, "testcase", classname=classname, name=name)
        if outcome:
            ET.SubElement(test, outcome)
    suite.set("tests", str(len(suite)))
    if outcome:
        suite.set(
            {"failure": "failures", "error": "errors", "skipped": "skipped"}[outcome],
            str(len(suite)),
        )
    return ET.tostring(suite)


class RunEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.output = self.root / ".tmp" / "run"
        self.xml = self.root / "report.xml"

    def test_named_results_pass_but_missing_skipped_failed_do_not(self):
        self.xml.write_bytes(junit())
        self.assertEqual(len(runs.junit_results(self.xml)), 3)
        for content in [
            junit(names=[]),
            junit(names=list(runs.EXPECTED)[:2]),
            junit(outcome="skipped"),
            junit(outcome="failure"),
            junit(outcome="error"),
        ]:
            self.xml.write_bytes(content)
            with self.subTest(content=content), self.assertRaises(runs.ReviewError):
                runs.junit_results(self.xml)

    def test_comments_counts_truncation_and_wrong_class_are_not_run_proof(self):
        valid = junit()
        wrong_class = {
            (f"other.{classname}", name) for classname, name in runs.EXPECTED
        }
        for content in [
            b"<!-- " + valid + b" -->",
            valid[:-4],
            valid.replace(b'tests="3"', b'tests="4"'),
            junit(wrong_class),
            b'<testsuite tests="3" failures="0" errors="0" skipped="0"/>',
        ]:
            self.xml.write_bytes(content)
            with self.subTest(content=content), self.assertRaises(runs.ReviewError):
                runs.junit_results(self.xml)

    def test_extra_prevention_parameter_requires_new_mapping(self):
        self.xml.write_bytes(
            junit(runs.EXPECTED | {(runs.CLASSNAME, f"{runs.CHANGED}[delta2]")})
        )
        with self.assertRaisesRegex(runs.ReviewError, "parameter cases changed"):
            runs.junit_results(self.xml)

    def test_duplicate_results_and_failed_unrelated_tests_are_rejected(self):
        suite = ET.fromstring(junit())
        suite.append(copy.deepcopy(suite[0]))
        suite.set("tests", "4")
        self.xml.write_bytes(ET.tostring(suite))
        with self.assertRaisesRegex(runs.ReviewError, "Duplicate"):
            runs.junit_results(self.xml)
        suite = ET.fromstring(junit())
        test = ET.SubElement(suite, "testcase", classname="other", name="test_other")
        ET.SubElement(test, "failure")
        suite.set("tests", "4")
        suite.set("failures", "1")
        self.xml.write_bytes(ET.tostring(suite))
        with self.assertRaisesRegex(runs.ReviewError, "failed tests"):
            runs.junit_results(self.xml)

    def init_repository(self):
        for command in [
            ["init", "-q"],
            ["config", "user.name", "Test"],
            ["config", "user.email", "test@example.com"],
        ]:
            runs.git(self.root, *command)
        (self.root / ".gitignore").write_text(".tmp/\n")
        (self.root / "source.py").write_text("value = 1\n")
        runs.git(self.root, "add", ".")
        runs.git(self.root, "commit", "-qm", "Fixture")

    def test_snapshot_tracks_content_modes_untracked_and_ignored_output(self):
        self.init_repository()
        before = runs.snapshot(self.root)
        self.assertTrue(before["clean"])
        self.output.mkdir(parents=True)
        (self.output / "receipt.json").write_text("temporary")
        self.assertEqual(before, runs.snapshot(self.root))
        (self.root / "source.py").write_text("value = 2\n")
        after = runs.snapshot(self.root)
        self.assertFalse(after["clean"])
        self.assertNotEqual(before["files"], after["files"])
        (self.root / "extra.py").write_text("value = 3\n")
        self.assertIn("extra.py", runs.snapshot(self.root)["files"])

    def test_source_symlink_escape_is_rejected(self):
        self.init_repository()
        (self.root / "outside").symlink_to("/etc/hosts")
        with self.assertRaisesRegex(runs.ReviewError, "symlink"):
            runs.snapshot(self.root)

    def fake_runner(self, command, root, env):
        Path(command[command.index("--junitxml") + 1]).write_bytes(junit())
        self.assertNotIn("PYTEST_ADDOPTS", env)
        self.assertNotIn("OPENAI_API_KEY", env)
        return 0

    def test_capture_and_clean_exact_release_check(self):
        self.init_repository()
        with (
            patch.object(runs, "expected_cases", return_value=["browser-case"]),
            patch.object(runs, "run_command", side_effect=self.fake_runner),
        ):
            receipt = runs.run(self.root, "money", self.output)
            self.assertEqual(receipt["status"], "passed")
            self.assertEqual(
                runs.check(self.root, self.output, receipt["source"]["commit"]), receipt
            )
            with self.assertRaisesRegex(runs.ReviewError, "requested release"):
                runs.check(self.root, self.output, "a" * 40)
            (self.output / "pytest.xml").write_bytes(junit() + b"\n")
            with self.assertRaisesRegex(runs.ReviewError, "changed after capture"):
                runs.check(self.root, self.output, receipt["source"]["commit"])

    def test_dirty_receipt_never_proves_clean_release(self):
        self.init_repository()
        (self.root / "source.py").write_text("value = 2\n")
        with (
            patch.object(runs, "expected_cases", return_value=[]),
            patch.object(runs, "run_command", side_effect=self.fake_runner),
        ):
            receipt = runs.run(self.root, "money", self.output)
            self.assertFalse(receipt["source"]["clean"])
            with self.assertRaisesRegex(runs.ReviewError, "clean release"):
                runs.check(self.root, self.output, receipt["source"]["commit"])
            runs.git(self.root, "add", "source.py")
            runs.git(self.root, "commit", "-qm", "Changed")
            with self.assertRaisesRegex(runs.ReviewError, "Receipt source"):
                runs.check(self.root, self.output, runs.snapshot(self.root)["commit"])

    def test_source_change_during_run_records_no_success(self):
        self.init_repository()

        def changed(command, root, env):
            self.fake_runner(command, root, env)
            (self.root / "source.py").write_text("value = 2\n")
            return 0

        with (
            patch.object(runs, "expected_cases", return_value=[]),
            patch.object(runs, "run_command", side_effect=changed),
        ):
            with self.assertRaisesRegex(runs.ReviewError, "Source changed"):
                runs.run(self.root, "money", self.output)
        self.assertEqual(
            json.loads((self.output / "receipt.json").read_text())["status"],
            "incomplete",
        )

    def test_process_failure_or_interruption_cannot_reuse_old_success(self):
        self.init_repository()
        for index, outcome in enumerate([1, KeyboardInterrupt(), OSError()]):
            output = self.root / ".tmp" / str(index)
            with (
                patch.object(runs, "expected_cases", return_value=[]),
                patch.object(
                    runs,
                    "run_command",
                    side_effect=outcome if isinstance(outcome, BaseException) else None,
                    return_value=outcome,
                ),
            ):
                with self.assertRaises((runs.ReviewError, KeyboardInterrupt, OSError)):
                    runs.run(self.root, "money", output)
            self.assertEqual(
                json.loads((output / "receipt.json").read_text())["status"],
                "incomplete",
            )
            with self.assertRaises(FileExistsError):
                runs.run(self.root, "money", output)

    def test_child_environment_excludes_credentials_and_plugin_overrides(self):
        env = {
            "PATH": os.environ.get("PATH", ""),
            "OPENAI_API_KEY": "fake-only",
            "DATABASE_URL": "private-value",
            "PYTEST_ADDOPTS": "--ignore=alethical/tests",
            "PYTHONPATH": "elsewhere",
        }
        with patch.dict(os.environ, env, clear=True):
            child = runs.test_environment(self.root, self.output)
        self.assertNotIn("OPENAI_API_KEY", child)
        self.assertNotIn("PYTEST_ADDOPTS", child)
        self.assertNotIn("PYTHONPATH", child)
        self.assertIn("localhost:54329", child["DATABASE_URL"])
        (self.root / ".env").write_text("SOME_KEY=fake-only\n")
        with self.assertRaisesRegex(runs.ReviewError, "dotenv"):
            runs.test_environment(self.root, self.output)

    def test_interrupted_parent_exit_still_stops_owned_descendant(self):
        self.assert_owned_descendant_stopped(interrupt=True)

    def test_successful_parent_exit_still_stops_owned_descendant(self):
        self.assert_owned_descendant_stopped(interrupt=False)

    def assert_owned_descendant_stopped(self, interrupt):
        marker, ready = self.root / "stopped", self.root / "ready"
        child_code = (
            "import signal,time,sys; from pathlib import Path; "
            "signal.signal(signal.SIGTERM, lambda *_: "
            "(Path(sys.argv[1]).write_text('stopped'), sys.exit(0))); "
            "Path(sys.argv[2]).write_text('ready'); time.sleep(60)"
        )
        parent_code = (
            "import subprocess,sys,time,signal,os; "
            "signal.signal(signal.SIGTERM, lambda *_: os._exit(0)); "
            "subprocess.Popen([sys.executable, '-c', sys.argv[1], sys.argv[2], sys.argv[3]]); "
            "from pathlib import Path\n"
            "while not Path(sys.argv[3]).exists(): time.sleep(0.01)\n"
            + ("time.sleep(60)" if interrupt else "")
        )
        child = subprocess.Popen(
            [sys.executable, "-c", parent_code, child_code, str(marker), str(ready)],
            start_new_session=True,
        )
        try:
            deadline = time.monotonic() + 5
            while not ready.exists() and time.monotonic() < deadline:
                time.sleep(0.01)
            self.assertTrue(ready.exists())
            real_wait, calls = child.wait, []

            def interrupted_wait(*args, **kwargs):
                calls.append(1)
                if len(calls) == 1:
                    raise KeyboardInterrupt
                return real_wait(*args, **kwargs)

            with (
                patch.object(runs.subprocess, "Popen", return_value=child),
                (
                    patch.object(child, "wait", side_effect=interrupted_wait)
                    if interrupt
                    else nullcontext()
                ),
            ):
                if interrupt:
                    with self.assertRaises(KeyboardInterrupt):
                        runs.run_command([], self.root, {})
                else:
                    self.assertEqual(runs.run_command([], self.root, {}), 0)
            self.assertEqual(child.returncode, 0)
            self.assertEqual(marker.read_text(), "stopped")
        finally:
            try:
                os.killpg(child.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            child.wait()


if __name__ == "__main__":
    unittest.main()
