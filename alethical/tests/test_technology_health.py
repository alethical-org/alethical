"""Keep Alethical's tools supported, consistent, and checked without paid services."""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from datetime import date
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "check_technology_health.py"
_spec = importlib.util.spec_from_file_location("check_technology_health", SCRIPT)
check_technology_health = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(check_technology_health)


def test_current_repository_has_consistent_versions_and_update_coverage() -> None:
    assert check_technology_health.find_local_problems(ROOT) == []


def test_unpinned_deployment_command_is_reported(tmp_path: Path) -> None:
    workflow = tmp_path / ".github" / "workflows"
    workflow.mkdir(parents=True)
    (workflow / "railway-deploy.yml").write_text(
        "run: npx --yes @railway/cli up --ci\n", encoding="utf-8"
    )

    problems = check_technology_health.find_unpinned_commands(tmp_path)

    assert problems == [
        ".github/workflows/railway-deploy.yml:1: @railway/cli has no saved version"
    ]


def test_unversioned_uv_install_is_reported(tmp_path: Path) -> None:
    workflow = tmp_path / ".github" / "workflows"
    workflow.mkdir(parents=True)
    (workflow / "check.yaml").write_text(
        """steps:
  - uses: astral-sh/setup-uv@v9.0.0
    with:
      enable-cache: true
""",
        encoding="utf-8",
    )

    assert check_technology_health.check_uv_versions(tmp_path) == [
        ".github/workflows/check.yaml:2: uv has no saved version"
    ]


def test_mismatched_uv_versions_are_reported(tmp_path: Path) -> None:
    workflow = tmp_path / ".github" / "workflows"
    workflow.mkdir(parents=True)
    (workflow / "check.yml").write_text(
        """steps:
  - uses: astral-sh/setup-uv@v9.0.0
    with:
      version: 0.12.5
  - uses: astral-sh/setup-uv@v9.0.0
    with:
      version: 0.12.6
""",
        encoding="utf-8",
    )

    problems = check_technology_health.check_uv_versions(tmp_path)

    assert len(problems) == 1
    assert "uv has 2 different saved versions" in problems[0]
    assert "0.12.5" in problems[0]
    assert "0.12.6" in problems[0]


def test_uv_public_release_follows_monthly_update_policy(
    monkeypatch, tmp_path: Path
) -> None:
    workflow = tmp_path / ".github" / "workflows"
    workflow.mkdir(parents=True)
    (workflow / "technology-health.yml").write_text(
        """steps:
  - uses: astral-sh/setup-uv@v9.0.0
    with:
      version: 0.12.5
""",
        encoding="utf-8",
    )
    uv_pin = next(
        pin for pin in check_technology_health.REGISTRY_PINS if pin.name == "uv"
    )
    monkeypatch.setattr(
        check_technology_health, "_latest_registry_version", lambda pin: "0.12.6"
    )

    routine, major = check_technology_health.check_registry_versions(tmp_path)

    assert "uv: 0.12.5 saved, 0.12.6 available" in routine
    assert not any(item.startswith("uv:") for item in major)
    assert uv_pin.registry == "github-release"

    monkeypatch.setattr(
        check_technology_health, "_latest_registry_version", lambda pin: "0.13.0"
    )
    routine, major = check_technology_health.check_registry_versions(tmp_path)

    assert not any(item.startswith("uv:") for item in routine)
    assert "uv: 0.12.5 saved, 0.13.0 available" in major


def test_inconsistent_pnpm_versions_are_reported(tmp_path: Path) -> None:
    (tmp_path / "package.json").write_text(
        json.dumps({"packageManager": "pnpm@10.33.0"}), encoding="utf-8"
    )
    app = tmp_path / "apps" / "frontend"
    app.mkdir(parents=True)
    (app / "package.json").write_text(
        json.dumps({"packageManager": "pnpm@10.34.0"}), encoding="utf-8"
    )

    problems = check_technology_health.check_version_group(
        tmp_path, check_technology_health.PNPM_VERSION
    )

    assert len(problems) == 1
    assert "pnpm has 2 different saved versions" in problems[0]
    assert "10.33.0" in problems[0]
    assert "10.34.0" in problems[0]


