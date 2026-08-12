"""What the second copy of every stored source file must guarantee (#1402).

Minnesota's Campaign Finance Board publishes no archive, so a stored download is not
re-fetchable: asking again returns a different file. That makes a silent gap in the
second copy unrecoverable rather than inconvenient, and every test here stands in for
one way the gap could open without anybody noticing.

The two that matter most:

* **A file the database never heard of is still copied.** One bucket serves every
  database, so a local run's downloads sit beside production's. Measured 12 August
  2026: 12 objects stored, 3 named by a production row. A mirror driven off the rows
  would have quietly protected a quarter of the store while reporting success.
* **A copy is only recorded once it has been read back.** ``mirrored_at`` is the
  column anybody would trust to answer "is this backed up", so it has to mean the
  bytes were fetched out of the second store and hashed, not that an upload returned
  200.

Needs the local Postgres on port 54329.

**Do not name a test ``test_`` plus exactly 35 more characters.** CI's secret
scanner reads that shape as a Lob API key and fails the run reporting a *verified*
live secret, which is alarming, entirely false, and names neither the file nor the
string that caused it. One name in this file hit it on 12 August 2026 and failed the
``changes`` check on
`#1435 <https://github.com/alethical-org/alethical/pull/1435>`_; it is the test below
about a copy already being present, at its earlier and shorter name. Reproducing that
name here would trip the scanner again, which is why this note describes it instead.
Narrowing the scanner is tracked separately — see
`#1438 <https://github.com/alethical-org/alethical/issues/1438>`_.
"""

from __future__ import annotations

import hashlib
import uuid
from pathlib import Path
from typing import Iterator, Optional

import pytest
from sqlalchemy import text

from alethical.db import models as schema
from alethical.db.session import get_session_factory
from alethical.pipeline import raw_file_mirror as mirror_module
from alethical.pipeline.raw_file_mirror import (
    ALREADY_MIRRORED,
    ALREADY_PRESENT,
    COPIED,
    CONFIRMED,
    FAILED,
    format_report,
    mirror_raw_files,
)


class MemoryStore:
    """Stands in for a bucket, with the real store's read-back check.

    ``put_and_verify`` reproduces ``RawFileStore``'s contract exactly, including the
    part that carries the weight: an object already present is *verified* rather than
    re-uploaded, so a store holding different bytes under the same key raises instead
    of being silently accepted.
    """

    def __init__(self, objects: Optional[dict[str, bytes]] = None) -> None:
        self.objects: dict[str, bytes] = dict(objects or {})
        self.refuse: set[str] = set()
        self.uploads: list[str] = []

    def list_objects(self) -> dict[str, int]:
        return {key: len(value) for key, value in self.objects.items()}

    def size(self, key: str) -> Optional[int]:
        stored = self.objects.get(key)
        return None if stored is None else len(stored)

    def exists(self, key: str) -> bool:
        return key in self.objects

    def put_and_verify(self, key: str, path: str, expected_sha256: str) -> None:
        if key in self.refuse:
            raise RuntimeError("the second store refused this object")
        if key not in self.objects:
            self.objects[key] = Path(path).read_bytes()
            self.uploads.append(key)
        stored = hashlib.sha256(self.objects[key]).hexdigest()
        if stored != expected_sha256:
            raise RuntimeError(
                f"{key} read back as {stored} but the bytes we uploaded hash to "
                f"{expected_sha256}"
            )

    def get(self, key: str, destination: str) -> None:
        Path(destination).write_bytes(self.objects[key])


BODIES = {
    "campaign-finance/contributions/aaa.csv.gz": b"contribution bytes",
    "campaign-finance/expenditures/bbb.csv.gz": b"expenditure bytes",
}


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


@pytest.fixture()
def db(seed_database: None) -> Iterator:
    session = get_session_factory()()
    _clear(session)
    try:
        yield session
    finally:
        _clear(session)
        session.close()


def _clear(session) -> None:
    session.rollback()
    session.execute(text("DELETE FROM cf_snapshot_body"))
    session.execute(text("DELETE FROM cf_snapshot"))
    session.commit()


