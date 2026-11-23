"""Real PostgreSQL checks for election source retention and atomic publication."""

from argparse import Namespace
from copy import deepcopy
from datetime import date, datetime, timedelta
import hashlib
from pathlib import Path

import pytest
from sqlalchemy import delete, event, func, select, update
from sqlalchemy.orm import Session

from alethical.db import models as m
from alethical.db.session import get_engine
from alethical.pipeline import election_comparison as storage
from alethical.pipeline.raw_file_store import (
    StorageIntegrityError,
    StorageObjectMissingError,
)
from alethical.tests.test_election_comparison_command import command, source_set  # noqa: F401


@pytest.fixture
def db(seed_database):
    with get_engine().connect() as connection:
        transaction = connection.begin()
        with Session(
            bind=connection, join_transaction_mode="create_savepoint"
        ) as session:
            yield session
        transaction.rollback()


class MemoryStore:
    def __init__(self):
        self.objects = {}

    def put_and_verify(self, key, path, content_hash):
        body = Path(path).read_bytes()
        assert hashlib.sha256(body).hexdigest() == content_hash
        self.objects[key] = body

    def get(self, key, path, *, max_bytes=None):
        try:
            body = self.objects[key]
        except KeyError:
            raise StorageObjectMissingError(key) from None
        if max_bytes is not None and len(body) > max_bytes:
            raise StorageIntegrityError("Object grew beyond its inventory size")
        Path(path).write_bytes(body)


@pytest.fixture
def prepared(source_set):  # noqa: F811 - imported pytest fixture
    return command.prepare_from_files(
        Namespace(
            directory=source_set[0],
            manifest=source_set[1],
            election_date=date(2026, 11, 3),
            election_id="201",
            stage="general",
            status_file="home.html",
        )
    )


def archive(db, prepared):
    store = MemoryStore()
    for body in prepared[1].values():
        storage.archive_source(db, store, body)
    return store


def changed_generation(generation):
    changed = deepcopy(generation)
    changed["coverage"]["revision_note"] = (
        "New retained observation for a synthetic test"
    )
    changed["fetched_at"] = (
        datetime.fromisoformat(changed["fetched_at"]) + timedelta(days=1)
    ).isoformat()
    changed["id"] = storage.generation_digest(changed)
    return changed


def test_archive_repeated_bytes_round_trip_and_corruption(db, prepared):
    store = archive(db, prepared)
    source = next(iter(prepared[1].values()))
    key = storage.archive_source(db, store, source)
    record = db.get(m.ElectionResultSource, key)
    assert storage.read_source(store, record) == source
    assert db.scalar(select(func.count()).select_from(m.ElectionResultSource)) == len(
        {hashlib.sha256(b).hexdigest() for b in prepared[1].values()}
    )
    body = store.objects[record.object_key]
    store.objects[record.object_key] = bytes([body[0] ^ 1]) + body[1:]
    with pytest.raises(storage.ComparisonImportError, match="fingerprint"):
        storage.read_source(store, record)


def test_retained_source_from_another_zlib_build_is_verified_not_recompressed(
    db, prepared
):
    """gzip bytes differ between zlib builds (macOS 1.2.12 vs Linux 1.3.1).

    A source retained on one machine must be accepted on another after its
    stored object reads back to the exact original, never re-uploaded or
    compared with this machine's compression.
    """
    import gzip
    import zlib

    store = MemoryStore()
    source = next(iter(prepared[1].values()))
    content_hash = hashlib.sha256(source).hexdigest()
    # Another machine's gzip stream for the same bytes: a different level gives
    # different compressed bytes that decompress to the same original.
    other = gzip.compress(source, compresslevel=1, mtime=0)
    assert other != gzip.compress(source, mtime=0)
    assert zlib.decompress(other, 31) == source
    key = f"elections/returns/{content_hash}.gz"
    store.objects[key] = other
    db.add(
        m.ElectionResultSource(
            content_hash=content_hash,
            object_key=key,
            byte_size=len(source),
            compressed_hash=hashlib.sha256(other).hexdigest(),
            compressed_byte_size=len(other),
            compression="gzip",
        )
    )
    db.flush()
    store.put_and_verify = lambda *a, **k: pytest.fail("retained source re-uploaded")
    assert storage.archive_source(db, store, source) == content_hash
    assert store.objects[key] == other

    store.objects[key] = bytes([other[0] ^ 1]) + other[1:]
    with pytest.raises(storage.ComparisonImportError, match="fingerprint"):
        storage.archive_source(db, store, source)
    del store.objects[key]
    with pytest.raises(StorageObjectMissingError):
        storage.archive_source(db, store, source)


