"""The runtime proof is required even when package scanners report no findings."""

from copy import deepcopy
import json
from pathlib import Path
import subprocess
import sys

import pytest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
from scripts import check_technology_health as scanner  # noqa: E402

GHSA = "GHSA-654x-cwwv-5j9c"
CVE = "CVE-2026-114501"


def exact_finding():
    return {"id": GHSA, "aliases": [CVE], "fix_versions": []}


def report(vulnerabilities=None, *, name="pillow", version="13.0.0"):
    return {
        "dependencies": [
            {"name": name, "version": version, "vulns": vulnerabilities or []}
        ]
    }


def result(payload, status=1):
    return subprocess.CompletedProcess([], status, json.dumps(payload), "")


@pytest.fixture
def clean_scanners(monkeypatch):
    """Mock scanner/provider I/O, never the exception verification by default."""
    findings = []
    commands = []
    monkeypatch.setattr(scanner, "extra_security_inventory", lambda _: ([], set(), []))
    monkeypatch.setattr(
        scanner, "locked_python_packages", lambda _: [("pillow", "13.0.0")]
    )
    monkeypatch.setattr(scanner, "_source_versions", lambda *_: ["2.10.1"])

    def run(command, root):
        commands.append(command)
        if command[0] == "uvx":
            return result(report(findings), int(bool(findings)))
        if command == ["pnpm", "audit", "--json"]:
            return result({"advisories": {}, "metadata": {"totalDependencies": 1}}, 0)
        if command[0] in {"uv", "node"} or command[:2] == ["pnpm", "install"]:
            return subprocess.CompletedProcess(command, 0, "", "")
        pytest.fail("Unexpected external scanner command")

    monkeypatch.setattr(scanner, "_run", run)
    return findings, commands


def test_failed_runtime_proof_blocks_clean_python_and_javascript(
    monkeypatch, clean_scanners
):
    calls = []
    monkeypatch.setattr(
        scanner, "verify_pillow_exception", lambda root: calls.append(root) or False
    )
    problems = scanner.run_security_audits(ROOT)
    assert calls == [ROOT]
    assert len(problems) == 1
    assert "Pillow exception could not verify" in problems[0]
    assert any(command[0] == "uvx" for command in clean_scanners[1])
    assert ["pnpm", "audit", "--json"] in clean_scanners[1]


def test_security_only_exits_nonzero_when_proof_fails_and_scanners_clean(
    monkeypatch, clean_scanners, capsys
):
    monkeypatch.setattr(scanner, "verify_pillow_exception", lambda _: False)
    monkeypatch.setattr(
        sys,
        "argv",
        [str(ROOT / "scripts/check_technology_health.py"), "--security-only"],
    )
    assert scanner.main() == 1
    assert "Pillow exception could not verify" in capsys.readouterr().out


def test_real_verification_wrapper_failure_is_a_release_blocker(
    monkeypatch, clean_scanners, capsys
):
    calls = []

    def failed_child(command, **kwargs):
        calls.append((command, kwargs))
        return subprocess.CompletedProcess(
            command, 1, "Source check failed.\n", "private provider details"
        )

    monkeypatch.setattr(scanner.subprocess, "run", failed_child)
    problems = scanner.run_security_audits(ROOT)
    assert any("Pillow exception could not verify" in problem for problem in problems)
    assert len(calls) == 1
    assert calls[0][0] == [sys.executable, "-m", "scripts.check_pillow_exception"]
    assert calls[0][1]["cwd"] == ROOT
    assert calls[0][1]["timeout"] == 600
    assert "private provider details" not in capsys.readouterr().out


@pytest.mark.parametrize(
    "error", [FileNotFoundError(), subprocess.TimeoutExpired("proof", 600)]
)
def test_missing_or_timed_out_verifier_blocks_clean_scan(
    monkeypatch, clean_scanners, error
):
    def failed_child(*_, **__):
        raise error

    monkeypatch.setattr(scanner.subprocess, "run", failed_child)
    assert any(
        "Pillow exception could not verify" in problem
        for problem in scanner.run_security_audits(ROOT)
    )


def test_verified_proof_allows_clean_scanners(monkeypatch, clean_scanners):
    monkeypatch.setattr(scanner, "verify_pillow_exception", lambda _: True)
    assert scanner.run_security_audits(ROOT) == []


