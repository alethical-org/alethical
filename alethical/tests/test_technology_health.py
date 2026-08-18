"""Keep Alethical's tools supported, consistent, and checked without paid services."""

from __future__ import annotations

import importlib.util
import json
from datetime import date
from pathlib import Path


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


def test_only_recorded_unfixable_javascript_findings_are_ignored() -> None:
    known = {
        "advisories": {
            "GHSA-w3rx-r6r6-pgpr": {"severity": "high"},
            "GHSA-5p2g-fcmc-qvqq": {"severity": "high"},
        }
    }
    assert check_technology_health.javascript_audit_problems(known) == []

    known["advisories"]["GHSA-new-risk"] = {"severity": "high"}
    assert check_technology_health.javascript_audit_problems(known) == [
        "GHSA-new-risk (high)"
    ]


def test_monthly_workflow_uses_only_free_standard_checks() -> None:
    workflow = (ROOT / ".github/workflows/technology-health.yml").read_text(
        encoding="utf-8"
    )

    assert "cron:" in workflow
    assert "runs-on: ubuntu-latest" in workflow
    assert "python scripts/check_technology_health.py --online" in workflow
    assert "openai" not in workflow.lower()
    assert "anthropic" not in workflow.lower()
    assert "larger-runner" not in workflow
