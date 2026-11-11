"""Read one published, immutable election-results generation at a time.

These reads do not match campaign accounts or infer winners. A snapshot parameter
keeps later pages and source evidence on the same returns, including after a newer
copy is published. Staged-but-unpublished copies are never reader-visible.
"""

from __future__ import annotations

from copy import deepcopy
from itertools import islice
from typing import NoReturn

from sqlalchemy import cast, func, or_, select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Session

from alethical.api.problems import problem_exception
from alethical.api.services import finance_versions
from alethical.db import models as m
from alethical.pipeline.election_comparison import read_source
from alethical.pipeline.raw_file_store import raw_file_store_from_env


def _not_found() -> NoReturn:
    raise problem_exception(
        404, "Not Found", "These election records are not available"
    )


def snapshot(
    db: Session, election_key: str, snapshot_id: str | None = None
) -> m.ElectionComparisonSnapshot:
    finance_versions.pin(db)
    query = select(m.ElectionComparisonSnapshot).where(
        m.ElectionComparisonSnapshot.election_key == election_key,
        m.ElectionComparisonSnapshot.first_published_at.is_not(None),
    )
    if snapshot_id is None:
        query = query.join(
            m.ElectionComparisonCurrent,
            m.ElectionComparisonCurrent.snapshot_id == m.ElectionComparisonSnapshot.id,
        ).where(m.ElectionComparisonCurrent.election_key == election_key)
    else:
        query = query.where(m.ElectionComparisonSnapshot.id == snapshot_id)
    result = db.scalar(query)
    if result is None:
        _not_found()
    return result


def _sources(source: m.ElectionComparisonSnapshot) -> list[dict]:
    # Object-store keys and local collector paths are implementation details.
    fields = {
        "file",
        "url",
        "sha256",
        "bytes",
        "fetched_at",
        "last_modified",
        "content_type",
    }
    return [{k: v for k, v in s.items() if k in fields} for s in source.sources]


def _coverage(source: m.ElectionComparisonSnapshot) -> dict:
    # Raw exclusion inventories can contain thousands of source rows. A reader
    # gets their counts here and can open the retained original for the records.
    coverage = deepcopy(source.coverage)
    for key in ("excluded_rows", "excluded_summary_rows"):
        rows = coverage.pop(key, [])
        coverage[f"{key}_count"] = len(rows)
    coverage.pop("county_names", None)
    bounds = coverage.get("comparison_checks", {}).get("precinct_voter_bound")
    if isinstance(bounds, dict):
        bounds.pop("discrepancies", None)
        bounds["unchecked_race_count"] = len(bounds.pop("unchecked_race_ids", []))
    return coverage


def _context(source: m.ElectionComparisonSnapshot) -> dict:
    published_at = source.first_published_at
    if published_at is None:
        _not_found()
    return {
        "election_key": source.election_key,
        "election_date": source.election_date.isoformat(),
        "stage": source.stage,
        "snapshot_id": source.id,
        "copied_at": source.fetched_at.isoformat(),
        "first_published_at": published_at.isoformat(),
    }


def elections(db: Session) -> dict:
    finance_versions.pin(db)
    held = db.scalars(
        select(m.ElectionComparisonSnapshot)
        .join(
            m.ElectionComparisonCurrent,
            m.ElectionComparisonCurrent.snapshot_id == m.ElectionComparisonSnapshot.id,
        )
        .where(m.ElectionComparisonSnapshot.first_published_at.is_not(None))
        .order_by(
            m.ElectionComparisonSnapshot.election_date.desc(),
            m.ElectionComparisonSnapshot.election_key,
        )
    ).all()
    return {"elections": [{**_context(s), "coverage": _coverage(s)} for s in held]}


def _county_name(source: m.ElectionComparisonSnapshot, county: str) -> str | None:
    return source.coverage.get("county_names", {}).get(county)


def _diagnostics(
    source: m.ElectionComparisonSnapshot,
    race: m.ElectionComparisonRace,
    *,
    county: str | None = None,
    precinct: str | None = None,
) -> list[dict]:
    rows = (
        source.coverage.get("comparison_checks", {})
        .get("precinct_voter_bound", {})
        .get("discrepancies", [])
    )
    return [
        deepcopy(row)
        for row in rows
        if row.get("race_id") == race.payload.get("race_id")
        and row.get("office_id") == race.office_id
        and (race.jurisdiction == "88" or row.get("county_id") == race.jurisdiction)
        and (county is None or row.get("county_id") == county)
        and (precinct is None or row.get("precinct_id") == precinct)
    ]


def _race(source: m.ElectionComparisonSnapshot, race: m.ElectionComparisonRace) -> dict:
    payload = deepcopy(race.payload)
    bounds = source.coverage.get("comparison_checks", {}).get(
        "precinct_voter_bound", {}
    )
    diagnostics = _diagnostics(source, race)
    bound_status = (
        "not_checked"
        if not bounds or payload.get("race_id") in bounds.get("unchecked_race_ids", [])
        else "discrepancies"
        if diagnostics
        else "no_discrepancies_found"
    )
    return {
        **payload,
        "id": race.id,
        "label": race.label,
        "office_id": race.office_id,
        "jurisdiction": race.jurisdiction,
        "county_name": _county_name(source, race.jurisdiction),
        "result_status": race.result_status,
        "diagnostics": diagnostics,
        "precinct_voter_bound_status": bound_status,
    }


