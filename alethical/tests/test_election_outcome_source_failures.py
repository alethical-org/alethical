"""Reviewed outcome reads preserve operational errors instead of shrinking claims."""

# ruff: noqa: F401, F811
from collections.abc import Callable
import json

from botocore.exceptions import ClientError
from fastapi import HTTPException
import pytest

from alethical.api.services import election_source_io as source_io
from alethical.db import models as m
from alethical.pipeline import election_outcomes as outcomes
from alethical.pipeline import election_source_readings as readings
from alethical.pipeline.election_source_files import SourceFileLimitError
from alethical.tests.test_election_comparison_storage import db, prepared, source_set
from alethical.tests.test_election_outcomes import context
from alethical.tests.test_election_outcome_readings import scanned, checked

PRIVATE = "private-storage-endpoint/object-key/credential-marker"


@pytest.fixture(params=["native", "checked_reading"])
def reviewed(db, context, request, monkeypatch):
    snapshot, race, _, store, decision_request, _ = context
    if request.param == "checked_reading":
        _, decision_request = checked(db, request.getfixturevalue("scanned"))
    decision = outcomes.record_decision(db, **decision_request)
    keys = {
        kind: db.get(
            m.ElectionResultSource, decision_request["evidence"][0][field]
        ).object_key
        for kind, field in (("original", "sha256"), ("publisher", "publisher_sha256"))
    }

    class Transport:
        failure: Callable[[], Exception] | None = None
        failure_key: str | None = None
        failures = 0
        gets = 0

        def get(self, key, path, *, max_bytes=None):
            self.gets += 1
            if key == self.failure_key and self.failure is not None:
                failure, self.failure = self.failure, None
                self.failures += 1
                raise failure()
            return store.get(key, path, max_bytes=max_bytes)

    transport = Transport()
    monkeypatch.setattr(source_io, "reader_store_from_env", lambda: transport)
    monkeypatch.setattr(
        readings, "render_page", lambda *a: pytest.fail("ordinary outcome render")
    )

    def read():
        return source_io.outcome_map(db, snapshot_id=snapshot.id, race_ids=[race.id])[
            race.id
        ]

    healthy = read()
    assert healthy["outcome_review"]["state"] == "checked"
    assert healthy["outcome_review"]["decision_id"] == decision.id
    assert any(c["outcome"] == "elected" for c in healthy["candidates"].values())
    return store, transport, keys, healthy, read


@pytest.mark.parametrize("source", ["original", "publisher"])
@pytest.mark.parametrize("error", ["timeout", "storage503"])
def test_reviewed_outcome_operational_get_failure_is_503_and_recovers_exactly(
    reviewed, source, error
):
    _, transport, keys, healthy, read = reviewed
    transport.failure_key = keys[source]
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
    before = transport.gets
    with pytest.raises(HTTPException) as caught:
        read()
    assert caught.value.status_code == 503
    assert caught.value.headers == {"Retry-After": "1"}
    assert PRIVATE not in json.dumps(caught.value.detail)
    assert transport.failures == 1 and transport.gets > before
    # The failed operation is consumed once. A fresh request must recheck and
    # recover the exact reviewed claims/version, without a persistent failure flag.
    before = transport.gets
    assert read() == healthy
    assert transport.gets > before


@pytest.mark.parametrize("source", ["original", "publisher"])
@pytest.mark.parametrize("change", ["missing", "invalid"])
def test_reviewed_outcome_proved_source_gap_changes_version_and_recovers(
    reviewed, source, change
):
    store, _, keys, healthy, read = reviewed
    key = keys[source]
    original = store.objects[key]
    if change == "missing":
        store.objects.pop(key)  # MemoryStore raises explicit StorageObjectMissingError.
    else:
        store.objects[key] = original[:-1] + bytes([original[-1] ^ 1])
    unavailable = read()
    assert unavailable["outcome_review"]["state"] == "sources_unavailable"
    assert (
        unavailable["outcome_review"]["version"] != healthy["outcome_review"]["version"]
    )
    assert all(c["outcome"] is None for c in unavailable["candidates"].values())
    store.objects[key] = original
    assert read() == healthy


def test_reviewed_outcome_factory_failure_is_retryable_and_recovers(
    reviewed, monkeypatch
):
    _, transport, _, healthy, read = reviewed

    def unavailable():
        raise RuntimeError(PRIVATE)

    monkeypatch.setattr(source_io, "reader_store_from_env", unavailable)
    with pytest.raises(HTTPException) as caught:
        read()
    assert caught.value.status_code == 503
    assert caught.value.headers == {"Retry-After": "1"}
    assert PRIVATE not in json.dumps(caught.value.detail)
    monkeypatch.setattr(source_io, "reader_store_from_env", lambda: transport)
    assert read() == healthy


def test_reviewed_outcome_actual_get_capacity_stays_retryable(reviewed):
    _, transport, keys, healthy, read = reviewed
    transport.failure_key = keys["original"]
    transport.failure = lambda: SourceFileLimitError(PRIVATE)
    with pytest.raises(HTTPException) as caught:
        read()
    assert caught.value.status_code == 503
    assert caught.value.headers == {"Retry-After": "1"}
    assert PRIVATE not in json.dumps(caught.value.detail)
    assert transport.failures == 1
    assert read() == healthy


def test_unreviewed_outcome_needs_no_source_client(db, context, monkeypatch):
    snapshot, race, *_ = context

    def forbidden():
        pytest.fail("Unreviewed outcome must not create a source client")

    monkeypatch.setattr(source_io, "reader_store_from_env", forbidden)
    result = source_io.outcome_map(db, snapshot_id=snapshot.id, race_ids=[race.id])
    assert result[race.id]["outcome_review"]["state"] == "unreviewed"
    assert all(c["outcome"] is None for c in result[race.id]["candidates"].values())
