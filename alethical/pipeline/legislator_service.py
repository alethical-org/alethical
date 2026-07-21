"""Parse and backfill each Minnesota legislator's "Legislative Service" history
— the ordered per-chamber election lines plus the current-chamber term — from
the official member bio pages, into ``legislator_election_history`` (issue #486).

Two source shapes, both reachable at the member's stored ``profile_url``:

* **Senate** — a dedicated ``Legislative Service:`` table. Each ``Elected:`` row
  is one chamber tenure; multi-chamber members (House → Senate) get several rows,
  each optionally qualified with ``to the House`` / ``to the Senate`` and listing
  re-election years. A single ``Term:`` row gives the current (Senate) term.
  The stored ``member_bio.php?leg_id=`` URL 302-redirects to the senate.mn page
  that carries this block, so no ``leg_id``→``mem_id`` mapping is needed.
* **House** — the same fields embedded in ``Biographical Information:``. The House
  bio lists only the *initial* election year (no re-elections) plus an
  authoritative ``Term:`` count, and never qualifies the chamber (implicitly
  House).

Standalone backfill script (mirrors ``pipeline/votes.py``): ``--dry-run`` is the
default-safe path, ``--name-like`` / ``--limit`` scope a live check to a few
members before the full ~200-member run, and each member is committed
independently so one bad bio can't abort the run.
"""

from __future__ import annotations

import argparse
import html
import os
import re
from dataclasses import dataclass, field

from sqlalchemy import create_engine, delete, func, select
from sqlalchemy.orm import Session

from alethical.db.models import (
    Chamber,
    ChamberType,
    Legislator,
    LegislatorElectionHistory,
    LegislatorServicePeriod,
)
from alethical.db.session import (
    NO_PREPARED_STATEMENTS,
    get_database_url,
    normalize_database_url,
    supabase_database_url,
)
from alethical.pipeline.minnesota import fetch_text, http_session

# The bio markup labels every field with a bold <strong>Label:</strong>; we key
# the parse off those markers and read the plain text up to the next tag.
_ELECTED_RE = re.compile(r"<strong>\s*Elected:\s*</strong>([^<]*)", re.I)
_TERM_RE = re.compile(r"<strong>\s*Term:\s*</strong>([^<]*)", re.I)
_CHAMBER_RE = re.compile(r"to the (House|Senate)", re.I)
# Four-digit years in a plausible election range (guards against stray numbers).
_YEAR_RE = re.compile(r"\b(1[89]\d\d|20\d\d)\b")
_ORDINAL_RE = re.compile(r"\b(\d+)")


@dataclass
class ElectionPeriod:
    """One chamber tenure: the chamber elected to, the first election year, and
    any subsequent re-election years for that same tenure (Senate only)."""

    chamber_type: str  # "house" | "senate"
    initial_year: int
    reelection_years: list[int] = field(default_factory=list)


@dataclass
class ServiceHistory:
    periods: list[ElectionPeriod]
    term: int | None


def _service_block(html_text: str, current_chamber_type: str) -> str:
    """Narrow the page to the block that holds the Elected/Term markers, so a
    stray "Elected" elsewhere on the page can't leak in. Falls back to the whole
    page if the expected heading isn't found."""
    if current_chamber_type == ChamberType.senate.value:
        match = re.search(r"Legislative Service:.*?</table>", html_text, re.S | re.I)
    else:
        match = re.search(r"Biographical Information:.*?</ul>", html_text, re.S | re.I)
    return match.group(0) if match else html_text


def parse_service_history(html_text: str, current_chamber_type: str) -> ServiceHistory:
    """Extract the ordered election lines + current-chamber term from a member's
    bio HTML. ``current_chamber_type`` ("house"/"senate") supplies the chamber
    for election lines that carry no explicit "to the {chamber}" qualifier —
    single-chamber Senate bios and every House bio omit it."""
    block = _service_block(html_text, current_chamber_type)
    periods: list[ElectionPeriod] = []
    for match in _ELECTED_RE.finditer(block):
        raw = html.unescape(match.group(1))
        chamber_match = _CHAMBER_RE.search(raw)
        chamber_type = (
            chamber_match.group(1).lower() if chamber_match else current_chamber_type
        )
        years = [int(y) for y in _YEAR_RE.findall(raw)]
        if not years:
            continue
        periods.append(
            ElectionPeriod(
                chamber_type=chamber_type,
                initial_year=years[0],
                reelection_years=years[1:],
            )
        )

    term: int | None = None
    term_match = _TERM_RE.search(block)
    if term_match:
        ordinal = _ORDINAL_RE.search(html.unescape(term_match.group(1)))
        if ordinal:
            term = int(ordinal.group(1))

    return ServiceHistory(periods=periods, term=term)


# ── Backfill ────────────────────────────────────────────────────────────────


@dataclass
class MemberTarget:
    legislator_id: object
    full_name: str
    current_chamber_type: str
    profile_url: str


def _load_targets(
    db: Session, *, name_like: str | None, limit: int | None
) -> list[MemberTarget]:
    stmt = (
        select(
            Legislator.id,
            Legislator.full_name,
            Chamber.chamber_type,
            LegislatorServicePeriod.profile_url,
        )
        .join(
            LegislatorServicePeriod,
            LegislatorServicePeriod.legislator_id == Legislator.id,
        )
        .join(Chamber, Chamber.id == LegislatorServicePeriod.chamber_id)
        .where(LegislatorServicePeriod.is_current.is_(True))
        .order_by(Legislator.sort_name)
    )
    if name_like:
        stmt = stmt.where(Legislator.full_name.ilike(f"%{name_like}%"))
    if limit:
        stmt = stmt.limit(limit)
    targets: list[MemberTarget] = []
    for leg_id, full_name, chamber_type, profile_url in db.execute(stmt).all():
        if not profile_url:
            continue
        targets.append(
            MemberTarget(
                legislator_id=leg_id,
                full_name=full_name,
                current_chamber_type=chamber_type.value
                if hasattr(chamber_type, "value")
                else str(chamber_type),
                profile_url=profile_url,
            )
        )
    return targets


