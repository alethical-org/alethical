#!/usr/bin/env python3
"""Repair the 94th Legislature roster identities that block House votes (#540).

Dry-run by default. The 3 sorted names below are the official short forms used
by the Minnesota House, not expansions invented by Alethical:

* Paul Anderson: House/LRL member 15301 and House vote name ``Anderson, P. H.``.
* Patti Anderson: House member 15610 and House vote/author name ``Anderson, P. E.``.
* Liz Lee: House/LRL member 15576, whose legal name is Kaozouapa Elizabeth Lee,
  and House vote name ``Lee, K.``.

The same repair removes leaked ``Senator``/``Representative`` titles and restores
Amanda Hemmingsen-Jaeger's official 2023-2025 House service alongside her current
Senate service.
"""

from __future__ import annotations

import argparse
from dataclasses import asdict, dataclass
import json
from pathlib import Path
import re
import tempfile

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from alethical.db.models import (
    Chamber,
    District,
    LegislativeSession,
    Legislator,
    LegislatorServicePeriod,
)
from alethical.db.session import NO_PREPARED_STATEMENTS, database_url_for_target
from alethical.pipeline.minnesota import strip_legislative_title


OFFICIAL_SORT_NAMES = {
    "15301": "Anderson, P. H.",
    "15610": "Anderson, P. E.",
    "15576": "Lee, K.",
}
AMANDA_MEMBER_KEY = "15620"
SESSION_SLUG = "94-2025-regular"


@dataclass
class RepairStats:
    title_names: int = 0
    official_sort_names: int = 0
    house_service_periods: int = 0


def _member_key(legislator: Legislator) -> str | None:
    match = re.search(r"(\d+)\s*$", legislator.external_key or "")
    return match.group(1) if match else None


def _members_by_key(db: Session) -> dict[str, Legislator]:
    wanted = {*OFFICIAL_SORT_NAMES, AMANDA_MEMBER_KEY}
    found: dict[str, Legislator] = {}
    for legislator in db.scalars(select(Legislator)).all():
        key = _member_key(legislator)
        if key not in wanted:
            continue
        if key in found:
            raise RuntimeError(f"More than 1 legislator has official member id {key}")
        found[key] = legislator
    missing = wanted - found.keys()
    if missing:
        raise RuntimeError(f"Missing official legislator member ids: {sorted(missing)}")
    return found


def repair_vote_roster_identities(db: Session, *, dry_run: bool) -> RepairStats:
    stats = RepairStats()
    members = _members_by_key(db)

    for legislator in db.scalars(select(Legislator)).all():
        clean_full = strip_legislative_title(legislator.full_name)
        clean_sort = strip_legislative_title(legislator.sort_name)
        if clean_full == legislator.full_name and clean_sort == legislator.sort_name:
            continue
        stats.title_names += 1
        if not dry_run:
            legislator.full_name = clean_full
            legislator.sort_name = clean_sort

    for member_key, sort_name in OFFICIAL_SORT_NAMES.items():
        legislator = members[member_key]
        if legislator.sort_name == sort_name:
            continue
        stats.official_sort_names += 1
        if not dry_run:
            legislator.sort_name = sort_name

    amanda = members[AMANDA_MEMBER_KEY]
    session = db.scalar(
        select(LegislativeSession).where(LegislativeSession.slug == SESSION_SLUG)
    )
    house = db.scalar(select(Chamber).where(Chamber.slug == "house"))
    senate = db.scalar(select(Chamber).where(Chamber.slug == "senate"))
    if session is None or house is None or senate is None:
        raise RuntimeError(
            "The 94th Legislature session and both chambers are required"
        )
    house_district = db.scalar(
        select(District).where(
            District.chamber_id == house.id,
            District.code == "47A",
        )
    )
    if house_district is None:
        raise RuntimeError("House district 47A is missing")

    periods = db.scalars(
        select(LegislatorServicePeriod).where(
            LegislatorServicePeriod.legislator_id == amanda.id,
            LegislatorServicePeriod.session_id == session.id,
        )
    ).all()
    house_period = next((row for row in periods if row.chamber_id == house.id), None)
    senate_period = next((row for row in periods if row.chamber_id == senate.id), None)
    if senate_period is None:
        raise RuntimeError(
            "Amanda Hemmingsen-Jaeger's current Senate period is missing"
        )
    if house_period is None:
        stats.house_service_periods += 1
        if not dry_run:
            if senate_period.period_sequence == 1:
                senate_period.period_sequence = (
                    max((row.period_sequence for row in periods), default=1) + 1
                )
                db.flush()
            db.add(
                LegislatorServicePeriod(
                    legislator_id=amanda.id,
                    session_id=session.id,
                    chamber_id=house.id,
                    district_id=house_district.id,
                    period_sequence=1,
                    party="DFL",
                    profile_url="https://www.house.mn.gov/members/profile/15620",
                    is_current=False,
                )
            )

    if not dry_run:
        db.flush()
    return stats


def backup_vote_roster_identities(db: Session) -> dict[str, object]:
    members = _members_by_key(db)
    affected = {
        row.id: row
        for row in db.scalars(select(Legislator)).all()
        if strip_legislative_title(row.full_name) != row.full_name
        or strip_legislative_title(row.sort_name) != row.sort_name
    }
    affected.update({row.id: row for row in members.values()})
    amanda = members[AMANDA_MEMBER_KEY]
    periods = db.scalars(
        select(LegislatorServicePeriod).where(
            LegislatorServicePeriod.legislator_id == amanda.id
        )
    ).all()
    return {
        "legislators": [
            {
                "id": str(row.id),
                "external_key": row.external_key,
                "full_name": row.full_name,
                "sort_name": row.sort_name,
            }
            for row in sorted(affected.values(), key=lambda item: str(item.id))
        ],
        "amanda_service_periods": [
            {
                "id": str(row.id),
                "session_id": str(row.session_id),
                "chamber_id": str(row.chamber_id),
                "district_id": str(row.district_id),
                "period_sequence": row.period_sequence,
                "is_current": row.is_current,
            }
            for row in sorted(periods, key=lambda item: item.period_sequence)
        ],
    }


def _write_backup(path: Path, payload: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        mode="w",
        encoding="utf-8",
        dir=path.parent,
        prefix=f".{path.name}.",
        suffix=".tmp",
        delete=False,
    ) as handle:
        temporary = Path(handle.name)
        json.dump(payload, handle, indent=2, sort_keys=True)
        handle.write("\n")
    temporary.replace(path)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", choices=("local", "production"), required=True)
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--backup-path", type=Path)
    args = parser.parse_args()
    if args.write and args.backup_path is None:
        parser.error("--write requires --backup-path")

    engine = create_engine(
        database_url_for_target(args.target),
        pool_pre_ping=True,
        connect_args=NO_PREPARED_STATEMENTS,
    )
    with Session(engine) as db:
        if args.backup_path is not None:
            _write_backup(args.backup_path, backup_vote_roster_identities(db))
        stats = repair_vote_roster_identities(db, dry_run=not args.write)
        if args.write:
            db.commit()
    print(json.dumps({"write": args.write, **asdict(stats)}, sort_keys=True))


if __name__ == "__main__":
    main()
