#!/usr/bin/env python3
"""Run pytest once and retain named prevention results for that source snapshot.

Receipts detect drift and incomplete results, not forged output or a hostile host.
Only the reviewed money invariant has executable result mapping here. Browser and
frontend checks remain separate and are never inferred from retained source names.

A backend run also proves it ran every test: before pytest runs, a separate
collection lists every test in the suite, and afterwards the results must hold
exactly those tests, each passed, with skips allowed only for the tests named in
EXPECTED_SKIPS. A count is not that proof: a skipped test still has a result row,
and equal counts can hide a swapped name.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
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
EXPECTED_SKIPS = "alethical/tests/expected_skips.json"
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


def junit_outcomes(path):
    """Every testcase identity and its outcome, never a report's claimed total alone."""
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
    return results


def junit_results(path):
    """Read testcases, never a report's claimed pass total alone."""
    results = junit_outcomes(path)
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


def junit_identity(nodeid):
    """The (classname, name) pytest's JUnit report gives a collected node id."""
    path, bracket, params = nodeid.partition("[")
    names = path.split("::")
    require(
        len(names) >= 2 and names[0].endswith(".py"), "Unreadable collected test id"
    )
    names[0] = names[0][: -len(".py")].replace("/", ".")
    names[-1] += bracket + params
    return ".".join(names[:-1]), names[-1]


def collected_tests(output_text):
    """Test identities from `pytest --collect-only -q`, refusing duplicates.

    The node ids come first, one per line, ending at the first blank line; later
    sections (warnings, the summary) can repeat an id, so they are not read. The
    summary's own count must match the ids read.
    """
    lines = output_text.splitlines()
    start = next(
        (index for index, line in enumerate(lines) if ".py::" in line.split(" ")[0]),
        None,
    )
    require(start is not None, "Collection listed no tests")
    end = next(
        (index for index in range(start, len(lines)) if not lines[index].strip()), None
    )
    require(end is not None, "Collection output has no end of the test list")
    identities = [junit_identity(line.strip()) for line in lines[start:end]]
    require(identities, "Collection listed no tests")
    require(len(set(identities)) == len(identities), "Collection listed a test twice")
    counts = [
        int(match.group(1))
        for line in lines[end:]
        if (match := re.match(r"^=*\s*(\d+) tests? collected", line))
    ]
    require(
        counts == [len(identities)], "Collection count disagrees with its listed tests"
    )
    return sorted(identities)


def expected_skips(root):
    """Tests allowed to skip in CI, each with the reason it cannot run there."""
    try:
        entries = json.loads((Path(root) / EXPECTED_SKIPS).read_text())
    except (OSError, ValueError) as exc:
        raise ReviewError("Expected-skip list is missing or unreadable") from exc
    require(
        isinstance(entries, list)
        and all(
            isinstance(entry, dict)
            and {"classname", "name", "reason"} <= entry.keys()
            and all(isinstance(entry[key], str) and entry[key] for key in entry)
            for entry in entries
        ),
        "Expected-skip list is malformed",
    )
    return {(entry["classname"], entry["name"]) for entry in entries}


def coverage(collected, outcomes, allowed_skips):
    """Require the results to be exactly the collected tests, each passed."""
    expected = {tuple(identity) for identity in collected}
    missing = sorted(expected - outcomes.keys())
    extra = sorted(outcomes.keys() - expected)
    require(
        not missing,
        f"{len(missing)} collected tests have no result, e.g. {'::'.join(missing[0])}"
        if missing
        else "",
    )
    require(
        not extra,
        f"{len(extra)} results were never collected, e.g. {'::'.join(extra[0])}"
        if extra
        else "",
    )
    skipped = sorted(key for key, outcome in outcomes.items() if outcome == "skipped")
    unexpected = [key for key in skipped if key not in allowed_skips]
    require(
        not unexpected,
        f"{len(unexpected)} tests skipped without being allowed, e.g. {'::'.join(unexpected[0])}"
        if unexpected
        else "",
    )
    require(
        all(outcome in {"passed", "skipped"} for outcome in outcomes.values()),
        "The pytest run contains failed tests",
    )
    return {
        "collected": len(expected),
        "passed": sum(outcome == "passed" for outcome in outcomes.values()),
        "allowed_skips": [{"classname": c, "name": n} for c, n in skipped],
    }


