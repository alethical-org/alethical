"""Batched candidate saves keep 1-at-a-time rules, lock order and a statement budget."""

from __future__ import annotations

import copy
import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, date, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from sqlalchemy import delete, event, func, select, text

from alethical.api.services import person_records as records
from alethical.api.services.candidate_lookup import (
    SOURCE_URL,
    STREETS_URL,
    CandidateLookupService,
    load_profile,
    persist_catalogue,
)
from alethical.db.models import (
    CandidateRecord,
    CandidateSnapshot,
    PersonCandidacy,
    PublicPerson,
    PublicRecordVersion,
)
from alethical.db.session import get_session_factory
from alethical.tests.test_candidate_ballot import candidate, source, street
from alethical.tests.test_candidate_legislators import subject  # noqa: F401
from alethical.tests.test_person_records import public_db  # noqa: F401

NOW = datetime(2026, 9, 30, 14, tzinfo=UTC)
ADDRESS = "100 EXAMPLE ST N, EXAMPLE CITY, MN 99999"
# Each statement here is a round trip to the database server, so the budget is
# what keeps a 40-candidate search from paying for 40 separate saves again.
STATEMENT_BUDGET = 20


def _profile(cid: str, *, name: str = "Batch example", checked: str = "2026-09-30"):
    return {
        "candidate": {"id": cid, "name": name, "party": "NONPARTISAN"},
        "election": {"id": "8334", "date": "2026-11-03", "type": "general"},
        "office": "Batch example office",
        "votingArea": "Batch example district",
        "source": {
            "authority": "Minnesota Secretary of State",
            "url": "https://myballotmn.sos.mn.gov/",
            "checkedDate": checked,
        },
    }


def _reference_save(db, *, profile, source_hash, checked_at):
    """The 1-at-a-time save rules this batch replaced, kept as the parity oracle."""
    cid = profile["candidate"]["id"]
    db.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:candidate_id))"),
        {"candidate_id": cid},
    )
    row = db.scalar(
        select(CandidateRecord).where(CandidateRecord.id == cid).with_for_update()
    )
    if row is not None:
        if records.candidate_identity(row.public_payload) != records.candidate_identity(
            profile
        ):
            raise records.PublicRecordConflict("Candidacy identity changed")
        records.retain_public_version(
            db,
            kind="candidate",
            record_id=cid,
            payload=row.public_payload,
            source_hash=row.source_sha256,
            checked_at=row.checked_at,
        )
    records.retain_public_version(
        db,
        kind="candidate",
        record_id=cid,
        payload=profile,
        source_hash=source_hash,
        checked_at=checked_at,
    )
    if row is None:
        db.add(
            CandidateRecord(
                id=cid,
                election_id=profile["election"]["id"],
                election_date=date.fromisoformat(profile["election"]["date"]),
                public_payload=copy.deepcopy(profile),
                source_sha256=source_hash,
                checked_at=checked_at,
            )
        )
    elif checked_at >= row.checked_at:
        row.public_payload = copy.deepcopy(profile)
        row.source_sha256 = source_hash
        row.checked_at = checked_at
    db.flush()


def _state(db, ids):
    rows = {
        row.id: (row.public_payload, row.source_sha256, row.checked_at)
        for row in db.scalars(
            select(CandidateRecord).where(CandidateRecord.id.in_(ids))
        )
    }
    versions = sorted(
        (row.id, row.record_id, row.source_sha256, row.checked_at)
        for row in db.scalars(
            select(PublicRecordVersion).where(PublicRecordVersion.record_id.in_(ids))
        )
    )
    return rows, versions


def _cleanup(ids, snapshot_ids=()):
    with get_session_factory()() as db:
        db.execute(
            delete(PublicRecordVersion).where(
                PublicRecordVersion.record_id.in_([*ids, *snapshot_ids])
            )
        )
        db.execute(delete(CandidateRecord).where(CandidateRecord.id.in_(ids)))
        db.execute(
            delete(CandidateSnapshot).where(CandidateSnapshot.id.in_(snapshot_ids))
        )
        db.commit()