def test_support_window_warns_six_months_before_end() -> None:
    support = check_technology_health.SupportWindow(
        name="Example runtime",
        version="4",
        support_ends=date(2027, 1, 1),
        official_url="https://example.com/releases",
    )

    assert check_technology_health.check_support_window(support, today=date(2026, 7, 5))
    assert not check_technology_health.check_support_window(
        support, today=date(2026, 7, 4)
    )


def test_capability_review_becomes_due_after_100_days() -> None:
    assert check_technology_health.capability_review_due(
        reviewed_on=date(2026, 1, 1), today=date(2026, 4, 11)
    )
    assert not check_technology_health.capability_review_due(
        reviewed_on=date(2026, 1, 1), today=date(2026, 4, 10)
    )


def javascript_report(advisories: dict | None = None) -> dict:
    return {
        "advisories": advisories or {},
        "metadata": {"totalDependencies": 1},
    }


def image_size_advisory() -> dict:
    return {
        "severity": "high",
        "module_name": "image-size",
        "patched_versions": "<0.0.0",
        "findings": [
            {
                "version": "1.2.1",
                "paths": ["apps__frontend>expo>@expo/metro>metro>image-size"],
            }
        ],
    }


def test_only_recorded_unfixable_javascript_findings_are_ignored() -> None:
    known = javascript_report(
        {
            "GHSA-w3rx-r6r6-pgpr": image_size_advisory(),
            "GHSA-5p2g-fcmc-qvqq": image_size_advisory(),
        }
    )
    assert (
        check_technology_health.javascript_audit_problems(
            known, today=date(2026, 9, 18)
        )
        == []
    )

    known["advisories"]["GHSA-new-risk"] = {"severity": "high"}
    assert check_technology_health.javascript_audit_problems(
        known, today=date(2026, 9, 18)
    ) == ["GHSA-new-risk (high)"]


@pytest.mark.parametrize("severity", ["info", "low", "moderate", "high", "critical"])
def test_every_javascript_severity_blocks_release(severity: str) -> None:
    report = javascript_report({"GHSA-new-risk": {"severity": severity}})
    assert check_technology_health.javascript_audit_problems(report) == [
        f"GHSA-new-risk ({severity})"
    ]


@pytest.mark.parametrize("change", ["fixed", "package", "version", "path", "expired"])
def test_image_size_exception_cannot_hide_changed_risk(change: str) -> None:
    advisory = image_size_advisory()
    today = date(2026, 9, 18)
    if change == "fixed":
        advisory["patched_versions"] = ">=2.0.3"
    elif change == "package":
        advisory["module_name"] = "reader-upload-parser"
    elif change == "version":
        advisory["findings"][0]["version"] = "2.0.2"
    elif change == "path":
        advisory["findings"][0]["paths"].append("apps__frontend>image-size")
    else:
        today = date(2026, 10, 18)
    assert check_technology_health.javascript_audit_problems(
        javascript_report({"GHSA-w3rx-r6r6-pgpr": advisory}), today=today
    )


@pytest.mark.parametrize(
    "payload",
    [
        None,
        [],
        {},
        {"error": "registry unavailable"},
        {"advisories": {}},
        {"advisories": [], "metadata": {"totalDependencies": 1}},
        {"advisories": {}, "metadata": {"totalDependencies": 0}},
        javascript_report({"GHSA-broken": {"severity": "unknown"}}),
    ],
)
def test_javascript_missing_or_invalid_coverage_fails_closed(payload) -> None:
    with pytest.raises(ValueError):
        check_technology_health.javascript_audit_problems(payload)


@pytest.mark.parametrize(
    "payload",
    [
        None,
        [],
        {},
        {"dependencies": []},
        {"dependencies": [{}]},
        {"dependencies": [{"name": "private", "skip_reason": "not found"}]},
        {"dependencies": [{"name": "example", "version": "1", "vulns": [{}]}]},
    ],
)
def test_python_missing_or_invalid_coverage_fails_closed(payload) -> None:
    with pytest.raises(ValueError):
        check_technology_health.python_audit_problems(payload)