def races(
    db: Session,
    *,
    election_key: str,
    snapshot_id: str | None,
    q: str,
    limit: int,
    offset: int,
) -> dict:
    source = snapshot(db, election_key, snapshot_id)
    race = m.ElectionComparisonRace
    filters = [race.snapshot_id == source.id]
    query = " ".join(q.split())
    if query:
        counties = [
            key
            for key, name in source.coverage.get("county_names", {}).items()
            if query.casefold() in name.casefold()
        ]
        candidate = func.jsonb_array_elements(race.payload["candidates"]).table_valued(
            "value"
        )
        candidate_name_matches = (
            select(1)
            .select_from(candidate)
            .where(
                cast(candidate.c.value, JSONB)["name"].astext.icontains(
                    query, autoescape=True
                )
            )
            .correlate(race)
            .exists()
        )
        filters.append(
            or_(
                race.label.icontains(query, autoescape=True),
                race.payload["district"].astext.icontains(query, autoescape=True),
                candidate_name_matches,
                race.jurisdiction.in_(counties),
            )
        )
    total = db.execute(
        select(func.count()).select_from(race).where(*filters)
    ).scalar_one()
    rows = db.scalars(
        select(race)
        .where(*filters)
        .order_by(race.label, race.jurisdiction, race.id)
        .limit(limit)
        .offset(offset)
    ).all()
    return {
        **_context(source),
        "query": query,
        "coverage": _coverage(source),
        "races": [_race(source, row) for row in rows],
        "page": {
            "total": total,
            "offset": offset,
            "limit": limit,
            "has_more": offset + len(rows) < total,
        },
    }


def race_record(
    db: Session, source: m.ElectionComparisonSnapshot, race_id: str
) -> m.ElectionComparisonRace:
    row = db.get(m.ElectionComparisonRace, (source.id, race_id))
    if row is None:
        _not_found()
    return row


def race_detail(
    db: Session,
    *,
    election_key: str,
    race_id: str,
    snapshot_id: str | None,
) -> dict:
    source = snapshot(db, election_key, snapshot_id)
    race = race_record(db, source, race_id)
    return {
        **_context(source),
        "race": _race(source, race),
        "sources": _sources(source),
        "coverage": _coverage(source),
    }


def precincts(
    db: Session,
    *,
    election_key: str,
    race_id: str,
    snapshot_id: str,
    q: str,
    county: str | None,
    limit: int,
    offset: int,
) -> dict:
    source = snapshot(db, election_key, snapshot_id)
    race = race_record(db, source, race_id)
    precinct = m.ElectionComparisonPrecinct
    query = " ".join(q.split())
    filters = [precinct.snapshot_id == source.id, precinct.race_id == race.id]
    if query:
        filters.append(precinct.name.icontains(query, autoescape=True))
    if county:
        filters.append(precinct.county == county)
    total = db.execute(
        select(func.count()).select_from(precinct).where(*filters)
    ).scalar_one()
    rows = db.scalars(
        select(precinct)
        .where(*filters)
        .order_by(precinct.county, precinct.name, precinct.key)
        .limit(limit)
        .offset(offset)
    ).all()
    return {
        **_context(source),
        "race_id": race.id,
        "query": query,
        "county": county,
        "result_status": race.result_status,
        "precincts": [
            {
                **deepcopy(row.payload),
                "key": row.key,
                "name": row.name,
                "county": row.county,
                "county_name": _county_name(source, row.county),
                "diagnostics": _diagnostics(
                    source, race, county=row.county, precinct=row.key.split(":", 1)[-1]
                ),
            }
            for row in rows
        ],
        "page": {
            "total": total,
            "offset": offset,
            "limit": limit,
            "has_more": offset + len(rows) < total,
        },
    }


def source_body(
    db: Session,
    *,
    election_key: str,
    snapshot_id: str,
    source_hash: str,
) -> tuple[bytes, dict]:
    source = snapshot(db, election_key, snapshot_id)
    metadata = next((s for s in _sources(source) if s["sha256"] == source_hash), None)
    if metadata is None:
        _not_found()
    stored = db.get(m.ElectionResultSource, source_hash)
    if stored is None:
        raise problem_exception(
            503,
            "Service Unavailable",
            "This source copy is temporarily unavailable. Try again.",
        )
    try:
        body = read_source(raw_file_store_from_env(), stored)
    except Exception as error:
        # No corrupt source, object-store address or provider failure leaks out.
        raise problem_exception(
            503,
            "Service Unavailable",
            "This source copy is temporarily unavailable. Try again.",
        ) from error
    return body, metadata


def source_lines(
    db: Session,
    *,
    election_key: str,
    snapshot_id: str,
    source_hash: str,
    start: int,
    limit: int,
) -> dict:
    body, metadata = source_body(
        db, election_key=election_key, snapshot_id=snapshot_id, source_hash=source_hash
    )
    encoding = (
        "utf-8"
        if metadata.get("file", "").lower().endswith((".html", ".htm"))
        else "windows-1252"
    )
    try:
        text = body.decode(encoding, errors="strict")
    except UnicodeDecodeError as error:
        raise problem_exception(
            503,
            "Service Unavailable",
            "The text of this source copy is unavailable. Download the original file.",
        ) from error
    lines = text.splitlines()
    return {
        "election_key": election_key,
        "snapshot_id": snapshot_id,
        "source": metadata,
        "encoding": encoding,
        "lines": [
            {"number": number, "text": line}
            for number, line in enumerate(
                islice(lines, start - 1, start - 1 + limit), start
            )
        ],
        "page": {
            "total": len(lines),
            "start": start,
            "limit": limit,
            "has_more": start - 1 + limit < len(lines),
        },
    }