def _ballot(count: int):
    rows = [
        candidate(
            UploadOfficeCode=str(7000 + index // 2),
            UploadCandidateCode=str(8000 + index),
            OfficeTitle=f"Batch Example Office {index // 2}",
            CandidateScreenName=f"Batch Candidate {index}",
        )
        for index in range(count)
    ]
    return json.dumps(source(*rows)).encode()


def _lookup(ballot: bytes, now: datetime):
    def fetch(url, params):
        if url == STREETS_URL:
            return json.dumps({"Streets": [street()]}).encode()
        assert url == SOURCE_URL
        return ballot

    return CandidateLookupService(fetch=fetch, now=lambda: now)


def _counted(db, work):
    count = 0

    def before(*_):
        nonlocal count
        count += 1

    engine = db.get_bind()
    event.listen(engine, "before_cursor_execute", before)
    try:
        result = work()
    finally:
        event.remove(engine, "before_cursor_execute", before)
    return count, result


def test_forty_candidate_search_saves_and_reads_within_statement_budget(
    seed_database,
):
    ballot = _ballot(40)
    ids: set[str] = set()
    snapshots: set[str] = set()
    try:
        for run, now in enumerate((NOW, NOW + timedelta(hours=1))):
            result, catalogue = _lookup(ballot, now).lookup(ADDRESS, "8334")
            assert result["kind"] == "results"
            assert sum(len(race.candidates) for race in catalogue.races) == 40
            ids |= {c.stable_id for race in catalogue.races for c in race.candidates}
            with get_session_factory()() as db:
                known = set(db.scalars(select(CandidateSnapshot.id)))
                before = db.scalar(
                    select(func.count()).select_from(PublicRecordVersion)
                )

                def work():
                    persist_catalogue(db, catalogue)
                    return records.enrich_lookup_results(db, result, today=now.date())

                statements, enriched = _counted(db, work)
                assert statements <= STATEMENT_BUDGET, (run, statements)
                after = db.scalar(select(func.count()).select_from(PublicRecordVersion))
                # Every accepted read is retained: 1 ballot read plus 1 per candidate.
                assert after - before == 41
                saved = db.scalars(
                    select(CandidateRecord).where(CandidateRecord.id.in_(ids))
                ).all()
                assert len(saved) == 40
                assert {row.checked_at for row in saved} == {now}
                snapshots |= set(db.scalars(select(CandidateSnapshot.id))) - known
            entries = [e for race in enriched["races"] for e in race["entries"]]
            assert len(entries) == 40
            # Every linked profile opens from a separate connection, without the address.
            with get_session_factory()() as other:
                for entry in entries:
                    profile = load_profile(other, entry["candidate"]["id"], now=now)
                    assert profile["candidate"]["id"] == entry["candidate"]["id"]
                    assert "EXAMPLE ST" not in json.dumps(profile)
            assert all(e["candidate"]["people"] == [] for e in entries)
            assert all(e["candidate"]["electionEnded"] is False for e in entries)
    finally:
        _cleanup(sorted(ids), sorted(snapshots))


def test_batch_matches_one_at_a_time_rules_for_new_newer_older_and_repeated_reads(
    seed_database,
):
    ids = [uuid4().hex * 2 for _ in range(4)]
    older = NOW - timedelta(hours=3)
    newer = NOW + timedelta(hours=3)
    # Existing rows: 1 older than this read, 1 newer than this read.
    seed = [(ids[0], older), (ids[1], newer)]
    batch = [
        _profile(ids[0], checked="2026-09-30"),
        _profile(ids[1], checked="2026-09-30"),
        _profile(ids[2]),
        _profile(ids[3]),
        # A repeated profile in 1 batch applies again, exactly as 2 saves would.
        _profile(ids[3], checked="2026-10-01"),
    ]
    results = []
    for save in ("reference", "batch"):
        with get_session_factory()() as db:
            for cid, checked in seed:
                _reference_save(
                    db, profile=_profile(cid), source_hash="a" * 64, checked_at=checked
                )
            if save == "reference":
                for profile in batch:
                    _reference_save(
                        db, profile=profile, source_hash="b" * 64, checked_at=NOW
                    )
            else:
                records.save_candidate_records(
                    db, profiles=batch, source_hash="b" * 64, checked_at=NOW
                )
            db.flush()
            results.append(_state(db, ids))
            db.rollback()
    assert results[0] == results[1]
    rows = results[1][0]
    assert rows[ids[0]][2] == NOW
    assert rows[ids[1]][2] == newer
    assert rows[ids[3]][0]["source"]["checkedDate"] == "2026-10-01"


def test_batch_identity_change_rejects_the_whole_save(seed_database):
    cid, fresh = uuid4().hex * 2, uuid4().hex * 2
    factory = get_session_factory()
    try:
        with factory() as db:
            records.save_candidate_records(
                db, profiles=[_profile(cid)], source_hash="a" * 64, checked_at=NOW
            )
            db.commit()
        with factory() as db:
            with pytest.raises(records.PublicRecordConflict):
                records.save_candidate_records(
                    db,
                    profiles=[_profile(fresh), _profile(cid, name="Different name")],
                    source_hash="b" * 64,
                    checked_at=NOW + timedelta(hours=1),
                )
            db.rollback()
        with factory() as db:
            rows, versions = _state(db, [cid, fresh])
        # Nothing from the failed save remains, and the earlier read is untouched.
        assert list(rows) == [cid]
        assert rows[cid][1:] == ("a" * 64, NOW)
        assert _history(versions) == {cid: [("a" * 64, NOW)]}
    finally:
        _cleanup([cid, fresh])


def test_single_save_returns_current_row_after_batched_write(seed_database):
    cid = uuid4().hex * 2
    with get_session_factory()() as db:
        first = records.save_candidate_record(
            db, profile=_profile(cid), source_hash="a" * 64, checked_at=NOW
        )
        later = NOW + timedelta(hours=1)
        same = records.save_candidate_record(
            db,
            profile=_profile(cid, checked="2026-10-01"),
            source_hash="b" * 64,
            checked_at=later,
        )
        assert same is first
        assert same.checked_at == later
        assert same.public_payload["source"]["checkedDate"] == "2026-10-01"
        db.rollback()


def _lock_keys(db, ids):
    return dict(
        db.execute(
            text(
                "SELECT candidate_id, hashtext(candidate_id)::bigint FROM "
                "unnest(CAST(:ids AS text[])) AS candidate_id"
            ),
            {"ids": ids},
        ).all()
    )


def _lock_parts(key: int) -> tuple[int, int]:
    return (key >> 32) & 0xFFFFFFFF, key & 0xFFFFFFFF


def _advisory_locks(probe, pid):
    return probe.execute(
        text(
            "SELECT classid::bigint, objid::bigint, granted FROM pg_locks "
            "WHERE locktype = 'advisory' AND pid = :pid"
        ),
        {"pid": pid},
    ).all()


def _wait_until_waiting(pid):
    with get_session_factory()() as probe:
        for _ in range(250):
            locks = _advisory_locks(probe, pid)
            if any(not granted for *_, granted in locks):
                return locks
            time.sleep(0.02)
    raise AssertionError("writer never waited for a lock")


def _ids_with_reversed_keys(db, count=2, start=1):
    """Candidate IDs whose lock keys sort in the opposite order to the IDs."""
    ids = [f"{index:02x}" * 32 for index in range(start, start + 60)]
    keys = _lock_keys(db, ids)
    for first in ids:
        for second in ids:
            if first < second and keys[first] > keys[second]:
                return first, second, keys
    raise AssertionError("no reversed pair")


def test_candidate_locks_are_taken_in_ascending_candidate_id_order(seed_database):
    factory = get_session_factory()
    ids = [f"{index:02x}" * 32 for index in range(1, 60)]
    with factory() as probe:
        keys = _lock_keys(probe, ids)
    # The lowest ID's key is higher than the highest ID's key, so key order differs.
    low, middle, high = next(
        (ids[a], ids[b], ids[c])
        for a in range(len(ids))
        for b in range(a + 1, len(ids))
        for c in range(b + 1, len(ids))
        if keys[ids[a]] > keys[ids[c]]
    )
    holder, waiter = factory(), factory()
    thread = None
    try:
        holder.execute(
            text("SELECT pg_advisory_xact_lock(:key)"), {"key": keys[middle]}
        )
        waiter_pid = waiter.scalar(text("SELECT pg_backend_pid()"))
        thread = threading.Thread(
            target=records.lock_candidate_records, args=(waiter, [high, low, middle])
        )
        thread.start()
        locks = _wait_until_waiting(waiter_pid)
        held = {(c, o) for c, o, granted in locks if granted}
        waiting = {(c, o) for c, o, granted in locks if not granted}
        # The lowest ID is held and the middle ID is awaited, whatever the key order.
        assert held == {_lock_parts(keys[low])}
        assert waiting == {_lock_parts(keys[middle])}
    finally:
        holder.rollback()
        if thread is not None:
            thread.join(timeout=10)
        waiter.rollback()
        holder.close()
        waiter.close()
    assert thread is not None and not thread.is_alive()


def _previous_release_save(db, cids, *, checked_at, between=None):
    """The deployed writer: 1 candidate at a time, in candidate-ID order."""
    for index, cid in enumerate(sorted(cids)):
        _reference_save(
            db, profile=_profile(cid), source_hash="a" * 64, checked_at=checked_at
        )
        if index == 0 and between is not None:
            between()


def _key_order_lock(db, cids):
    """A rejected alternative: lock by key value. Kept to prove the test can fail."""
    db.execute(
        text(
            "SELECT count(pg_advisory_xact_lock(ordered.lock_key)) FROM ("
            "SELECT DISTINCT hashtext(candidate_id) AS lock_key "
            "FROM unnest(CAST(:ids AS text[])) AS candidate_id "
            "ORDER BY lock_key) AS ordered"
        ),
        {"ids": sorted(cids)},
    )


def _mixed_release_overlap(new_lock):
    """A previous-release writer and a new writer save different ballots sharing 2
    candidates whose IDs and lock keys sort in opposite orders."""
    factory = get_session_factory()
    with factory() as probe:
        first, second, _ = _ids_with_reversed_keys(probe, start=80)
    own_old, own_new = "e" * 63 + "1", "e" * 63 + "2"
    old_db, new_db = factory(), factory()
    new_pid = new_db.scalar(text("SELECT pg_backend_pid()"))
    errors: list[BaseException] = []

    def new_writer():
        try:
            new_lock(new_db, [second, first, own_new])
            records.save_candidate_records(
                new_db,
                profiles=[_profile(cid) for cid in sorted([first, second, own_new])],
                source_hash="b" * 64,
                checked_at=NOW + timedelta(hours=1),
            )
            new_db.commit()
        except BaseException as error:  # noqa: BLE001
            errors.append(error)
            new_db.rollback()

    thread = threading.Thread(target=new_writer)

    def start_new_writer_and_wait():
        thread.start()
        _wait_until_waiting(new_pid)

    try:
        _previous_release_save(
            old_db,
            [first, second, own_old],
            checked_at=NOW,
            between=start_new_writer_and_wait,
        )
        old_db.commit()
    except BaseException as error:  # noqa: BLE001
        errors.append(error)
        old_db.rollback()
    finally:
        thread.join(timeout=30)
        old_db.close()
        new_db.close()
    ids = [first, second, own_old, own_new]
    with factory() as db:
        rows, versions = _state(db, ids)
    _cleanup(ids)
    return errors, rows, versions, (first, second, own_old, own_new)


def _history(versions):
    found: dict[str, list[tuple[str, datetime]]] = {}
    for _, record_id, source_hash, checked_at in versions:
        found.setdefault(record_id, []).append((source_hash, checked_at))
    return {cid: sorted(items) for cid, items in found.items()}


def test_previous_and_new_release_writers_overlap_without_deadlock(seed_database):
    errors, rows, versions, ids = _mixed_release_overlap(records.lock_candidate_records)
    first, second, own_old, own_new = ids
    old_read, new_read = ("a" * 64, NOW), ("b" * 64, NOW + timedelta(hours=1))
    assert errors == []
    assert len(rows) == 4
    for cid in (first, second):
        # The newer read wins, and both writers' accepted reads are kept.
        assert rows[cid][2] == NOW + timedelta(hours=1)
    assert _history(versions) == {
        first: [old_read, new_read],
        second: [old_read, new_read],
        own_old: [old_read],
        own_new: [new_read],
    }


def test_key_order_locking_would_deadlock_against_previous_release(seed_database):
    from sqlalchemy.exc import OperationalError

    errors, *_ = _mixed_release_overlap(_key_order_lock)
    assert len(errors) == 1
    assert isinstance(errors[0], OperationalError)
    assert "deadlock detected" in str(errors[0])


def test_overlapping_opposite_order_batches_and_older_read_finish(seed_database):
    factory = get_session_factory()
    ids = sorted(f"{index:02x}" * 32 for index in range(140, 170))
    first, second = ids[:20], ids[10:]
    barrier = threading.Barrier(2)

    def save(batch, source_hash, checked_at):
        with factory() as db:
            barrier.wait(timeout=10)
            records.save_candidate_records(
                db,
                profiles=[_profile(cid) for cid in batch],
                source_hash=source_hash,
                checked_at=checked_at,
            )
            # Hold every lock briefly so the 2 transactions really overlap.
            time.sleep(0.2)
            db.commit()

    try:
        for _ in range(3):
            with ThreadPoolExecutor(max_workers=2) as pool:
                newer = NOW + timedelta(hours=1)
                futures = [
                    pool.submit(save, first, "c" * 64, newer),
                    pool.submit(save, list(reversed(second)), "d" * 64, NOW),
                ]
                for future in futures:
                    future.result(timeout=30)
        with factory() as db:
            rows, versions = _state(db, ids)
        assert len(rows) == 30
        for cid in first:
            # The newer read wins whichever transaction finished last.
            assert rows[cid][2] == NOW + timedelta(hours=1)
        newer_read, older_read = ("c" * 64, newer), ("d" * 64, NOW)
        expected = {
            cid: sorted(
                ([newer_read] if cid in first else [])
                + ([older_read] if cid in second else [])
            )
            for cid in ids
        }
        # Every accepted read is kept exactly once, including the older one.
        assert _history(versions) == expected
    finally:
        _cleanup(ids)


def test_ids_sharing_a_lock_key_save_in_one_batch(seed_database):
    factory = get_session_factory()
    with factory() as db:
        pair = db.execute(
            text(
                "WITH k AS (SELECT encode(sha256(convert_to(g::text, 'UTF8')), 'hex')"
                " AS id FROM generate_series(1, 500000) AS g)"
                " SELECT min(id), max(id) FROM k GROUP BY hashtext(id)"
                " HAVING count(*) > 1 LIMIT 1"
            )
        ).first()
    assert pair is not None
    a, b = pair
    try:
        with factory() as db:
            records.save_candidate_records(
                db,
                profiles=[_profile(b), _profile(a)],
                source_hash="a" * 64,
                checked_at=NOW,
            )
            db.commit()
            assert len(_state(db, [a, b])[0]) == 2
    finally:
        _cleanup([a, b])


def test_ballot_read_back_matches_per_candidate_profile_records(
    public_db,  # noqa: F811
):
    db = public_db
    register = records.reviewed_register()["candidates"]
    response = {
        "kind": "results",
        "electionId": register[0]["profile"]["election"]["id"],
        "races": [
            {"entries": [{"kind": "candidate", "candidate": {"id": item["id"]}}]}
            for item in register
        ]
        + [{"entries": [{"kind": "candidate", "candidate": {"id": "f" * 64}}]}],
    }
    today = NOW.date() + timedelta(days=100)
    enriched = records.enrich_lookup_results(db, response, today=today)
    for item, race in zip(register, enriched["races"], strict=False):
        expected = records.add_profile_records(
            db, db.get(CandidateRecord, item["id"]).public_payload, today=today
        )
        shown = race["entries"][0]["candidate"]
        assert shown["people"] == expected["people"]
        assert shown["electionEnded"] == expected["electionEnded"]
        assert shown.get("result") == expected.get("result")
        assert shown["result"]["outcome"] in {"elected", "not-elected"}
    assert enriched["races"][-1]["entries"][0]["candidate"] == {"id": "f" * 64}
    assert enriched["resultsAvailable"] is True


def test_ballot_read_back_keeps_reviewed_legislator_link_checks(
    subject,  # noqa: F811
    monkeypatch,
):
    db, profile, period, _ = subject
    profile["election"]["type"] = "general"
    profile["votingArea"] = "Example source district"
    pid = str(uuid4())
    register = records.reviewed_register()
    monkeypatch.setattr(
        records,
        "reviewed_register",
        lambda: {
            **register,
            "legislatorPeople": [
                {
                    "id": pid,
                    "candidateId": profile["candidate"]["id"],
                    "legislatorSlug": period.legislator.slug,
                }
            ],
        },
    )
    records.save_candidate_records(
        db, profiles=[profile], source_hash="e" * 64, checked_at=NOW
    )
    assert records.sync_reviewed_legislators(db, today=NOW.date()) == 1
    response = {
        "kind": "results",
        "electionId": "8334",
        "races": [
            {
                "entries": [
                    {
                        "kind": "candidate",
                        "candidate": {"id": profile["candidate"]["id"]},
                    }
                ]
            }
        ],
    }
    shown = records.enrich_lookup_results(db, response, today=NOW.date())
    people = shown["races"][0]["entries"][0]["candidate"]["people"]
    assert [person["id"] for person in people] == [pid]
    # A changed government member source removes the link on the next read.
    period.profile_url = "https://www.senate.mn/members/member_bio.html?leg_id=123"
    shown = records.enrich_lookup_results(db, response, today=NOW.date())
    assert shown["races"][0]["entries"][0]["candidate"]["people"] == []
    assert db.get(PublicPerson, UUID(pid)) is not None
    assert db.scalar(
        select(PersonCandidacy).where(PersonCandidacy.person_id == UUID(pid))
    )