def _chamber_ids(db: Session) -> dict[str, object]:
    rows = db.execute(select(Chamber.chamber_type, Chamber.id)).all()
    ids: dict[str, object] = {}
    for chamber_type, chamber_id in rows:
        key = (
            chamber_type.value if hasattr(chamber_type, "value") else str(chamber_type)
        )
        ids[key] = chamber_id
    return ids


def _describe(target: MemberTarget, history: ServiceHistory) -> str:
    lines = []
    for period in history.periods:
        label = "House" if period.chamber_type == ChamberType.house.value else "Senate"
        reelect = f"{period.initial_year}" + (
            ", re-elected " + ", ".join(str(y) for y in period.reelection_years)
            if period.reelection_years
            else ""
        )
        lines.append(f"    Elected to the {label}: {reelect}")
    lines.append(f"    Term: {history.term}")
    return f"{target.full_name} [{target.current_chamber_type}]\n" + "\n".join(lines)


def backfill(
    db: Session,
    *,
    dry_run: bool = True,
    only_missing: bool = False,
    name_like: str | None = None,
    limit: int | None = None,
    sess=None,
) -> dict[str, int]:
    """Fetch + parse each current member's bio and (unless ``dry_run``) replace
    that member's ``legislator_election_history`` rows. Writes are additive to a
    feature-owned table and idempotent per legislator (delete-then-insert), so a
    re-run is safe. Each member commits independently."""
    sess = sess or http_session()
    chamber_ids = _chamber_ids(db)
    targets = _load_targets(db, name_like=name_like, limit=limit)
    stats = {
        "members": len(targets),
        "written": 0,
        "rows": 0,
        "skipped_existing": 0,
        "no_data": 0,
        "fetch_errors": 0,
        "write_errors": 0,
    }

    for target in targets:
        if only_missing:
            existing = db.scalar(
                select(func.count())
                .select_from(LegislatorElectionHistory)
                .where(LegislatorElectionHistory.legislator_id == target.legislator_id)
            )
            if existing:
                stats["skipped_existing"] += 1
                continue

        try:
            page = fetch_text(sess, target.profile_url)
        except Exception as exc:  # noqa: BLE001 — isolate one bad bio
            stats["fetch_errors"] += 1
            print(f"FETCH ERROR {target.full_name}: {exc}")
            continue

        history = parse_service_history(page, target.current_chamber_type)
        if not history.periods:
            stats["no_data"] += 1
            print(f"NO DATA    {target.full_name} ({target.profile_url})")
            continue

        print(_describe(target, history))

        if dry_run:
            stats["rows"] += len(history.periods)
            continue

        try:
            db.execute(
                delete(LegislatorElectionHistory).where(
                    LegislatorElectionHistory.legislator_id == target.legislator_id
                )
            )
            last_index = len(history.periods) - 1
            for index, period in enumerate(history.periods):
                chamber_id = chamber_ids.get(period.chamber_type)
                if chamber_id is None:
                    raise ValueError(f"no chamber row for {period.chamber_type}")
                is_current = index == last_index
                db.add(
                    LegislatorElectionHistory(
                        legislator_id=target.legislator_id,
                        chamber_id=chamber_id,
                        period_sequence=index + 1,
                        initial_year=period.initial_year,
                        reelection_years=list(period.reelection_years),
                        is_current_chamber=is_current,
                        term_number=history.term if is_current else None,
                    )
                )
            db.commit()
            stats["written"] += 1
            stats["rows"] += len(history.periods)
        except Exception as exc:  # noqa: BLE001
            db.rollback()
            stats["write_errors"] += 1
            print(f"WRITE ERROR {target.full_name}: {exc}")

    return stats


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Backfill legislator_election_history from official MN member bios "
            "(issue #486). Dry-run by default; pass --write to persist."
        )
    )
    parser.add_argument(
        "--database-url",
        default=os.environ.get("DATABASE_URL")
        or supabase_database_url()
        or get_database_url(),
    )
    parser.add_argument(
        "--write",
        action="store_true",
        help="Persist rows. Omit (the default) for a dry run that only prints.",
    )
    parser.add_argument(
        "--only-missing",
        action="store_true",
        help="Skip members that already have election-history rows.",
    )
    parser.add_argument(
        "--name-like",
        default=None,
        help="Restrict to members whose full_name ILIKE %%STR%% (scoped check).",
    )
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args()

    if not args.database_url:
        raise SystemExit("DATABASE_URL or Supabase env vars are required")

    engine = create_engine(
        normalize_database_url(args.database_url),
        pool_pre_ping=True,
        connect_args=NO_PREPARED_STATEMENTS,
    )
    with Session(engine) as db:
        stats = backfill(
            db,
            dry_run=not args.write,
            only_missing=args.only_missing,
            name_like=args.name_like,
            limit=args.limit,
        )
    mode = "WROTE" if args.write else "DRY-RUN"
    print(f"\n[{mode}] {stats}")


if __name__ == "__main__":
    main()
