"""Keep checked election returns with atomic publication and an explicit restore.

Collection and publication are separate. This module never downloads a live file
while calculating a race: every input is a hashed, retained source generation.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import re
import tempfile
from collections import defaultdict
from contextlib import ExitStack
from datetime import UTC, date, datetime
from pathlib import Path

from sqlalchemy import func, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from alethical.db import models as m
from alethical.pipeline.raw_file_store import sha256_of_file


class ComparisonImportError(ValueError):
    """A failed validation must not replace the last published returns."""


def _hash_json(hasher, value):
    encoder = json.JSONEncoder(
        sort_keys=True, separators=(",", ":"), ensure_ascii=False
    )
    for chunk in encoder.iterencode(value):
        hasher.update(chunk.encode())


def digest(value: object) -> str:
    """Hash the old canonical bytes without a complete encoded copy."""
    hasher = hashlib.sha256()
    _hash_json(hasher, value)
    return hasher.hexdigest()


def _ordered_generation_digest(generation, *, races, precincts, strict=False):
    """Shared canonical writer for Python-sorted rows and ordered DB cursors.

    Only the two row arrays are streamed. Other top fields, including unknown
    legacy fields, retain their exact old canonical encoding and exclusions.
    """
    content = {
        k: v
        for k, v in generation.items()
        if k not in {"id", "fetched_at", "races", "precincts"}
    }
    content["sources"] = sorted(
        ({k: v for k, v in s.items() if k != "fetched_at"} for s in content["sources"]),
        key=lambda s: (s["sha256"], s.get("url", "")),
    )
    content.update(races=races, precincts=precincts)
    hasher = hashlib.sha256()
    hasher.update(b"{")
    for index, field in enumerate(sorted(content)):
        if index:
            hasher.update(b",")
        _hash_json(hasher, field)
        hasher.update(b":")
        if field not in {"races", "precincts"}:
            _hash_json(hasher, content[field])
            continue
        hasher.update(b"[")
        previous = None
        for row_index, row in enumerate(content[field]):
            key = row["id"] if field == "races" else (row["race_id"], row["key"])
            if strict and previous is not None and key <= previous:
                raise ComparisonImportError("Staged records are not uniquely ordered")
            previous = key
            if row_index:
                hasher.update(b",")
            _hash_json(hasher, row)
        hasher.update(b"]")
    hasher.update(b"}")
    return hasher.hexdigest()


def generation_digest(generation: dict) -> str:
    """Hash data, not observation time or incidental iteration order."""
    return _ordered_generation_digest(
        generation,
        races=sorted(generation["races"], key=lambda r: r["id"]),
        precincts=sorted(
            generation["precincts"], key=lambda r: (r["race_id"], r["key"])
        ),
    )


def archive_source(db: Session, store, body: bytes) -> str:
    """Read back the compressed source before any database reference exists."""
    source_hash = hashlib.sha256(body).hexdigest()
    compressed = gzip.compress(body, mtime=0)
    compressed_hash = hashlib.sha256(compressed).hexdigest()
    key = f"elections/returns/{source_hash}.gz"
    with tempfile.TemporaryDirectory(prefix="election-source-") as directory:
        path = Path(directory) / "body.gz"
        path.write_bytes(compressed)
        store.put_and_verify(key, str(path), compressed_hash)
    db.execute(
        insert(m.ElectionResultSource)
        .values(
            content_hash=source_hash,
            object_key=key,
            byte_size=len(body),
            compressed_hash=compressed_hash,
            compressed_byte_size=len(compressed),
            compression="gzip",
        )
        .on_conflict_do_nothing()
    )
    stored = db.get(m.ElectionResultSource, source_hash, populate_existing=True)
    if stored is None or (
        stored.object_key,
        stored.byte_size,
        stored.compressed_hash,
        stored.compressed_byte_size,
        stored.compression,
    ) != (key, len(body), compressed_hash, len(compressed), "gzip"):
        raise ComparisonImportError(
            "Existing archive metadata does not match verified bytes"
        )
    return source_hash


def read_source(store, source: m.ElectionResultSource) -> bytes:
    try:
        with tempfile.TemporaryDirectory(prefix="election-read-") as directory:
            path = str(Path(directory) / "body.gz")
            store.get(source.object_key, path, max_bytes=source.compressed_byte_size)
            if sha256_of_file(path) != source.compressed_hash:
                raise ComparisonImportError("Stored source fingerprint does not match")
            with gzip.open(path, "rb") as handle:
                body = handle.read(source.byte_size + 1)
        if (
            len(body) != source.byte_size
            or hashlib.sha256(body).hexdigest() != source.content_hash
        ):
            raise ComparisonImportError("Restored source fingerprint does not match")
        return body
    except Exception as error:
        record_failure = getattr(store, "record_failure", None)
        if callable(record_failure):
            record_failure(error)
        raise


def prepare_generation(
    *,
    election_key: str,
    election_date: date,
    stage: str,
    fetched_at: datetime,
    sources: list[dict],
    built: dict,
    precinct_names: dict[tuple[str, str], str],
    coverage: dict,
) -> dict:
    """Turn the strict parser's reconciled races into storage rows.

    Unreconciled races are retained as unavailable, with their specific errors;
    they never supply vote or money figures. Publication requires its declared
    scope to explain those gaps, rather than quietly dropping them.
    """
    if stage not in {"general", "primary", "special"} or fetched_at.tzinfo is None:
        raise ComparisonImportError("Invalid election context")
    if election_key != f"mn-{election_date.isoformat()}-{stage}":
        raise ComparisonImportError("Election key does not match date and stage")
    source_hashes = {s["sha256"] for s in sources}
    if not sources or any(
        not re.fullmatch(r"[0-9a-f]{64}", s["sha256"]) for s in sources
    ):
        raise ComparisonImportError("Original source fingerprints are required")
    races, precincts, seen = [], [], set()
    for original in built["races"]:
        race = json.loads(json.dumps(original))
        race_id = digest([election_key, race["race_id"]])
        if race_id in seen:
            raise ComparisonImportError("Duplicate race identity")
        seen.add(race_id)
        if race["source_status"] != "unofficial":
            raise ComparisonImportError(
                "Certification needs separate exact-race evidence"
            )
        for field in (
            "source_sha256",
            "candidate_source_sha256",
            "summary_source_sha256",
        ):
            if race.get(field) not in source_hashes:
                raise ComparisonImportError(
                    "Race evidence is missing from source manifest"
                )
        rows = race.pop("precinct_rows")
        valid = (
            race["coverage"]["reconciled"] is True and not race["coverage"]["errors"]
        )
        grouped = defaultdict(list)
        for row in rows:
            key = (row["county_id"], row["precinct_id"])
            if key not in precinct_names:
                raise ComparisonImportError(
                    "Precinct missing from official precinct register"
                )
            grouped[key].append(row)
        if len(grouped) != race["coverage"]["held_precincts"]:
            raise ComparisonImportError("Precinct coverage count changed")
        for candidate in race["candidates"]:
            if candidate.get("outcome") is not None:
                raise ComparisonImportError(
                    "Unofficial counts cannot declare an outcome"
                )
            if not valid:
                candidate["votes"] = None
        race["total_votes"] = (
            sum(c["votes"] for c in race["candidates"] if c["votes"] is not None)
            if valid
            else None
        )
        race["result_status"] = "unofficial" if valid else "unavailable"
        races.append(
            {
                "id": race_id,
                "label": race["office_name"],
                "office_id": race["office_id"],
                "jurisdiction": race["jurisdiction_id"],
                "result_status": race["result_status"],
                "payload": race,
            }
        )
        if valid:
            for (county, precinct), entries in sorted(grouped.items()):
                precincts.append(
                    {
                        "race_id": race_id,
                        "key": f"{county}:{precinct}",
                        "name": precinct_names[(county, precinct)],
                        "county": county,
                        "payload": {
                            "rows": entries,
                            "source_sha256": race["source_sha256"],
                        },
                    }
                )
    if not races:
        raise ComparisonImportError("No candidate races in this generation")
    content = {
        "format": 1,
        "election_key": election_key,
        "election_date": election_date.isoformat(),
        "stage": stage,
        "sources": sources,
        "races": races,
        "precincts": precincts,
        "coverage": {
            **coverage,
            "races": len(races),
            "reconciled_races": sum(r["result_status"] == "unofficial" for r in races),
            "precinct_race_records": len(precincts),
            "excluded_rows": built.get("excluded_rows", []),
            "excluded_summary_rows": built.get("excluded_summary_rows", []),
        },
    }
    # Observation time is retained, but does not mint duplicate data generations.
    snapshot_id = generation_digest(content)
    return {**content, "id": snapshot_id, "fetched_at": fetched_at.isoformat()}


def stage_generation(db: Session, generation: dict) -> str:
    """All rows are inserted together. Caller commits after validation/read-back."""
    try:
        with db.begin_nested():
            return _stage_generation(db, generation)
    except (KeyError, TypeError, AttributeError) as error:
        raise ComparisonImportError("Prepared generation is incomplete") from error


def _stage_generation(db: Session, generation: dict) -> str:
    snapshot_id = generation["id"]
    if snapshot_id != generation_digest(generation):
        raise ComparisonImportError("Prepared generation fingerprint does not match")
    if (
        not generation["races"]
        or len(generation["races"]) != generation["coverage"]["races"]
        or len(generation["precincts"])
        != generation["coverage"]["precinct_race_records"]
    ):
        raise ComparisonImportError("Prepared coverage counts do not match records")
    if db.get(m.ElectionComparisonSnapshot, snapshot_id):
        return snapshot_id
    hashes = {s["sha256"] for s in generation["sources"]}
    held = set(
        db.scalars(
            select(m.ElectionResultSource.content_hash).where(
                m.ElectionResultSource.content_hash.in_(hashes)
            )
        )
    )
    if held != hashes:
        raise ComparisonImportError("Archive every original before staging its figures")
    db.add(
        m.ElectionComparisonSnapshot(
            id=snapshot_id,
            election_key=generation["election_key"],
            election_date=date.fromisoformat(generation["election_date"]),
            stage=generation["stage"],
            fetched_at=datetime.fromisoformat(generation["fetched_at"]),
            sources=generation["sources"],
            coverage=generation["coverage"],
        )
    )
    db.flush()
    for table, key in (
        (m.ElectionComparisonRace, "races"),
        (m.ElectionComparisonPrecinct, "precincts"),
    ):
        rows = generation[key]
        for offset in range(0, len(rows), 250):
            db.execute(
                insert(table),
                [
                    {"snapshot_id": snapshot_id, **r}
                    for r in rows[offset : offset + 250]
                ],
            )
    return snapshot_id


def publish_generation(
    db: Session,
    snapshot_id: str,
    *,
    expected_previous: str | None,
    restore: bool = False,
) -> dict:
    """Compare-and-swap prevents competing publication and enables exact restore."""
    candidate = db.get(
        m.ElectionComparisonSnapshot, snapshot_id, populate_existing=True
    )
    if candidate is None:
        raise ComparisonImportError("Snapshot is not staged")
    db.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:key))"),
        {"key": f"election-comparison:{candidate.election_key}"},
    )
    current = db.get(
        m.ElectionComparisonCurrent, candidate.election_key, populate_existing=True
    )
    previous = current.snapshot_id if current else None
    if previous != expected_previous:
        raise ComparisonImportError(
            "Published generation changed; review the current one"
        )
    race_count = db.scalar(
        select(func.count())
        .select_from(m.ElectionComparisonRace)
        .where(m.ElectionComparisonRace.snapshot_id == snapshot_id)
    )
    precinct_count = db.scalar(
        select(func.count())
        .select_from(m.ElectionComparisonPrecinct)
        .where(m.ElectionComparisonPrecinct.snapshot_id == snapshot_id)
    )
    hashes = {s["sha256"] for s in candidate.sources}
    held = set(
        db.scalars(
            select(m.ElectionResultSource.content_hash).where(
                m.ElectionResultSource.content_hash.in_(hashes)
            )
        )
    )
    if (
        not race_count
        or race_count != candidate.coverage["races"]
        or precinct_count != candidate.coverage["precinct_race_records"]
        or not hashes
        or held != hashes
    ):
        raise ComparisonImportError("Staged records or source coverage changed")

    # Counts alone cannot detect a changed vote. Re-read staged data before
    # exposing its fingerprint, including during a restore or repeat publish.
    restored = {
        "format": 1,
        "election_key": candidate.election_key,
        "election_date": candidate.election_date.isoformat(),
        "stage": candidate.stage,
        "sources": candidate.sources,
        "coverage": candidate.coverage,
    }
    with ExitStack() as cursors:

        def stored_rows(model, fields, order):
            result = cursors.enter_context(
                db.execute(
                    select(*(getattr(model, field) for field in fields))
                    .where(model.snapshot_id == snapshot_id)
                    .order_by(*(getattr(model, field).collate("C") for field in order))
                    .execution_options(yield_per=250)
                )
            )
            return (dict(row) for row in result.mappings())

        actual = _ordered_generation_digest(
            restored,
            races=stored_rows(
                m.ElectionComparisonRace,
                (
                    "id",
                    "label",
                    "office_id",
                    "jurisdiction",
                    "result_status",
                    "payload",
                ),
                ("id",),
            ),
            precincts=stored_rows(
                m.ElectionComparisonPrecinct,
                ("race_id", "key", "name", "county", "payload"),
                ("race_id", "key"),
            ),
            strict=True,
        )
    if actual != snapshot_id:
        raise ComparisonImportError("Staged content fingerprint changed")
    if previous and not restore:
        old = db.get(m.ElectionComparisonSnapshot, previous, populate_existing=True)
        if old and old.fetched_at > candidate.fetched_at:
            raise ComparisonImportError("Older generation requires an explicit restore")
    if candidate.first_published_at is None:
        candidate.first_published_at = datetime.now(UTC)
        db.flush()
    db.execute(
        insert(m.ElectionComparisonCurrent)
        .values(
            election_key=candidate.election_key,
            snapshot_id=snapshot_id,
        )
        .on_conflict_do_update(
            index_elements=["election_key"],
            set_={"snapshot_id": snapshot_id},
        )
    )
    return {
        "election_key": candidate.election_key,
        "previous": previous,
        "current": snapshot_id,
    }