def test_security_scan_uses_every_locked_python_group_without_installing_packages(
    monkeypatch,
) -> None:
    commands = []

    def run(command, root):
        commands.append(command)
        if command[0] == "uvx":
            requirements = Path(command[command.index("--requirement") + 1]).read_text()
            result = {
                "dependencies": [
                    {"name": name, "version": version, "vulns": []}
                    for name, version in (
                        line.split("==") for line in requirements.splitlines()
                    )
                ]
            }
            assert "colorama==" in requirements
            assert "httpx2-jsfetch==" in requirements
            assert "ruff==" in requirements
            assert ";" not in requirements
        else:
            result = javascript_report()
        return subprocess.CompletedProcess(command, 0, json.dumps(result), "")

    monkeypatch.setattr(check_technology_health, "_run", run)
    assert check_technology_health.run_security_audits(ROOT) == []
    # A clean runner may have a newer patch than .python-version. Offline lock
    # validation must use the interpreter already running this security check.
    assert commands[0] == [
        "uv",
        "lock",
        "--check",
        "--offline",
        "--python",
        sys.executable,
    ]
    assert "--no-deps" in commands[1]
    assert "--disable-pip" in commands[1]


def test_alternate_python_versions_are_scanned_in_separate_complete_batches(
    monkeypatch, tmp_path: Path
) -> None:
    (tmp_path / "pyproject.toml").write_text('[project]\nname = "example"\n')
    (tmp_path / "uv.lock").write_text("""
version = 1
[[package]]
name = "example"
version = "1"
source = { virtual = "." }
[[package]]
name = "colorama"
version = "0.4.5"
resolution-markers = ["sys_platform == 'win32'"]
source = { registry = "https://pypi.org/simple" }
[[package]]
name = "colorama"
version = "0.4.6"
source = { registry = "https://pypi.org/simple" }
[[package]]
name = "ruff"
version = "0.15.0"
source = { registry = "https://pypi.org/simple" }
""")
    workflow = tmp_path / ".github/workflows"
    workflow.mkdir(parents=True)
    (workflow / "technology-health.yml").write_text('PIP_AUDIT_VERSION: "2.10.1"\n')
    scanned = []

    def run(command, root):
        if command[0] == "uvx":
            text = Path(command[command.index("--requirement") + 1]).read_text()
            pairs = [tuple(line.split("==")) for line in text.splitlines()]
            assert len({name for name, _ in pairs}) == len(pairs)
            scanned.extend(pairs)
            report = {
                "dependencies": [
                    {"name": name, "version": version, "vulns": []}
                    for name, version in pairs
                ]
            }
        else:
            report = javascript_report()
        return subprocess.CompletedProcess(command, 0, json.dumps(report), "")

    monkeypatch.setattr(check_technology_health, "_run", run)
    assert check_technology_health.run_security_audits(tmp_path) == []
    assert sorted(scanned) == [
        ("colorama", "0.4.5"),
        ("colorama", "0.4.6"),
        ("ruff", "0.15.0"),
    ]


@pytest.mark.parametrize(
    "source",
    [
        '{ git = "https://example.com/code" }',
        "{}",
        '{ virtual = "." }',
        '{ registry = "https://private.example/simple" }',
    ],
)
def test_python_lock_rejects_unsupported_or_unidentified_sources(
    tmp_path: Path, source: str
) -> None:
    (tmp_path / "pyproject.toml").write_text('[project]\nname = "example"\n')
    (tmp_path / "uv.lock").write_text(f"""[[package]]
name = "unknown"
version = "1"
source = {source}
""")
    with pytest.raises(ValueError):
        check_technology_health.locked_python_packages(tmp_path)


def test_python_audit_fails_if_a_locked_package_is_missing_from_report() -> None:
    result = subprocess.CompletedProcess(
        [],
        0,
        json.dumps({"dependencies": [{"name": "ruff", "version": "1", "vulns": []}]}),
        "",
    )
    assert check_technology_health.security_audit_problems(
        result, "Python", expected_python={("ruff", "1"), ("colorama", "0.4.6")}
    )


