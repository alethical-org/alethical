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


def fixed_advisory(patched="13.0.0"):
    payload = advisory()
    payload["vulnerabilities"][0].update(
        vulnerable_version_range=">= 11.2.1, < 13.0.0", patched_versions=patched
    )
    return payload


def test_a_fix_the_locked_release_reaches_resolves_the_warning():
    assert CHECK.fix_installed(fixed_advisory(), "13.0.0")
    assert CHECK.problems(fixed_advisory(), "13.0.0") == []
    assert CHECK.fix_installed(fixed_advisory(), "13.1.0")


@pytest.mark.parametrize(
    "patched,locked",
    [
        ("13.0.1", "13.0.0"),
        ("13.0.0", None),
        ("13.0.0", "13.0.0rc1"),
        (">= 13.0.0", "13.0.0"),
        ("13.0.0, 12.2.1", "13.0.0"),
        ("", "13.0.0"),
    ],
)
def test_an_unclear_or_unreached_fix_is_not_resolved(patched, locked):
    assert not CHECK.fix_installed(fixed_advisory(patched), locked)
    assert CHECK.problems(fixed_advisory(patched), locked)


def test_the_locked_version_is_read_from_the_lock_file(tmp_path):
    lock = tmp_path / "uv.lock"
    lock.write_text('[[package]]\nname = "pillow"\nversion = "13.0.0"\nsource = {}\n')
    assert CHECK.locked_pillow_version(lock) == "13.0.0"
    assert CHECK.locked_pillow_version(tmp_path / "missing.lock") is None


def test_missing_fix_field_is_not_no_fix():
    payload = advisory()
    del payload["vulnerabilities"][0]["patched_versions"]
    assert CHECK.problems(payload)


UNSIGNED = {}
FAKE_TOKEN = "ghs_" + "a" * 36


def serve(monkeypatch, fetch):
    """Replace the redirect-refusing opener with a fake transport."""
    handlers = []

    class Opener:
        def open(self, request, timeout):
            return fetch(request, timeout)

    def build(*args):
        handlers.extend(args)
        return Opener()

    monkeypatch.setattr(CHECK.urllib.request, "build_opener", build)
    monkeypatch.setattr(
        CHECK.urllib.request,
        "urlopen",
        lambda *a, **k: pytest.fail("the redirect-following opener must not be used"),
    )
    return handlers


@pytest.mark.parametrize(
    "raw", [b"", b"not json", b"null", b"[]", b"\xff", b"x" * 1_000_001]
)
def test_unreadable_upstream_fails(monkeypatch, raw):
    serve(monkeypatch, lambda *a: io.BytesIO(raw))
    assert CHECK.check(UNSIGNED)


@pytest.mark.parametrize("error", [TimeoutError(), OSError("unavailable")])
def test_network_failure_is_not_no_fix(monkeypatch, error):
    def unavailable(*args):
        raise error

    serve(monkeypatch, unavailable)
    assert CHECK.check({"GH_TOKEN": FAKE_TOKEN})


def test_direct_repository_feed_and_bounded_timeout(monkeypatch):
    def fetch(request, timeout):
        assert request.full_url == CHECK.URL
        assert "/repos/python-pillow/Pillow/security-advisories/" in request.full_url
        assert timeout == 20
        return io.BytesIO(json.dumps(advisory()).encode())

    monkeypatch.setattr(CHECK, "token", lambda env: None)
    serve(monkeypatch, fetch)
    assert CHECK.check(UNSIGNED) == []


@pytest.mark.parametrize("name", ["GH_TOKEN", "GITHUB_TOKEN"])
def test_job_token_signs_the_read_and_redirects_are_refused(monkeypatch, name):
    seen = []

    def fetch(request, timeout):
        seen.append(request.get_header("Authorization"))
        return io.BytesIO(json.dumps(advisory()).encode())

    handlers = serve(monkeypatch, fetch)
    assert CHECK.check({name: FAKE_TOKEN}) == []
    assert seen == [f"Bearer {FAKE_TOKEN}"]
    assert handlers == [CHECK.NoRedirect]
    assert CHECK.NoRedirect().redirect_request(None, None, 302, "", {}, "x") is None


def test_saved_local_sign_in_is_used_without_printing(monkeypatch, capsys):
    calls = []

    def run(command, **kwargs):
        calls.append(command)
        return CHECK.subprocess.CompletedProcess(command, 0, FAKE_TOKEN + "\n", "")

    monkeypatch.setattr(CHECK.subprocess, "run", run)
    assert CHECK.token({}) == FAKE_TOKEN
    assert calls == [["gh", "auth", "token", "--hostname", "github.com"]]
    assert FAKE_TOKEN not in "".join(capsys.readouterr())


@pytest.mark.parametrize(
    "outcome",
    [
        OSError("no gh"),
        CHECK.subprocess.TimeoutExpired("gh", 10),
        CHECK.subprocess.CompletedProcess("gh", 1, "", "not signed in"),
        CHECK.subprocess.CompletedProcess("gh", 0, "has spaces and\nnewlines", ""),
    ],
)
def test_missing_sign_in_falls_back_to_an_unsigned_read(monkeypatch, outcome):
    def run(*args, **kwargs):
        if isinstance(outcome, BaseException):
            raise outcome
        return outcome

    monkeypatch.setattr(CHECK.subprocess, "run", run)
    assert CHECK.token({}) is None
    seen = []

    def fetch(request, timeout):
        seen.append(request.has_header("Authorization"))
        return io.BytesIO(json.dumps(advisory()).encode())

    serve(monkeypatch, fetch)
    assert CHECK.check({}) == []
    assert seen == [False]


def test_weekly_check_is_independent_of_the_registry_scan():
    workflow = (ROOT / ".github/workflows/technology-health.yml").read_text()
    assert 'cron: "41 13 * * 1"' in workflow
    job = workflow.split("  pillow-upstream:\n", 1)[1]
    assert "needs:" not in job
    assert "runs-on: ubuntu-latest" in job
    assert "timeout-minutes: 2" in job
    assert "GH_TOKEN: ${{ github.token }}" in job
    assert "python scripts/check_pillow_advisory.py" in job
