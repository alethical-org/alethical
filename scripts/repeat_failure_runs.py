#!/usr/bin/env python3
"""Run pytest once and retain named prevention results for that source snapshot.

Receipts detect drift and incomplete results, not forged output or a hostile host.
Only the reviewed money invariant has executable result mapping here. Browser and
frontend checks remain separate and are never inferred from retained source names.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import signal
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

if __package__ in {None, ""}:  # Direct script invocation.
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.review_repeat_failures import ReviewError, atomic_write, load, require

REGISTRY = "docs/operations/repeat-failure-cases.json"
TEST_FILE = "alethical/tests/test_campaign_finance_load.py"
CASE = "reviewed-money-exception-identity"
CHANGED = "test_changed_itemized_amount_cannot_reuse_a_previous_reconcile_waiver"
CARRIED = "test_a_reconcile_committee_year_waived_on_the_published_release_is_carried_not_failed"
CLASSNAME = "alethical.tests.test_campaign_finance_load"
# pytest's Decimal parameters receive these generated IDs. Both must run.
EXPECTED = {
    (CLASSNAME, f"{CHANGED}[delta0]"),
    (CLASSNAME, f"{CHANGED}[delta1]"),
    (CLASSNAME, CARRIED),
}


def git(root, *args):
    result = subprocess.run(["git", *args], cwd=root, capture_output=True, check=False)
    require(result.returncode == 0, "Cannot establish Git source identity")
    return result.stdout


def digest(path):
    with Path(path).open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def snapshot(root):
    root = Path(root).resolve()
    require(
        Path(os.fsdecode(git(root, "rev-parse", "--show-toplevel")).strip()).resolve()
        == root,
        "Use the repository root",
    )
    paths = git(
        root, "ls-files", "-z", "--cached", "--others", "--exclude-standard"
    ).split(b"\0")
    files = {}
    for raw in sorted(set(filter(None, paths))):
        name = os.fsdecode(raw)
        path = root / name
        require(path.resolve().is_relative_to(root), "Source symlink leaves repository")
        require(path.is_file(), "Source file missing or unsupported")
        files[name] = {
            "sha256": digest(path),
            "mode": path.lstat().st_mode,
            "link": os.readlink(path) if path.is_symlink() else None,
        }
    return {
        "commit": git(root, "rev-parse", "HEAD").decode().strip(),
        "clean": not bool(
            git(root, "status", "--porcelain=v1", "--untracked-files=all")
        ),
        "files": files,
    }


def expected_cases(root):
    review = load(Path(root) / REGISTRY)
    cases = [case for case in review["cases"] if case["id"] == CASE]
    require(len(cases) == 1, "Registered money prevention case missing or repeated")
    retained = {
        (check["path"], check["anchor"]) for check in cases[0]["prevention"]["checks"]
    }
    require(
        retained == {(TEST_FILE, CHANGED), (TEST_FILE, CARRIED)},
        "Registered money checks changed; update executable result mapping",
    )
    return [case["id"] for case in review["cases"] if case["id"] != CASE]


def junit_results(path):
    """Read testcases, never a report's claimed pass total alone."""
    raw = Path(path).read_bytes()
    require(
        b"<!DOCTYPE" not in raw and b"<!ENTITY" not in raw,
        "Unsupported JUnit declarations",
    )
    try:
        root = ET.fromstring(raw)
    except ET.ParseError as exc:
        raise ReviewError("Incomplete or invalid JUnit output") from exc
    require(root.tag in {"testsuites", "testsuite"}, "Invalid JUnit root")
    suites = [root] if root.tag == "testsuite" else list(root)
    require(
        suites and all(suite.tag == "testsuite" for suite in suites),
        "Missing JUnit suites",
    )
    results = {}
    for suite in suites:
        tests = suite.findall("testcase")
        require(
            suite.get("tests") == str(len(tests)),
            "JUnit test total disagrees with actual results",
        )
        for field, tag in (
            ("failures", "failure"),
            ("errors", "error"),
            ("skipped", "skipped"),
        ):
            count = sum(test.find(tag) is not None for test in tests)
            require(
                suite.get(field) == str(count),
                "JUnit outcome totals disagree with actual results",
            )
        for test in tests:
            key = (test.get("classname"), test.get("name"))
            require(all(key), "JUnit result has no exact test identity")
            require(key not in results, "Duplicate JUnit test identity")
            require(
                test.get("status") in {None, "passed"}
                and test.get("result") in {None, "passed"},
                "JUnit result has unsupported outcome",
            )
            outcome = next(
                (
                    kind
                    for kind in ("failure", "error", "skipped")
                    if test.find(kind) is not None
                ),
                "passed",
            )
            results[key] = outcome
    require(results, "JUnit contains no executed tests")
    require(EXPECTED <= results.keys(), "Required named prevention results missing")
    actual_prevention = {
        key
        for key in results
        if key[0] == CLASSNAME and key[1].split("[", 1)[0] in {CHANGED, CARRIED}
    }
    require(
        not actual_prevention or actual_prevention == EXPECTED,
        "Prevention parameter cases changed; update executable result mapping",
    )
    require(
        all(results[key] == "passed" for key in EXPECTED),
        "Required prevention test failed or skipped",
    )
    require(
        not any(outcome in {"failure", "error"} for outcome in results.values()),
        "The pytest run contains failed tests",
    )
    return [{"classname": key[0], "name": key[1]} for key in sorted(EXPECTED)]