def collect(root, env, output):
    """List every test in a separate pytest process, independent of the run."""
    with (output / "collect.log").open("w") as log:
        child = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "pytest",
                "--collect-only",
                "-q",
                "-p",
                "no:cacheprovider",
            ],
            cwd=root,
            env=env,
            stdout=subprocess.PIPE,
            stderr=log,
            text=True,
            start_new_session=True,
        )
        try:
            listing, _ = child.communicate()
        finally:
            if child.poll() is None:
                child.kill()
                child.wait()
            stop_descendants(child.pid)
    require(child.returncode == 0, "Test collection failed; see collect.log")
    return collected_tests(listing)


def prepare_worker_databases(root, env, workers):
    """Migrate the job database once, then copy it once per pytest-xdist worker.

    Copies come from PostgreSQL's template mechanism, so the migration runs once.
    Every copy exists and is migrated before pytest starts: a worker whose first
    test module replaces the seeding fixture still finds the schema.
    """
    require("GITHUB_ACTIONS" in env, "Parallel workers need the GitHub job database")
    migrate = [sys.executable, "-m", "alembic", "-c", "alembic.ini", "upgrade", "head"]
    require(run_command(migrate, root, env) == 0, "Migrating the test database failed")
    from sqlalchemy import create_engine
    from sqlalchemy.engine import make_url

    base = make_url(env["DATABASE_URL"])
    require(
        base.database == "alethical", "Parallel workers copy the alethical database"
    )
    admin = create_engine(base.set(database="postgres"), isolation_level="AUTOCOMMIT")
    try:
        with admin.connect() as connection:
            for index in range(workers):
                name = f"alethical_gw{index}"
                connection.exec_driver_sql(f'DROP DATABASE IF EXISTS "{name}"')
                connection.exec_driver_sql(
                    f'CREATE DATABASE "{name}" TEMPLATE "alethical"'
                )
    finally:
        admin.dispose()


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


def run(root, scope, output, workers=0):
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
        if os.environ.get("GITHUB_RUN_ID", "").isdigit():
            receipt["github_run"] = {
                "id": os.environ["GITHUB_RUN_ID"],
                "attempt": os.environ.get("GITHUB_RUN_ATTEMPT", ""),
            }
        require(
            not workers or scope == "backend", "Only backend runs use parallel workers"
        )
        receipt["workers"] = workers
        if scope == "backend":
            # Lists, as the receipt's JSON stores them.
            receipt["collected_tests"] = [
                list(test) for test in collect(root, env, output)
            ]
        command = [sys.executable, "-m", "pytest"]
        if workers:
            prepare_worker_databases(root, env, workers)
            command.extend(["-n", str(workers), "--max-worker-restart", "0"])
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
        if scope == "backend":
            receipt["coverage"] = coverage(
                receipt["collected_tests"],
                junit_outcomes(output / "pytest.xml"),
                expected_skips(root),
            )
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
    if receipt.get("scope") == "backend":
        require(
            isinstance(receipt.get("collected_tests"), list)
            and receipt.get("coverage")
            == coverage(
                receipt["collected_tests"],
                junit_outcomes(Path(output) / "pytest.xml"),
                expected_skips(root),
            ),
            "Receipt does not prove every collected test ran",
        )
    if os.environ.get("GITHUB_RUN_ID", "").isdigit():
        require(
            receipt.get("github_run", {}).get("id") == os.environ["GITHUB_RUN_ID"],
            "Receipt comes from a different GitHub run",
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
            command.add_argument(
                "--workers",
                type=int,
                default=0,
                help="pytest-xdist workers, each with its own database (GitHub only)",
            )
        else:
            command.add_argument("--commit", required=True)
    args = parser.parse_args(argv)
    previous = signal.signal(
        signal.SIGTERM, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt())
    )
    try:
        receipt = (
            run(args.root, args.scope, args.output, args.workers)
            if args.command == "run"
            else check(args.root, args.output, args.commit)
        )
        print(
            f"{len(receipt['passed_tests'])} named money-prevention tests passed; {len(receipt['not_run_cases'])} other registered cases have no run proof here."
        )
        if "coverage" in receipt:
            summary = receipt["coverage"]
            print(
                f"All {summary['collected']} collected tests ran: {summary['passed']} passed, "
                f"{len(summary['allowed_skips'])} allowed skips."
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