def test_missing_originals_cannot_create_or_publish_snapshot(db, prepared):
    with pytest.raises(storage.ComparisonImportError, match="Archive"):
        storage.stage_generation(db, prepared[0])
    assert db.get(m.ElectionComparisonSnapshot, prepared[0]["id"]) is None
    with pytest.raises(storage.ComparisonImportError, match="not staged"):
        storage.publish_generation(db, prepared[0]["id"], expected_previous=None)


def test_stage_is_repeat_safe_and_publish_requires_exact_previous_and_restore(
    db, prepared
):
    archive(db, prepared)
    generation = prepared[0]
    first = storage.stage_generation(db, generation)
    assert storage.stage_generation(db, deepcopy(generation)) == first
    assert db.scalar(select(func.count()).select_from(m.ElectionComparisonRace)) == 1
    assert (
        db.scalar(select(func.count()).select_from(m.ElectionComparisonPrecinct)) == 1
    )
    assert db.get(m.ElectionComparisonCurrent, generation["election_key"]) is None
    db.commit()
    assert (
        storage.publish_generation(db, first, expected_previous=None)["previous"]
        is None
    )
    db.commit()
    later = storage.stage_generation(db, changed_generation(generation))
    with pytest.raises(storage.ComparisonImportError, match="changed"):
        storage.publish_generation(db, later, expected_previous=None)
    assert (
        db.get(m.ElectionComparisonCurrent, generation["election_key"]).snapshot_id
        == first
    )
    storage.publish_generation(db, later, expected_previous=first)
    db.commit()
    with pytest.raises(storage.ComparisonImportError, match="explicit restore"):
        storage.publish_generation(db, first, expected_previous=later)
    storage.publish_generation(db, first, expected_previous=later, restore=True)
    db.commit()
    assert (
        db.get(m.ElectionComparisonCurrent, generation["election_key"]).snapshot_id
        == first
    )


def test_staging_rejects_content_changed_after_fingerprinting(db, prepared):
    archive(db, prepared)
    changed = deepcopy(prepared[0])
    changed["races"][0]["payload"]["candidates"][0]["votes"] += 100
    with pytest.raises(storage.ComparisonImportError):
        storage.stage_generation(db, changed)
    assert db.get(m.ElectionComparisonSnapshot, changed["id"]) is None


def test_failed_staging_does_not_leave_partial_snapshot_in_callers_transaction(
    db, prepared
):
    archive(db, prepared)
    malformed = deepcopy(prepared[0])
    del malformed["precincts"]
    with pytest.raises((storage.ComparisonImportError, KeyError)):
        storage.stage_generation(db, malformed)
    db.commit()
    assert db.get(m.ElectionComparisonSnapshot, malformed["id"]) is None
    assert db.scalar(select(func.count()).select_from(m.ElectionComparisonRace)) == 0


def test_publication_rejects_staged_rows_lost_after_stage(db, prepared):
    archive(db, prepared)
    snapshot_id = storage.stage_generation(db, prepared[0])
    db.execute(
        delete(m.ElectionComparisonPrecinct).where(
            m.ElectionComparisonPrecinct.snapshot_id == snapshot_id
        )
    )
    db.commit()
    with pytest.raises(storage.ComparisonImportError):
        storage.publish_generation(db, snapshot_id, expected_previous=None)
    assert db.get(m.ElectionComparisonCurrent, prepared[0]["election_key"]) is None


def test_publication_rejects_changed_figures_even_when_counts_match(db, prepared):
    archive(db, prepared)
    snapshot_id = storage.stage_generation(db, prepared[0])
    race = db.scalar(
        select(m.ElectionComparisonRace).where(
            m.ElectionComparisonRace.snapshot_id == snapshot_id
        )
    )
    payload = deepcopy(race.payload)
    payload["candidates"][0]["votes"] += 100
    race.payload = payload
    db.commit()
    with pytest.raises(storage.ComparisonImportError):
        storage.publish_generation(db, snapshot_id, expected_previous=None)
    assert db.get(m.ElectionComparisonCurrent, prepared[0]["election_key"]) is None


def test_publication_rechecks_database_despite_cached_race(db, prepared):
    archive(db, prepared)
    snapshot_id = storage.stage_generation(db, prepared[0])
    race = db.scalar(
        select(m.ElectionComparisonRace).where(
            m.ElectionComparisonRace.snapshot_id == snapshot_id
        )
    )
    payload = deepcopy(race.payload)
    payload["candidates"][0]["votes"] += 100
    # A direct writer can change the database without updating an already-read
    # ORM object. Publication must hash the database, not that cached object.
    db.connection().execute(
        update(m.ElectionComparisonRace)
        .where(
            m.ElectionComparisonRace.snapshot_id == snapshot_id,
            m.ElectionComparisonRace.id == race.id,
        )
        .values(payload=payload)
    )
    assert race.payload != payload
    with pytest.raises(storage.ComparisonImportError, match="fingerprint changed"):
        storage.publish_generation(db, snapshot_id, expected_previous=None)
    assert db.get(m.ElectionComparisonCurrent, prepared[0]["election_key"]) is None
    assert db.get(m.ElectionComparisonSnapshot, snapshot_id).first_published_at is None