def add_body(session, key: str, data: bytes, *, compressed_hash: str = "") -> None:
    """Record a snapshot and the body row that names one stored object."""
    snapshot = schema.CampaignFinanceSnapshot(
        id=uuid.uuid4(),
        dataset=schema.CampaignFinanceDataset.contributions,
        download_id="-1",
        source_url="https://cfb.mn.gov/",
        content_hash=sha(data),
        byte_size=len(data),
        status=schema.CampaignFinanceSnapshotStatus.loaded,
        validation_json={},
    )
    session.add(snapshot)
    session.flush()
    session.add(
        schema.CampaignFinanceSnapshotBody(
            snapshot_id=snapshot.id,
            object_key=key,
            compressed_hash=compressed_hash or sha(data),
            compressed_byte_size=len(data),
            compression="gzip",
        )
    )
    session.commit()


def run(db, source: MemoryStore, mirror: MemoryStore, tmp_path):
    return mirror_raw_files(db, source, mirror, str(tmp_path), log=lambda message: None)


def mirrored_at(db, key: str):
    db.expire_all()
    body = db.query(schema.CampaignFinanceSnapshotBody).filter_by(object_key=key).one()
    return body.mirrored_at


def test_every_stored_file_reaches_the_second_copy_and_the_row_records_when(
    db, tmp_path
) -> None:
    """The whole point: 2 places, and the database can say so.

    Without the recorded time, "is this backed up" is answerable only by asking
    Cloudflare, which is exactly the question nobody thinks to ask until the day it
    matters.
    """
    source = MemoryStore(BODIES)
    mirror = MemoryStore()
    for key, data in BODIES.items():
        add_body(db, key, data)

    report = run(db, source, mirror, tmp_path)

    assert mirror.objects == BODIES
    assert len(report.of(COPIED)) == 2
    assert not report.failures
    for key in BODIES:
        assert mirrored_at(db, key) is not None


def test_a_file_no_row_names_is_copied_too(db, tmp_path) -> None:
    """One bucket serves every database, so the rows are not the work list.

    Production named 3 of the 12 objects actually stored on 12 August 2026. The 9
    others are real downloads of dated Minnesota files, just as unrepeatable as the
    3, and a rows-driven job would have skipped them while reporting success.
    """
    source = MemoryStore(BODIES)
    mirror = MemoryStore()
    add_body(
        db,
        "campaign-finance/contributions/aaa.csv.gz",
        BODIES["campaign-finance/contributions/aaa.csv.gz"],
    )

    report = run(db, source, mirror, tmp_path)

    assert mirror.objects == BODIES
    assert report.unrecorded_keys == ["campaign-finance/expenditures/bbb.csv.gz"]
    assert "no row in this database names them" in format_report(report)


def test_running_it_twice_copies_nothing_the_second_time(db, tmp_path) -> None:
    """Safe to schedule daily: a copy that already happened is skipped, not repeated.

    Checked on the uploads the store actually received, because a re-upload of
    identical bytes is invisible in the resulting objects and would still be paid for
    in time and transfer on every run forever.
    """
    source = MemoryStore(BODIES)
    mirror = MemoryStore()
    for key, data in BODIES.items():
        add_body(db, key, data)

    run(db, source, mirror, tmp_path)
    assert len(mirror.uploads) == 2
    second = run(db, source, mirror, tmp_path)

    assert len(mirror.uploads) == 2
    assert len(second.of(ALREADY_MIRRORED)) == 2
    assert not second.failures


def test_an_unrecorded_file_already_copied_is_not_read_again(db, tmp_path) -> None:
    """The no-row case has no column to skip on, so presence and size do it.

    Otherwise every run re-reads every object no database row names, and the cost of
    a daily run grows with the store instead of staying flat.
    """
    source = MemoryStore(BODIES)
    mirror = MemoryStore(BODIES)

    report = run(db, source, mirror, tmp_path)

    assert len(report.of(ALREADY_PRESENT)) == 2
    assert mirror.uploads == []


def test_a_different_file_under_the_same_name_is_refused_never_overwritten(
    db, tmp_path
) -> None:
    """A key is a hash of the file's contents, so two byte counts cannot both be right.

    Overwriting would resolve it by destroying one of them, and a stored body may be
    the only record of what the Board published that day.
    """
    key = "campaign-finance/contributions/aaa.csv.gz"
    source = MemoryStore({key: b"the real download"})
    mirror = MemoryStore({key: b"something else entirely, of a different length"})
    add_body(db, key, b"the real download")

    report = run(db, source, mirror, tmp_path)

    assert mirror.objects[key] == b"something else entirely, of a different length"
    assert [f.key for f in report.failures] == [key]
    assert "one name is claiming two different files" in report.failures[0].detail
    assert mirrored_at(db, key) is None


