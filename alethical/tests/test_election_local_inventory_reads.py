"""Public optional inventory projections keep raw source facts independent."""

# ruff: noqa: F401, F811 - imported pytest fixtures are requested by name.
from copy import deepcopy
import json

import pytest
from fastapi import HTTPException

from alethical.api.services import election_external_finance_reads as reads
from alethical.api.services.election_source_io import FreshReadStore
from alethical.db import models as m
from alethical.pipeline import election_external_finance as storage
from alethical.pipeline import election_source_readings as readings
from alethical.pipeline.election_source_files import SourceFileLimitError
from alethical.tests.test_election_local_inventory import (
    db,
    local_generation,
    inventory_generation,
    isolated_engine,
    publish_inventory_account,
)


@pytest.fixture
def published_inventory(db, inventory_generation):
    publish_inventory_account(db, inventory_generation)
    return inventory_generation


def query(item):
    return dict(
        election_key=item.g["election_key"],
        race_id=item.base.race.id,
        candidate_id=item.base.candidate["candidate_id"],
        store=item.store,
    )


def report(data):
    assert len(data["accounts"]) == 1
    assert data["account_gaps"] == []
    assert len(data["reports"]) == 1
    result = data["reports"][0]
    assert result["check_status"] == "checked"
    assert result["figures"][0]["value"] == "1482.11"
    return result


def assert_held(data):
    value = report(data)
    assert value["effective"] is None
    assert value["version_scope"] == "exact_document"
    assert value["amendment_status"] == "not_established"
    assert value["version_gap"] == "amendment_status_not_established"
    assert "version_sources" not in value and "version_as_of" not in value


def assert_derived(data, item):
    value = report(data)
    assert value["effective"] is True
    assert value["version_scope"] == "publisher_inventory_as_of"
    assert value["amendment_status"] == "offered_inventory_checked"
    assert value["version_as_of"] == "2026-11-12T00:00:00+00:00"
    sources = value["version_sources"]
    assert len(sources) == 5
    copied = {s["sha256"]: s["copied_at"] for s in item.g["sources"]}
    for source in sources:
        assert source["source_copied_at"] == copied[source["source_sha256"]]
        assert source["retained_source_url"].endswith("?generation_id=" + item.g["id"])
    companion = item.documents[2].receipt["original_sha256"]
    assert (
        next(s for s in sources if s["source_sha256"] == companion)["source_copied_at"]
        == "2026-11-12T01:00:00+00:00"
    )
    encoded = json.dumps(data)
    assert "PRIVATE_" not in encoded
    for document in item.documents:
        assert document.row.receipt_sha256 not in encoded
    assert "root_receipt_id" not in encoded and "reading_scope" not in encoded


def test_current_historical_and_bulk_share_exact_inventory_projection(
    db, published_inventory
):
    item = published_inventory
    current = reads.candidate_finance(db, **query(item))
    assert_derived(current, item)
    bulk = reads.bulk_finance(db, election_key=item.g["election_key"], store=item.store)
    assert_derived(bulk["candidates"][0], item)
    # Publish a raw-only generation. The earlier immutable generation remains
    # inspectable with its original listing date and checked companions.
    payload = deepcopy(item.g)
    payload.pop("id")
    payload["reports"][0].pop("version_binding")
    raw = storage.prepare_generation(payload)
    storage.stage_generation(db, item.store, raw, item.originals)
    storage.publish_generation(
        db, item.store, raw["id"], expected_previous=item.g["id"]
    )
    now = reads.candidate_finance(db, **query(item))
    assert report(now)["effective"] is None
    historical = reads.candidate_finance(db, **query(item), generation_id=item.g["id"])
    assert_derived(historical, item)
    assert historical["generation_id"] == item.g["id"] != now["generation_id"]