@pytest.mark.parametrize("verified", [False, True])
def test_exact_finding_needs_verified_proof_end_to_end(
    monkeypatch, clean_scanners, verified
):
    clean_scanners[0].append(exact_finding())
    monkeypatch.setattr(scanner, "verify_pillow_exception", lambda _: verified)
    problems = scanner.run_security_audits(ROOT)
    if verified:
        assert problems == []
    else:
        assert any(
            "Pillow exception could not verify" in problem for problem in problems
        )
        assert f"pillow 13.0.0: {GHSA}" in problems


@pytest.mark.parametrize(
    "finding",
    [
        {"id": GHSA, "aliases": [CVE], "fix_versions": []},
        {"id": CVE, "aliases": [GHSA], "fix_versions": []},
        {"id": GHSA, "aliases": [], "fix_versions": []},
        {"id": GHSA, "fix_versions": []},
    ],
)
def test_only_recognized_advisory_forms_with_no_fix_can_pass(finding):
    assert (
        scanner.security_audit_problems(
            result(report([finding])),
            "Python",
            expected_python={("pillow", "13.0.0")},
            pillow_exception_verified=True,
        )
        == []
    )


@pytest.mark.parametrize(
    "mutation",
    [
        lambda dependency: dependency.update(name="other-package"),
        lambda dependency: dependency.update(version="13.0.1"),
        lambda dependency: dependency["vulns"][0].update(id="GHSA-other-advisory"),
        lambda dependency: dependency["vulns"][0].update(id="PYSEC-other"),
        lambda dependency: dependency["vulns"][0].update(
            aliases=[CVE, "GHSA-other-advisory"]
        ),
        lambda dependency: dependency["vulns"][0].update(aliases=[None]),
        lambda dependency: dependency["vulns"][0].update(aliases=CVE),
        lambda dependency: dependency["vulns"][0].update(aliases=None),
        lambda dependency: dependency["vulns"][0].update(fix_versions=["13.0.1"]),
        lambda dependency: dependency["vulns"][0].update(fix_versions=None),
        lambda dependency: dependency["vulns"][0].update(fix_versions=""),
        lambda dependency: dependency["vulns"][0].pop("fix_versions"),
    ],
)
def test_verified_runtime_never_hides_changed_or_unidentified_warning(mutation):
    payload = report([exact_finding()])
    mutation(payload["dependencies"][0])
    assert scanner.security_audit_problems(
        result(payload), "Python", pillow_exception_verified=True
    )


def test_default_classifier_does_not_assume_verification():
    payload = report([exact_finding()])
    assert scanner.python_audit_problems(payload) == [f"pillow 13.0.0: {GHSA}"]
    assert scanner.security_audit_problems(result(payload), "Python") == [
        f"pillow 13.0.0: {GHSA}"
    ]


def test_known_warning_does_not_hide_second_warning_for_same_package():
    payload = report(
        [
            exact_finding(),
            {"id": "GHSA-another-pillow-risk", "aliases": [], "fix_versions": []},
        ]
    )
    assert scanner.security_audit_problems(
        result(payload), "Python", pillow_exception_verified=True
    ) == ["pillow 13.0.0: GHSA-another-pillow-risk"]


def test_known_warning_does_not_hide_same_id_for_other_package():
    payload = report([exact_finding()])
    second = deepcopy(payload["dependencies"][0])
    second["name"] = "other-package"
    payload["dependencies"].append(second)
    assert scanner.security_audit_problems(
        result(payload), "Python", pillow_exception_verified=True
    ) == [f"other-package 13.0.0: {GHSA}"]


def test_verified_exception_does_not_hide_missing_locked_package():
    assert any(
        "cover every locked package" in problem
        for problem in scanner.security_audit_problems(
            result(report([exact_finding()])),
            "Python",
            expected_python={("pillow", "13.0.0"), ("other", "1")},
            pillow_exception_verified=True,
        )
    )


def test_verified_exception_does_not_hide_scanner_failure():
    assert any(
        "did not complete successfully" in problem
        for problem in scanner.security_audit_problems(
            result(report([exact_finding()]), 2),
            "Python",
            pillow_exception_verified=True,
        )
    )


def test_pillow_proof_cannot_exempt_javascript_finding():
    payload = {
        "advisories": {
            GHSA: {
                "github_advisory_id": GHSA,
                "module_name": "pillow",
                "severity": "high",
                "patched_versions": "<0.0.0",
                "findings": [{"version": "13.0.0", "paths": ["root>pillow"]}],
            }
        },
        "metadata": {"totalDependencies": 1},
    }
    assert scanner.security_audit_problems(
        result(payload), "JavaScript", pillow_exception_verified=True
    ) == [f"{GHSA} (high)"]