@pytest.mark.parametrize("status", [1, 2])
def test_scanner_failure_cannot_pass_with_an_empty_valid_report(
    monkeypatch, status: int
) -> None:
    def run(command, root):
        if command[0] == "uv":
            return subprocess.CompletedProcess(command, 0, "", "")
        report = (
            {"dependencies": [{"name": "ruff", "version": "1", "vulns": []}]}
            if command[0] == "uvx"
            else javascript_report()
        )
        return subprocess.CompletedProcess(
            command, status, json.dumps(report), "failed"
        )

    monkeypatch.setattr(check_technology_health, "_run", run)
    problems = check_technology_health.run_security_audits(ROOT)
    assert any("Python" in problem for problem in problems)
    assert any("JavaScript" in problem for problem in problems)


def test_security_only_does_not_run_unrelated_maintenance(monkeypatch, capsys) -> None:
    monkeypatch.setattr(sys, "argv", [str(SCRIPT), "--security-only"])
    monkeypatch.setattr(check_technology_health, "run_security_audits", lambda root: [])

    def unexpected(*args, **kwargs):
        pytest.fail("Security-only mode must not block on routine tool updates")

    monkeypatch.setattr(check_technology_health, "find_local_problems", unexpected)
    monkeypatch.setattr(check_technology_health, "check_registry_versions", unexpected)
    assert check_technology_health.main() == 0
    report = capsys.readouterr().out
    assert "GHSA-w3rx-r6r6-pgpr" in report
    assert "GHSA-5p2g-fcmc-qvqq" in report
    assert "2026-10-18" in report


@pytest.mark.parametrize("language", ["Python", "JavaScript"])
def test_scanner_broken_json_is_a_failed_check(language: str) -> None:
    result = subprocess.CompletedProcess([], 1, "registry unavailable", "")
    assert check_technology_health.security_audit_problems(result, language)


def test_python_vulnerabilities_are_reported_with_nonzero_scanner_status() -> None:
    report = {
        "dependencies": [
            {"name": "example", "version": "1", "vulns": [{"id": "GHSA-risk"}]}
        ]
    }
    result = subprocess.CompletedProcess([], 1, json.dumps(report), "")
    assert check_technology_health.security_audit_problems(result, "Python") == [
        "example 1: GHSA-risk"
    ]


def test_scanner_timeout_and_missing_binary_fail_closed(monkeypatch) -> None:
    for error in (FileNotFoundError(), subprocess.TimeoutExpired("pnpm", 180)):

        def fail(*args, **kwargs):
            raise error

        monkeypatch.setattr(subprocess, "run", fail)
        result = check_technology_health._run(["pnpm", "audit", "--json"], ROOT)
        assert check_technology_health.security_audit_problems(result, "JavaScript")


def test_required_changes_job_runs_security_without_path_filter() -> None:
    workflow = (ROOT / ".github/workflows/ci.yml").read_text(encoding="utf-8")
    trigger = workflow.split("on:\n", 1)[1].split("permissions:", 1)[0]
    assert "pull_request:" in trigger
    assert "merge_group:" in trigger
    assert "paths:" not in trigger
    changes = workflow.split("  changes:\n", 1)[1].split("  backend:\n", 1)[0]
    assert "--security-only" in changes
    security_step = changes.split(
        "- name: Check all locked Python and JavaScript packages for security problems",
        1,
    )[1].split("\n      - name:", 1)[0]
    assert "if:" not in security_step
    assert "continue-on-error:" not in changes


def test_monthly_workflow_uses_only_free_standard_checks() -> None:
    workflow = (ROOT / ".github/workflows/technology-health.yml").read_text(
        encoding="utf-8"
    )

    assert "cron:" in workflow
    assert "runs-on: ubuntu-latest" in workflow
    assert "python scripts/check_technology_health.py --online" in workflow
    assert 'cron: "41 13 * * 1"' in workflow
    assert "if: github.event.schedule != '41 13 * * 1'" in workflow
    assert "if: github.event.schedule == '41 13 * * 1'" in workflow
    assert "python scripts/check_technology_health.py --security-only" in workflow
    assert "openai" not in workflow.lower()
    assert "anthropic" not in workflow.lower()
    assert "larger-runner" not in workflow
