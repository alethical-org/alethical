"""Operational source failure cannot publish a smaller checked expense report."""

# ruff: noqa: F811
from copy import deepcopy
from collections.abc import Callable
import json
import csv
import io

from botocore.exceptions import ClientError
from fastapi import HTTPException
import pytest

from alethical.api.services import election_expense_analytics as s
from alethical.tests.finance_fixtures import finance_db  # noqa: F401
from alethical.tests.test_election_finance_reads import comparison  # noqa: F401
from alethical.tests.test_election_outside_spending import spending  # noqa: F401
from alethical.tests.test_election_expense_analytics import retained_read_store
from alethical.tests.test_election_comparison_reads import KEY

PRIVATE = "private-endpoint/object-key/credential-marker"


@pytest.fixture
def retained(finance_db, comparison, monkeypatch):
    store, _, document = retained_read_store(finance_db, comparison)

    class Transport:
        failure: Callable[[], Exception] | None = None
        gets = 0

        def get(self, key, path, *, max_bytes=None):
            self.gets += 1
            if key == document.object_key and self.failure is not None:
                raise self.failure()
            # This is the existing retained fixture's real storage operation,
            # not a replacement verifier, provider result or availability map.
            return store.get(key, path, max_bytes=max_bytes)

    transport = Transport()
    monkeypatch.setattr(s, "raw_file_store_from_env", lambda: transport)
    return store, document, transport


def read_surface(db, surface, pins):
    if surface == "summary":
        return s.report(db, election_key=KEY)
    if surface == "pinned_summary":
        return s.report(db, election_key=KEY, **pins)
    if surface in {"payees", "payments"}:
        return getattr(s, surface)(db, election_key=KEY, **pins)
    return s.export(db, election_key=KEY, **pins, format=surface)


def stable_surface(surface, value):
    if surface == "json":
        body, filename = value
        payload = json.loads(body)
        assert payload.pop("generated_at")
        return payload, filename
    if surface == "csv":
        body, filename = value
        rows = list(csv.DictReader(io.StringIO(body)))
        generated = [
            r
            for r in rows
            if r["Row type"] == "Metadata" and r["Metadata field"] == "Generated at"
        ]
        assert len(generated) == 1 and generated[0]["Metadata value"]
        return [r for r in rows if r not in generated], filename
    return value


@pytest.mark.parametrize(
    "surface", ["summary", "pinned_summary", "payees", "payments", "json", "csv"]
)
@pytest.mark.parametrize("error", ["timeout", "storage503"])
def test_one_failed_retained_get_is_503_and_exact_recovery_keeps_version(
    finance_db, retained, surface, error
):
    _, _, transport = retained
    healthy = s.report(finance_db, election_key=KEY)
    assert healthy["summary"]["source_report_totals"]["available_accounts"] == 1
    pins = {"snapshot_id": healthy["snapshot_id"], "version": healthy["version"]}
    expected_surface = stable_surface(
        surface, deepcopy(read_surface(finance_db, surface, pins))
    )
    before = transport.gets
    transport.failure = (
        (lambda: TimeoutError(PRIVATE))
        if error == "timeout"
        else (
            lambda: ClientError(
                {
                    "Error": {"Code": "SlowDown", "Message": PRIVATE},
                    "ResponseMetadata": {"HTTPStatusCode": 503},
                },
                "GetObject",
            )
        )
    )
    with pytest.raises(HTTPException) as caught:
        read_surface(finance_db, surface, pins)
    assert caught.value.status_code == 503  # Never smaller 200 or changed-records 409.
    assert caught.value.headers == {"Retry-After": "1"}
    assert PRIVATE not in json.dumps(caught.value.detail)
    assert transport.gets > before  # Fresh proof; no prior availability verdict.
    transport.failure = None
    recovered = s.report(finance_db, election_key=KEY)
    assert recovered["version"] == healthy["version"]
    assert recovered["summary"] == healthy["summary"]
    assert (
        stable_surface(surface, read_surface(finance_db, surface, pins))
        == expected_surface
    )


@pytest.mark.parametrize("change", ["deleted", "integrity"])
def test_actual_missing_or_changed_original_remains_gap_and_version_change(
    finance_db, retained, change
):
    store, document, _ = retained
    healthy = s.report(finance_db, election_key=KEY)
    original = store.objects[document.object_key]
    if change == "deleted":
        store.objects.pop(document.object_key)
    else:
        store.objects[document.object_key] = original[:-1] + bytes([original[-1] ^ 1])
    unavailable = s.report(finance_db, election_key=KEY)
    assert unavailable["version"] != healthy["version"]
    assert unavailable["summary"]["source_report_totals"]["amounts"] is None
    with pytest.raises(HTTPException) as caught:
        s.report(finance_db, election_key=KEY, version=healthy["version"])
    assert caught.value.status_code == 409
    store.objects[document.object_key] = original
    recovered = s.report(finance_db, election_key=KEY)
    assert recovered["version"] == healthy["version"]
    assert recovered["summary"] == healthy["summary"]


def test_source_client_setup_failure_is_safe503_not_smaller_report(
    finance_db, comparison, monkeypatch
):
    def failed_setup():
        raise RuntimeError(PRIVATE)

    monkeypatch.setattr(s, "raw_file_store_from_env", failed_setup)
    with pytest.raises(HTTPException) as caught:
        s.report(finance_db, election_key=KEY)
    assert caught.value.status_code == 503
    assert caught.value.headers == {"Retry-After": "1"}
    assert PRIVATE not in json.dumps(caught.value.detail)


def test_no_required_proofs_does_not_open_or_require_source_client(
    finance_db, comparison, monkeypatch
):
    def forbidden_setup():
        pytest.fail("No candidate scope needs a source client")

    monkeypatch.setattr(s, "raw_file_store_from_env", forbidden_setup)
    result = s.report(
        finance_db, election_key=KEY, candidate_query="no matching candidate"
    )
    assert result["candidates"] == [] and result["account_reports"] == []
    assert result["summary"]["source_report_totals"]["amounts"] is None