def test_environment(root, output):
    # Fail before importing the application, whose dotenv loader searches parents.
    for parent in (root, *root.parents):
        dotenv = parent / ".env"
        if dotenv.exists():
            require(
                not any(
                    "=" in line and not line.lstrip().startswith("#")
                    for line in dotenv.read_text().splitlines()
                ),
                "Use a working copy without dotenv settings for prevention runs",
            )
            break
    env = {
        key: value
        for key, value in os.environ.items()
        if key
        in {"PATH", "HOME", "TMPDIR", "TEMP", "TMP", "SYSTEMROOT", "LANG", "LC_ALL"}
    }
    # The existing database fixture checks this exact GitHub job contract again.
    github_job = (
        os.environ.get("GITHUB_ACTIONS") == "true"
        and os.environ.get("GITHUB_RUN_ID", "").isdigit()
        and Path(os.environ.get("GITHUB_WORKSPACE", "")).resolve() == root
    )
    if github_job:
        env.update(
            {
                key: os.environ[key]
                for key in ("GITHUB_ACTIONS", "GITHUB_RUN_ID", "GITHUB_WORKSPACE")
            }
        )
    env.update(
        {
            "ALETHICAL_DATABASE_TARGET": "local",
            "DATABASE_URL": "postgresql+psycopg://alethical:alethical@localhost:"
            + ("5432" if github_job else "54329")
            + "/alethical",
            "ALETHICAL_LOG_DIR": str(output / "logs"),
        }
    )
    return env


def stop_descendants(group):
    """Reap only the process group this invocation created, even if its leader left."""

    def send(sig):
        try:
            os.killpg(group, sig)
            return True
        except ProcessLookupError:
            return False

    if not send(signal.SIGTERM):
        return
    deadline = time.monotonic() + 2
    while time.monotonic() < deadline:
        if not send(0):
            return
        time.sleep(0.02)
    send(signal.SIGKILL)


def run_command(command, root, env):
    child = subprocess.Popen(command, cwd=root, env=env, start_new_session=True)
    try:
        return child.wait()
    finally:
        # SIGTERM unwinds pytest's owned database fixture. Its subprocesses may
        # outlive pytest, so also clean the owned group after the parent exits.
        if child.poll() is None:
            child.send_signal(signal.SIGTERM)
            try:
                child.wait(timeout=20)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait()
        stop_descendants(child.pid)