def test_companion_withdrawal_preserves_raw_money_and_invalidates_pin(
    db, published_inventory
):
    item = published_inventory
    first = reads.candidate_finance(db, **query(item))
    companion = item.documents[2]
    withdrawn = readings.record_reading(
        db,
        item.store,
        receipt=companion.receipt,
        decision="withdrawn",
        reviewed_by="PRIVATE_TEST_REVIEWER",
        reason="Withdraw companion",
        expected_previous_id=companion.row.id,
    )
    for kwargs in ({}, {"generation_id": item.g["id"]}):
        fresh = reads.candidate_finance(db, **query(item), **kwargs)
        assert_held(fresh)
        assert fresh["version"] != first["version"]
        with pytest.raises(HTTPException) as error:
            reads.candidate_finance(
                db, **query(item), **kwargs, version=first["version"]
            )
        assert error.value.status_code == 409
    bulk = reads.bulk_finance(db, election_key=item.g["election_key"], store=item.store)
    assert_held(bulk["candidates"][0])
    readings.record_reading(
        db,
        item.store,
        receipt=companion.receipt,
        decision="checked",
        reviewed_by="PRIVATE_TEST_REVIEWER",
        reason="Restore exact companion proof",
        expected_previous_id=withdrawn.id,
    )
    recovered = reads.candidate_finance(db, **query(item))
    assert_derived(recovered, item)
    assert recovered["version"] not in {first["version"], fresh["version"]}


def test_companion_original_loss_and_recovery_keep_raw_money(db, published_inventory):
    item = published_inventory
    first = reads.candidate_finance(db, **query(item))
    companion_hash = item.documents[2].receipt["original_sha256"]
    key = db.get(m.ElectionResultSource, companion_hash).object_key
    original = item.store.objects.pop(key)
    for kwargs in ({}, {"generation_id": item.g["id"]}):
        fresh = reads.candidate_finance(db, **query(item), **kwargs)
        assert_held(fresh)
        with pytest.raises(HTTPException) as error:
            reads.candidate_finance(
                db, **query(item), **kwargs, version=first["version"]
            )
        assert error.value.status_code == 409
    item.store.objects[key] = original
    recovered = reads.candidate_finance(db, **query(item))
    assert_derived(recovered, item)
    assert recovered["version"] == first["version"]


def test_late_companion_fetch_loss_is_in_same_response_pin(
    db, published_inventory, monkeypatch
):
    item = published_inventory
    first = reads.candidate_finance(db, **query(item))
    companion = item.documents[2].receipt["original_sha256"]
    key = db.get(m.ElectionResultSource, companion).object_key
    real = storage.retained_bodies
    removed = []

    def fail_at_optional_fetch(*args, **kwargs):
        if len(kwargs.get("reading_ids", ())) == 4 and not removed:
            removed.append(item.store.objects.pop(key))
        return real(*args, **kwargs)

    monkeypatch.setattr(storage, "retained_bodies", fail_at_optional_fetch)
    # Exercise an actual later fetch failure, not deletion beneath an already
    # verified request-local cached copy. The public zero-byte cache budget
    # keeps every normal hash/source check and forces this bounded reread.
    late = reads.candidate_finance(
        db, **(query(item) | {"store": FreshReadStore(item.store, limit=0)})
    )
    assert removed
    assert_held(late)
    assert late["version"] != first["version"]
    with pytest.raises(HTTPException) as error:
        reads.candidate_finance(db, **query(item), version=first["version"])
    assert error.value.status_code == 409
    monkeypatch.setattr(storage, "retained_bodies", real)
    item.store.objects[key] = removed[0]
    assert_derived(reads.candidate_finance(db, **query(item)), item)


@pytest.mark.parametrize("route", ["candidate", "bulk"])
def test_optional_inventory_capacity_stays_retryable(
    db, published_inventory, monkeypatch, route
):
    item = published_inventory

    def busy(*args, **kwargs):
        raise SourceFileLimitError("occupied")

    monkeypatch.setattr(storage, "validate_report_version", busy)
    with pytest.raises(HTTPException) as error:
        if route == "candidate":
            reads.candidate_finance(db, **query(item))
        else:
            reads.bulk_finance(
                db, election_key=item.g["election_key"], store=item.store
            )
    assert error.value.status_code == 503
    assert error.value.headers == {"Retry-After": "1"}