def test_one_file_failing_does_not_stop_the_others_and_is_reported(
    db, tmp_path
) -> None:
    """A backup that silently stops is worse than none, because it is trusted."""
    source = MemoryStore(BODIES)
    mirror = MemoryStore()
    mirror.refuse.add("campaign-finance/contributions/aaa.csv.gz")
    for key, data in BODIES.items():
        add_body(db, key, data)

    report = run(db, source, mirror, tmp_path)

    assert [f.key for f in report.failures] == [
        "campaign-finance/contributions/aaa.csv.gz"
    ]
    assert "campaign-finance/expenditures/bbb.csv.gz" in mirror.objects
    assert mirrored_at(db, "campaign-finance/expenditures/bbb.csv.gz") is not None
    assert mirrored_at(db, "campaign-finance/contributions/aaa.csv.gz") is None
    assert "Failures:" in format_report(report)


def test_a_copy_that_reads_back_wrong_is_never_recorded_as_mirrored(
    db, tmp_path
) -> None:
    """``mirrored_at`` has to mean read back and confirmed, not upload accepted.

    A store that accepts bytes and hands back different ones is the failure a
    recorded time would otherwise hide completely, because every other signal in the
    run says success.
    """
    key = "campaign-finance/contributions/aaa.csv.gz"
    source = MemoryStore({key: b"the real download"})
    mirror = MemoryStore()
    add_body(db, key, b"the real download")

    real_put = mirror.put_and_verify

    def truncating_put(k: str, path: str, expected: str) -> None:
        Path(path).write_bytes(b"trunc")
        real_put(k, path, expected)

    mirror.put_and_verify = truncating_put  # type: ignore[method-assign]
    report = run(db, source, mirror, tmp_path)

    assert [f.key for f in report.failures] == [key]
    assert mirrored_at(db, key) is None


def test_a_primary_file_that_lost_its_bytes_is_not_copied_at_all(db, tmp_path) -> None:
    """Copying a body that no longer matches its row would make a second wrong copy.

    Worse, it would then be recorded as backed up, so the corruption gains a
    confirmation instead of an alert.
    """
    key = "campaign-finance/contributions/aaa.csv.gz"
    source = MemoryStore({key: b"bytes that changed under us"})
    mirror = MemoryStore()
    add_body(db, key, b"bytes that changed under us", compressed_hash=sha(b"original"))

    report = run(db, source, mirror, tmp_path)

    assert mirror.objects == {}
    assert [f.key for f in report.failures] == [key]
    assert "not the file the database says it is" in report.failures[0].detail
    assert mirrored_at(db, key) is None


def test_the_temporary_copy_is_removed_even_when_the_upload_fails(db, tmp_path) -> None:
    """A runner that fills its disk over a long run fails in a way nobody links back.

    The whole store is 115 MB today and grows 7 to 10 GB a year, so one leaked body
    per failure is a real amount rather than a tidy-up.
    """
    key = "campaign-finance/contributions/aaa.csv.gz"
    source = MemoryStore({key: b"the real download"})
    mirror = MemoryStore()
    mirror.refuse.add(key)
    add_body(db, key, b"the real download")

    run(db, source, mirror, tmp_path)

    assert list(tmp_path.iterdir()) == []


def test_a_run_with_nothing_to_do_succeeds_quietly(db, tmp_path) -> None:
    """An empty source is not a failure — the loader may simply not have run yet."""
    report = run(db, MemoryStore(), MemoryStore(), tmp_path)

    assert report.outcomes == []
    assert not report.failures
    assert "failed:               0" in format_report(report)


def test_a_copy_already_there_is_confirmed_rather_than_re_uploaded(
    db, tmp_path
) -> None:
    """A run that finished copying but died before recording it must still record it.

    Otherwise the object is in both places and the database says forever that it is
    not, which is the state that makes somebody re-copy 115 MB to answer a question
    the row should have answered.
    """
    key = "campaign-finance/contributions/aaa.csv.gz"
    data = b"the real download"
    source = MemoryStore({key: data})
    mirror = MemoryStore({key: data})
    add_body(db, key, data)

    report = run(db, source, mirror, tmp_path)

    assert len(report.of(CONFIRMED)) == 1
    assert mirror.uploads == []
    assert mirrored_at(db, key) is not None


def test_the_failed_action_name_is_what_the_report_counts(db, tmp_path) -> None:
    """Guards the one string the scheduled job's alert depends on."""
    assert FAILED == "failed"
    assert mirror_module.FAILED == FAILED