def run(root, scope, output):
    root, output = Path(root).resolve(), Path(output).resolve()
    require(
        output.is_relative_to(root / ".tmp"), "Run output must be inside ignored .tmp/"
    )
    require(
        git(root, "check-ignore", str(output)).strip(), "Run output must be Git-ignored"
    )
    output.mkdir(parents=True, exist_ok=False)  # Never reuse a previous run's output.
    receipt = {
        "schema_version": 1,
        "status": "incomplete",
        "scope": scope,
        "started_at": datetime.now(timezone.utc).isoformat(),
    }
    receipt_path = output / "receipt.json"
    atomic_write(receipt_path, json.dumps(receipt, indent=2) + "\n")
    try:
        receipt["not_run_cases"] = expected_cases(root)
        env = test_environment(root, output)
        receipt["source"] = snapshot(root)
        command = [sys.executable, "-m", "pytest"]
        if scope == "money":
            command.extend([f"{TEST_FILE}::{CHANGED}", f"{TEST_FILE}::{CARRIED}"])
        command.extend(
            ["--junitxml", str(output / "pytest.xml"), "-o", "junit_family=xunit2"]
        )
        receipt["command"] = command
        receipt["exit_code"] = run_command(command, root, env)
        receipt["source_after"] = snapshot(root)
        require(
            receipt["source"] == receipt["source_after"],
            "Source changed during pytest; rerun on stable files",
        )
        require(receipt["exit_code"] == 0, "Pytest did not complete successfully")
        receipt["passed_tests"] = junit_results(output / "pytest.xml")
        receipt["junit_sha256"] = digest(output / "pytest.xml")
        receipt["passed_case"] = CASE
        receipt["status"] = "passed"
    finally:
        receipt["finished_at"] = datetime.now(timezone.utc).isoformat()
        atomic_write(receipt_path, json.dumps(receipt, indent=2) + "\n")
    return receipt


def check(root, output, commit):
    require(
        len(commit) in {40, 64} and all(char in "0123456789abcdef" for char in commit),
        "Supply the exact full release commit",
    )
    try:
        receipt = json.loads((Path(output) / "receipt.json").read_text())
    except (ValueError, OSError) as exc:
        raise ReviewError("Missing or invalid run receipt") from exc
    require(
        isinstance(receipt, dict)
        and receipt.get("schema_version") == 1
        and receipt.get("status") == "passed"
        and type(receipt.get("exit_code")) is int
        and receipt["exit_code"] == 0,
        "Run did not complete successfully",
    )
    source = snapshot(root)
    require(source["clean"], "Current working files differ from a clean release")
    require(
        source["commit"] == commit,
        "Current checkout is not the requested release commit",
    )
    require(
        receipt.get("source") == source and receipt.get("source_after") == source,
        "Receipt source differs from the exact release",
    )
    require(
        receipt.get("junit_sha256") == digest(Path(output) / "pytest.xml"),
        "JUnit output changed after capture",
    )
    names = junit_results(Path(output) / "pytest.xml")
    require(
        receipt.get("passed_tests") == names and receipt.get("passed_case") == CASE,
        "Receipt does not match the named results",
    )
    require(
        receipt.get("not_run_cases") == expected_cases(root),
        "Receipt case coverage differs from registry",
    )
    return receipt


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("run", "check"):
        command = sub.add_parser(name)
        command.add_argument("--root", default=".")
        command.add_argument("--output", required=True)
        if name == "run":
            command.add_argument(
                "--scope", choices=("money", "backend"), default="money"
            )
        else:
            command.add_argument("--commit", required=True)
    args = parser.parse_args(argv)
    previous = signal.signal(
        signal.SIGTERM, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt())
    )
    try:
        receipt = (
            run(args.root, args.scope, args.output)
            if args.command == "run"
            else check(args.root, args.output, args.commit)
        )
        print(
            f"{len(receipt['passed_tests'])} named money-prevention tests passed; {len(receipt['not_run_cases'])} other registered cases have no run proof here."
        )
        if not receipt["source"]["clean"]:
            print("Working-tree result only: source differs from its saved commit.")
        return 0
    except (
        ReviewError,
        OSError,
        ValueError,
        subprocess.SubprocessError,
        KeyboardInterrupt,
    ) as exc:
        print(
            f"Prevention run failed: {exc}"
            if isinstance(exc, ReviewError)
            else "Prevention run incomplete: source, process, or output unavailable",
            file=sys.stderr,
        )
        return 1
    finally:
        signal.signal(signal.SIGTERM, previous)


if __name__ == "__main__":
    raise SystemExit(main())
