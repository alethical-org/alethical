import hashlib
import json
import threading
import time

import pytest

from alethical.pipeline import election_source_capture as sources

# Public dummy userinfo tests rejection before any authority request.
_SYNTHETIC_CREDENTIAL_URL = (
    "https://name:secret@county.gov/reports"  # trufflehog:ignore
)


class Response:
    def __init__(self, body=b"source", status=200, headers=None):
        self.body = body
        self.status_code = status
        self.headers = headers or {"Content-Type": "application/pdf"}
        self.encoding = "utf-8"

    def __enter__(self):
        return self

    def __exit__(self, *_):
        pass

    def iter_content(self, _):
        yield self.body


SPEC = {
    "id": "county-1",
    "url": "https://county.gov/reports",
    "allowed_hosts": ["county.gov"],
}


def test_capture_retains_exact_original_and_discovery_links(tmp_path):
    body = b'<a href="2026.pdf">2026 report</a><a href="mailto:clerk@example.gov">Email</a>'
    receipt = sources.capture(
        SPEC,
        tmp_path,
        get=lambda *a, **k: Response(body, headers={"Content-Type": "text/html"}),
    )
    assert receipt["state"] == "captured"
    assert receipt["sha256"] == hashlib.sha256(body).hexdigest()
    assert (tmp_path / receipt["file"]).read_bytes() == body
    assert receipt["links"] == [
        {"url": "https://county.gov/2026.pdf", "text": "2026 report"}
    ]
    assert receipt["identity_confirmed"] is False
    assert receipt["filing_coverage_confirmed"] is False


def test_cross_host_redirect_is_preserved_but_not_followed(tmp_path):
    requests = []

    def get(url, **kwargs):
        requests.append(url)
        assert kwargs["allow_redirects"] is False
        return Response(status=302, headers={"Location": "http://127.0.0.1/private"})

    receipt = sources.capture(SPEC, tmp_path, get=get)
    assert requests == [SPEC["url"]]
    assert receipt["state"] == "fetch_failed"
    assert receipt["redirects"][0]["to"] == "http://127.0.0.1/private"
    assert "sha256" not in receipt


@pytest.mark.parametrize(
    "url",
    [
        "file:///etc/passwd",
        _SYNTHETIC_CREDENTIAL_URL,
        "https://county.gov:8443/reports",
        "https://evil.gov/reports",
    ],
)
def test_unlisted_or_credential_url_rejected(url):
    with pytest.raises(sources.CaptureError):
        sources.public_url(url, {"county.gov"})


def test_synthetic_credentials_never_reach_request_or_original_storage(tmp_path):
    def no_request(*args, **kwargs):
        pytest.fail("Credential rejection must precede HTTP requests")

    with pytest.raises(sources.CaptureError):
        sources.capture(
            SPEC | {"url": _SYNTHETIC_CREDENTIAL_URL}, tmp_path, get=no_request
        )
    assert list(tmp_path.iterdir()) == []


@pytest.mark.parametrize(
    "response", [Response(status=404), Response(b""), Response(b"too big")]
)
def test_failed_route_never_claims_absent_filing_or_retains_partial_body(
    tmp_path, response
):
    receipt = sources.capture(SPEC, tmp_path, get=lambda *a, **k: response, max_bytes=3)
    assert receipt["state"] == "fetch_failed"
    assert receipt["filing_coverage_confirmed"] is False
    assert not list(tmp_path.glob("*.body"))


def test_resume_reuses_verified_original_and_detects_tamper(tmp_path, monkeypatch):
    receipt = sources.capture(SPEC, tmp_path, get=lambda *a, **k: Response())
    (tmp_path / "attempts.jsonl").write_text(json.dumps(receipt) + "\n")
    monkeypatch.setattr(
        sources, "capture", lambda *a, **k: pytest.fail("must reuse successful capture")
    )
    result = sources.collect([SPEC], tmp_path)
    assert result["captured"] == 1
    (tmp_path / receipt["file"]).write_bytes(b"changed")
    with pytest.raises(sources.CaptureError, match="changed"):
        sources.collect([SPEC], tmp_path)


def test_failed_attempt_is_retried_and_both_receipts_retained(tmp_path, monkeypatch):
    failed = sources.capture(SPEC, tmp_path, get=lambda *a, **k: Response(status=403))
    (tmp_path / "attempts.jsonl").write_text(json.dumps(failed) + "\n")
    successful = sources.capture(SPEC, tmp_path, get=lambda *a, **k: Response())
    monkeypatch.setattr(sources, "capture", lambda *a, **k: successful)
    monkeypatch.setattr(sources.time, "sleep", lambda _: None)
    result = sources.collect([SPEC], tmp_path)
    assert result["captured"] == 1
    assert len((tmp_path / "attempts.jsonl").read_text().splitlines()) == 2


def test_inventory_ids_do_not_silently_collapse(tmp_path):
    with pytest.raises(sources.CaptureError, match="Duplicate"):
        sources.collect([SPEC, SPEC], tmp_path)


def test_invalid_directory_host_does_not_discard_other_completed_receipts(
    tmp_path, monkeypatch
):
    monkeypatch.setattr(sources.requests, "get", lambda *a, **k: Response())
    invalid = {
        "id": "old-ip-entry",
        "url": "http://192.0.2.1/",
        "allowed_hosts": ["192.0.2.1"],
    }
    result = sources.collect([invalid, SPEC], tmp_path)
    assert result["expected"] == 2
    assert result["captured"] == result["failed"] == 1
    assert len((tmp_path / "attempts.jsonl").read_text().splitlines()) == 2
    assert result["sources"][0]["filing_coverage_confirmed"] is False


def test_malformed_url_does_not_abort_the_attempt_ledger(tmp_path, monkeypatch):
    monkeypatch.setattr(sources.requests, "get", lambda *a, **k: Response())
    invalid = {**SPEC, "id": "malformed-url", "url": "http://[bad/"}
    result = sources.collect([invalid, SPEC], tmp_path)
    assert result["captured"] == result["failed"] == 1
    assert len((tmp_path / "attempts.jsonl").read_text().splitlines()) == 2
    assert result["sources"][0]["requested_url"] is None


def test_concurrent_collection_serializes_each_host_and_preserves_manifest_order(
    tmp_path, monkeypatch
):
    guard = threading.Lock()
    active = 0
    peak = 0

    class SlowResponse(Response):
        def __enter__(self):
            nonlocal active, peak
            with guard:
                active += 1
                peak = max(peak, active)
            return self

        def iter_content(self, _):
            time.sleep(0.01)
            yield b"same original for several inventories"

        def __exit__(self, *_):
            nonlocal active
            with guard:
                active -= 1

    monkeypatch.setattr(sources.requests, "get", lambda *a, **k: SlowResponse())
    manifest = [{**SPEC, "id": str(i)} for i in range(5)]
    result = sources.collect(manifest, tmp_path)
    assert peak == 1
    assert result["captured"] == 5
    assert [row["id"] for row in result["sources"]] == [str(i) for i in range(5)]
    assert len(list(tmp_path.glob("*.body"))) == 1
    assert len((tmp_path / "attempts.jsonl").read_text().splitlines()) == 5