def test_publication_rejects_original_metadata_removed_after_stage(db, prepared):
    archive(db, prepared)
    snapshot_id = storage.stage_generation(db, prepared[0])
    db.execute(
        delete(m.ElectionResultSource).where(
            m.ElectionResultSource.content_hash == prepared[0]["sources"][0]["sha256"]
        )
    )
    db.commit()
    with pytest.raises(storage.ComparisonImportError):
        storage.publish_generation(db, snapshot_id, expected_previous=None)
    assert db.get(m.ElectionComparisonCurrent, prepared[0]["election_key"]) is None


def test_insert_failure_rolls_back_whole_generation_but_keeps_callers_work(
    db, prepared
):
    from sqlalchemy.exc import IntegrityError

    archive(db, prepared)
    malformed = deepcopy(prepared[0])
    malformed["precincts"].append(deepcopy(malformed["precincts"][0]))
    malformed["coverage"]["precinct_race_records"] = 2
    malformed["id"] = storage.generation_digest(malformed)
    with pytest.raises((storage.ComparisonImportError, IntegrityError)):
        storage.stage_generation(db, malformed)
    # A failure after the snapshot/race INSERT must not poison or erase the
    # caller's preceding successful source archive operations.
    db.commit()
    assert db.get(m.ElectionComparisonSnapshot, malformed["id"]) is None
    assert db.scalar(select(func.count()).select_from(m.ElectionComparisonRace)) == 0
    assert db.scalar(select(func.count()).select_from(m.ElectionResultSource)) == 7


def test_publication_streams_only_exact_columns_in_bounded_server_cursors(db, prepared):
    archive(db, prepared)
    snapshot_id = storage.stage_generation(db, prepared[0])
    db.commit()
    observed = {}

    def inspect_cursor(connection, cursor, statement, parameters, context, many):
        compiled = context.compiled
        if compiled is None or not getattr(compiled.statement, "is_select", False):
            return
        columns = list(compiled.statement.selected_columns)
        for model in (m.ElectionComparisonRace, m.ElectionComparisonPrecinct):
            if any(
                getattr(column, "table", None) is model.__table__ for column in columns
            ):
                # Count queries are scalar functions, not selected row columns.
                observed[model.__tablename__] = {
                    "columns": tuple(column.key for column in columns),
                    "yield_per": context.execution_options.get("yield_per"),
                    "server_cursor": bool(getattr(cursor, "name", None)),
                }

    connection = db.connection()
    event.listen(connection, "after_cursor_execute", inspect_cursor)
    try:
        storage.publish_generation(db, snapshot_id, expected_previous=None)
    finally:
        event.remove(connection, "after_cursor_execute", inspect_cursor)
    assert observed == {
        "election_comparison_race": {
            "columns": (
                "id",
                "label",
                "office_id",
                "jurisdiction",
                "result_status",
                "payload",
            ),
            "yield_per": 250,
            "server_cursor": True,
        },
        "election_comparison_precinct": {
            "columns": ("race_id", "key", "name", "county", "payload"),
            "yield_per": 250,
            "server_cursor": True,
        },
    }


def test_publication_closes_both_cursors_on_encoding_failure(db, prepared, monkeypatch):
    archive(db, prepared)
    snapshot_id = storage.stage_generation(db, prepared[0])
    db.commit()
    results = []
    execute = db.execute
    encode = storage._hash_json

    def tracked_execute(statement, *args, **kwargs):
        result = execute(statement, *args, **kwargs)
        if statement.get_execution_options().get("yield_per") == 250:
            results.append(result)
        return result

    def failed_encode(hasher, value):
        if isinstance(value, dict) and "payload" in value:
            raise ValueError("Synthetic payload encoder failure")
        return encode(hasher, value)

    monkeypatch.setattr(db, "execute", tracked_execute)
    monkeypatch.setattr(storage, "_hash_json", failed_encode)
    with pytest.raises(ValueError, match="Synthetic payload"):
        storage.publish_generation(db, snapshot_id, expected_previous=None)
    assert len(results) == 2 and all(result.closed for result in results)
    assert db.get(m.ElectionComparisonCurrent, prepared[0]["election_key"]) is None
    assert db.get(m.ElectionComparisonSnapshot, snapshot_id).first_published_at is None
