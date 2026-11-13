"""Scanned certifications use the same checked state in the public result readers."""

# ruff: noqa: F401, F811
import json
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from alethical.api.services import election_comparison_reads as results
from alethical.api.services import election_source_io
from alethical.db import models as m
from alethical.pipeline import election_comparison as storage
from alethical.pipeline import election_outcomes, election_source_readings as readings
from alethical.pipeline.election_source_files import SourceFileLimitError
from alethical.tests.test_election_comparison_storage import prepared, source_set
from alethical.tests.test_election_outcomes import context
from alethical.tests.test_election_outcome_readings import scanned, checked
from alethical.tests.test_election_source_review_concurrency import isolated_engine


@pytest.fixture
def db(isolated_engine):
    # Admission requires READ COMMITTED; public readers start a new REPEATABLE
    # READ transaction. Use a separately migrated, disposable database so real
    # commits and append-only history cannot leak into another module's tests.
    with isolated_engine.begin() as connection:
        names = [
            n for n in inspect(connection).get_table_names() if n != "alembic_version"
        ]
        quoted = [connection.dialect.identifier_preparer.quote(n) for n in names]
        connection.execute(text("TRUNCATE " + ", ".join(quoted) + " CASCADE"))
    with Session(isolated_engine) as session:
        yield session


@pytest.fixture
def public_scanned(db, scanned, monkeypatch):
    store, receipt, _, context = scanned
    row, request = checked(db, scanned)
    election_outcomes.record_decision(db, **request)
    snapshot, race, candidate, *_ = context
    storage.publish_generation(db, snapshot.id, expected_previous=None)
    # Retain plain values so expired ORM attributes cannot reopen READ COMMITTED
    # before the reader gets to establish its own transaction.
    snapshot = SimpleNamespace(id=snapshot.id, election_key=snapshot.election_key)
    race = SimpleNamespace(id=race.id)
    reading_id = row.id
    db.commit()
    monkeypatch.setattr(election_source_io, "reader_store_from_env", lambda: store)
    monkeypatch.setattr(
        readings, "render_page", lambda *a: pytest.fail("ordinary render")
    )
    return store, receipt, reading_id, snapshot, race, candidate


def _views(db, snapshot, race):
    detail = results.race_detail(
        db, election_key=snapshot.election_key, snapshot_id=snapshot.id, race_id=race.id
    )
    current = results.race_detail(
        db, election_key=snapshot.election_key, snapshot_id=None, race_id=race.id
    )
    precincts = results.precincts(
        db,
        election_key=snapshot.election_key,
        snapshot_id=snapshot.id,
        race_id=race.id,
        q="",
        county=None,
        limit=100,
        offset=0,
    )
    return detail, current, precincts


def test_scanned_public_readers_agree_and_refresh_after_source_loss(db, public_scanned):
    store, receipt, _, snapshot, race, candidate = public_scanned
    detail, current, precincts = _views(db, snapshot, race)
    outcome = detail["race"]["outcome_review"]
    assert outcome["state"] == "checked"
    assert current["race"]["outcome_review"] == precincts["outcome_review"] == outcome
    selected = next(
        c
        for c in detail["race"]["candidates"]
        if c["candidate_id"] == candidate["candidate_id"]
    )
    assert selected["outcome"] == "elected"
    encoded = json.dumps([detail, current, precincts])
    for private in (
        "reading_sha256",
        "field_id",
        "Private synthetic",
        "Private explanation",
    ):
        assert private not in encoded
    assert outcome["evidence"][0]["locator"]["bounds"]
    original = db.get(m.ElectionResultSource, receipt["original_sha256"])
    saved = store.objects.pop(original.object_key)
    lost = _views(db, snapshot, race)
    assert lost[0]["race"]["outcome_review"]["state"] == "sources_unavailable"
    assert lost[0]["race"]["outcome_review"]["version"] != outcome["version"]
    assert lost[0]["race"]["outcome_review"] == lost[2]["outcome_review"]
    store.objects[original.object_key] = saved
    restored = _views(db, snapshot, race)
    assert restored[0]["race"]["outcome_review"] == outcome


@pytest.mark.parametrize("view", ["detail", "precincts"])
def test_scanned_public_capacity_stays_retryable(db, public_scanned, monkeypatch, view):
    _, _, _, snapshot, race, _ = public_scanned

    def busy(*a, **k):
        raise SourceFileLimitError("occupied")

    monkeypatch.setattr(readings, "load_verified_reading_context", busy)
    args = dict(
        db=db,
        election_key=snapshot.election_key,
        snapshot_id=snapshot.id,
        race_id=race.id,
    )
    with pytest.raises(HTTPException) as caught:
        if view == "detail":
            results.race_detail(**args)
        else:
            results.precincts(**args, q="", county=None, limit=100, offset=0)
    assert caught.value.status_code == 503
    assert caught.value.headers == {"Retry-After": "1"}
