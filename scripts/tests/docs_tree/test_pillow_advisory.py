"""A feed gap, changed warning or available repair must never look like no fix."""

import importlib.util
import io
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
SPEC = importlib.util.spec_from_file_location(
    "pillow_advisory", ROOT / "scripts/check_pillow_advisory.py"
)
CHECK = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CHECK)


def advisory():
    return {
        "ghsa_id": CHECK.ADVISORY,
        "cve_id": "CVE-2026-114501",
        "state": "published",
        "withdrawn_at": None,
        "vulnerabilities": [
            {
                "package": {"ecosystem": "pip", "name": "Pillow"},
                "vulnerable_version_range": "11.2.1 - 13.0.0",
                "patched_versions": "",
            }
        ],
    }


def test_exact_no_fix_advisory():
    assert CHECK.problems(advisory()) == []


@pytest.mark.parametrize(
    "key,value",
    [
        ("ghsa_id", "different"),
        ("cve_id", "different"),
        ("state", "draft"),
        ("withdrawn_at", "2026-10-23"),
        ("vulnerabilities", []),
        ("vulnerabilities", [None]),
    ],
)
def test_changed_identity_or_coverage_fails(key, value):
    payload = advisory()
    payload[key] = value
    assert CHECK.problems(payload)


@pytest.mark.parametrize(
    "key,value",
    [
        ("package", {"ecosystem": "npm", "name": "Pillow"}),
        ("vulnerable_version_range", "<14"),
        ("patched_versions", "13.0.1"),
        ("patched_versions", None),
        ("patched_versions", []),
        ("patched_versions", " "),
    ],
)
def test_changed_package_range_or_fix_fails(key, value):
    payload = advisory()
    payload["vulnerabilities"][0][key] = value
    assert CHECK.problems(payload)


def test_missing_fix_field_is_not_no_fix():
    payload = advisory()
    del payload["vulnerabilities"][0]["patched_versions"]
    assert CHECK.problems(payload)


@pytest.mark.parametrize(
    "raw", [b"", b"not json", b"null", b"[]", b"\xff", b"x" * 1_000_001]
)
def test_unreadable_upstream_fails(monkeypatch, raw):
    monkeypatch.setattr(
        CHECK.urllib.request, "urlopen", lambda *a, **k: io.BytesIO(raw)
    )
    assert CHECK.check()


@pytest.mark.parametrize("error", [TimeoutError(), OSError("unavailable")])
def test_network_failure_is_not_no_fix(monkeypatch, error):
    def unavailable(*args, **kwargs):
        raise error

    monkeypatch.setattr(CHECK.urllib.request, "urlopen", unavailable)
    assert CHECK.check()


def test_direct_repository_feed_and_bounded_timeout(monkeypatch):
    def fetch(request, timeout):
        assert request.full_url == CHECK.URL
        assert "/repos/python-pillow/Pillow/security-advisories/" in request.full_url
        assert timeout == 20
        assert not request.has_header("Authorization")
        return io.BytesIO(json.dumps(advisory()).encode())

    monkeypatch.setattr(CHECK.urllib.request, "urlopen", fetch)
    assert CHECK.check() == []


def test_weekly_check_is_independent_of_the_registry_scan():
    workflow = (ROOT / ".github/workflows/technology-health.yml").read_text()
    assert 'cron: "41 13 * * 1"' in workflow
    job = workflow.split("  pillow-upstream:\n", 1)[1]
    assert "needs:" not in job
    assert "runs-on: ubuntu-latest" in job
    assert "timeout-minutes: 2" in job
    assert "python scripts/check_pillow_advisory.py" in job
