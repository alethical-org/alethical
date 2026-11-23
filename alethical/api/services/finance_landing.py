"""The record counts on Alethical.AI's public landing page.

Each count is read live from the current published copy of its source and is
refused, never reported as 0, when it cannot be read
(docs/architecture/alethical-finance-architecture.md §9). Counts are of records,
never money, and each names its source and the years it covers, so a reader
never takes a count of rows for a count of donations or ads.

The pattern is ``register_summary`` in
``alethical/api/services/campaign_finance_register.py``: a missing source, a
replaced set of rows and a database failure each answer "unavailable" with a
reason, and only a real read answers "reported".
"""

from __future__ import annotations

import logging
from dataclasses import asdict, dataclass
from datetime import date, datetime
from typing import Callable

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from alethical.api.services.legislative_freshness import legislative_copy_date
from alethical.api.services.legislative_sessions import current_legislature_scope
from alethical.api.services.lobbying import published_pair
from alethical.db import models as m
from alethical.pipeline.campaign_finance_reader import (
    Dataset,
    ReleaseNoLongerHeld,
    _refuse_if_rows_are_gone,
    live_release,
)
from alethical.pipeline.fcc_public_files import DEFAULT_STATIONS

logger = logging.getLogger(__name__)

REPORTED = "reported"
UNAVAILABLE = "unavailable"

NOTHING_PUBLISHED = "nothing_published"
ROWS_REPLACED = "rows_replaced"
UNREADABLE = "unreadable"
EMPTY = "empty"

BOARD = "Minnesota Campaign Finance Board"
FCC = "FCC public inspection files"
SECRETARY_OF_STATE = "Minnesota Secretary of State"

# The national FCC inventory asks the FCC for every day of political-file history
# from January 1, 2012 (docs/operations/national-fcc-archive.md), so its index
# speaks for 2012 onward and no earlier.
NATIONAL_FCC_FIRST_YEAR = 2012


@dataclass(frozen=True)
class LandingCount:
    state: str
    count: int | None
    unit: str
    source: str
    first_year: int | None = None
    last_year: int | None = None
    copied_at: str | None = None
    # Lobbying only: the organizations whose spending the reports record.
    organizations: int | None = None
    reason: str | None = None
    # A calendar date ("YYYY-MM-DD") with no time, so a page never moves it a day
    # across time zones: the national FCC index's last complete day.
    as_of: str | None = None
    # Bills only: roll calls held for the same sessions; None when unreadable.
    roll_calls: int | None = None
    # Election races only: which election, and the results' official status when
    # the stored source establishes it for every counted race.
    election_label: str | None = None
    results_status: str | None = None


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _unavailable(unit: str, source: str, reason: str) -> LandingCount:
    return LandingCount(UNAVAILABLE, None, unit, source, reason=reason)


def _campaign_money(db: Session) -> LandingCount:
    unit, source = "campaign money records", BOARD
    release = live_release(db)
    if release is None:
        return _unavailable(unit, source, NOTHING_PUBLISHED)
    for dataset in Dataset:
        _refuse_if_rows_are_gone(db, release, dataset)
    files = [release.file_for(dataset) for dataset in Dataset]
    count = sum(file.row_count for file in files)
    if count == 0:
        return _unavailable(unit, source, EMPTY)
    years = [
        int(year)
        for counts in db.scalars(
            select(m.CampaignFinanceSnapshot.rows_by_year).where(
                m.CampaignFinanceSnapshot.id.in_([file.snapshot_id for file in files])
            )
        )
        for year, rows in (counts or {}).items()
        if rows and str(year).isdigit()
    ]
    copied = [release.copied_at(dataset) for dataset in Dataset]
    return LandingCount(
        REPORTED,
        count,
        unit,
        source,
        first_year=min(years, default=None),
        last_year=max(years, default=None),
        # The oldest of the 3 files' copy dates, so the date never claims a file
        # is newer than it is.
        copied_at=_iso(min((c for c in copied if c), default=None)),
    )


def _lobbying(db: Session) -> LandingCount:
    unit, source = "lobbying spending reports", BOARD
    pair = published_pair(db)
    if pair is None:
        # ``published_pair`` also answers None when a snapshot's held rows no longer
        # match its recorded count, so a replaced set is never counted.
        return _unavailable(unit, source, NOTHING_PUBLISHED)
    row = m.LobbyingExpenditureRow
    count, organizations, first_year, last_year = db.execute(
        select(
            func.count(),
            func.count(row.entity_id.distinct()),
            func.min(row.report_year),
            func.max(row.report_year),
        ).where(row.snapshot_id == pair.expenditure_snapshot_id)
    ).one()
    if not count:
        return _unavailable(unit, source, EMPTY)
    return LandingCount(
        REPORTED,
        count,
        unit,
        source,
        first_year=first_year,
        last_year=last_year,
        copied_at=_iso(pair.copied_at),
        organizations=organizations or None,
    )


def _bills(db: Session) -> LandingCount:
    unit, source = "bills in the current Legislature", "Minnesota Legislature"
    scope = current_legislature_scope(db)
    # Every bill held for every session of the sitting Legislature, a count of
    # what we hold. Not the /bills list, which leaves out a bill until its
    # plain-language summary exists.
    count = db.scalar(
        select(func.count()).select_from(m.Bill).where(m.Bill.session_id.in_(scope.ids))
    )
    if not count:
        return _unavailable(unit, source, EMPTY)
    starts = [s.year_start for s in scope.sessions if s.year_start]
    ends = [s.year_end or s.year_start for s in scope.sessions if s.year_start]
    return LandingCount(
        REPORTED,
        count,
        unit,
        source,
        first_year=min(starts, default=None),
        last_year=max(ends, default=None),
        # The date every held bill's copy supports, or none (alethical.com's rule).
        copied_at=_iso(legislative_copy_date(db, scope.ids)),
        roll_calls=_roll_calls(db, scope.ids),
    )


def _roll_calls(db: Session, session_ids) -> int | None:
    """Every recorded vote held on a bill of these sessions, each with its tally.

    Read in its own savepoint, so a failure answers None and never takes the bill
    count with it. None, never 0, when nothing is held: the landing page prints no
    zero it has not verified.
    """
    try:
        with db.begin_nested():
            count = db.scalar(
                select(func.count())
                .select_from(m.VoteEvent)
                .join(m.Bill, m.Bill.id == m.VoteEvent.bill_id)
                .where(m.Bill.session_id.in_(session_ids))
            )
    except Exception as exc:  # noqa: BLE001 -- the bill count still stands
        logger.warning("Finance landing roll calls unreadable: %s", type(exc).__name__)
        return None
    return count or None


def _station_files(db: Session) -> LandingCount:
    stations = ", ".join(station.call_sign for station in DEFAULT_STATIONS)
    unit, source = "TV station files", f"FCC public files of {stations}"
    # "Station files held" in alethical/api/services/tv_ads.py ``counts``: each
    # station and FCC file ID once, when its original contents were saved.
    # The years are the station folders' own years, as the station filed them.
    # The copy date speaks for all 3 stations, so it is the oldest of each
    # station's newest copy, and none while any station has no file held.
    count, first_year, last_year, stations_held, copied = db.execute(
        text("""
        SELECT sum(files)::bigint, min(first_year), max(last_year), count(*), min(newest)
          FROM (SELECT count(DISTINCT file_id) AS files, min(year) AS first_year,
                       max(year) AS last_year, max(last_downloaded_at) AS newest
                  FROM fcc_document WHERE facility_id = ANY(:stations)
                 GROUP BY facility_id) AS per_station
        """),
        {"stations": [station.facility_id for station in DEFAULT_STATIONS]},
    ).one()
    if not count:
        return _unavailable(unit, source, EMPTY)
    newest_copy = copied if stations_held == len(DEFAULT_STATIONS) else None
    return LandingCount(
        REPORTED,
        count,
        unit,
        source,
        first_year=first_year,
        last_year=last_year,
        copied_at=_iso(newest_copy),
    )


def _national_fcc_filings(db: Session) -> LandingCount:
    unit, source = "FCC political filings nationwide", FCC
    # The 1 active national search release: every indexed political filing,
    # through the last day of FCC history the inventory holds complete.
    release = db.execute(
        select(
            m.NationalFCCSearchRelease.filings,
            m.NationalFCCSearchRelease.index_through,
        ).where(m.NationalFCCSearchRelease.active.is_(True))
    ).one_or_none()
    if release is None:
        return _unavailable(unit, source, NOTHING_PUBLISHED)
    filings, through = release
    if not filings:
        return _unavailable(unit, source, EMPTY)
    return LandingCount(
        REPORTED,
        filings,
        unit,
        source,
        first_year=NATIONAL_FCC_FIRST_YEAR,
        last_year=through.year,
        as_of=through.isoformat(),
    )


def _election_label(election_date: date, stage: str) -> str:
    return f"{election_date:%B} {election_date.year} {stage} election"


def _election_races(db: Session) -> LandingCount:
    unit, source = "election races with results", SECRETARY_OF_STATE
    # The published copy the election pages read for the newest Minnesota general
    # election, and in the same statement its races that report results: at least
    # 1 precinct reporting, and a stored status other than pending or unavailable.
    # "unofficial" is served only when the copy says so and every race in it is
    # still unofficial with no outcome review recorded, since a review can certify
    # 1 race. The import accepts unofficial sources only, so nothing here ever
    # establishes "official".
    row = db.execute(
        text("""
        SELECT s.election_date, s.stage, s.fetched_at,
               s.coverage->>'source_status' AS source_status,
               (SELECT count(*) FROM election_comparison_race r
                 WHERE r.snapshot_id = s.id
                   AND r.result_status NOT IN ('pending', 'unavailable')
                   AND coalesce((r.payload->'coverage'->>'reporting_precincts')::int, 0) > 0
               ) AS reported,
               (SELECT count(*) FROM election_comparison_race r
                 WHERE r.snapshot_id = s.id AND r.result_status <> 'unofficial'
               ) AS not_unofficial,
               EXISTS (SELECT 1 FROM election_outcome_decision d
                        WHERE d.snapshot_id = s.id) AS reviewed
          FROM election_comparison_snapshot s
          JOIN election_comparison_current c
            ON c.snapshot_id = s.id AND c.election_key = s.election_key
         WHERE s.first_published_at IS NOT NULL
           AND s.stage = 'general'
           AND s.election_key LIKE 'mn-%'
         ORDER BY s.election_date DESC, s.election_key
         LIMIT 1
        """)
    ).one_or_none()
    if row is None:
        return _unavailable(unit, source, NOTHING_PUBLISHED)
    if not row.reported:
        return _unavailable(unit, source, EMPTY)
    unofficial = (
        row.source_status == "unofficial"
        and row.not_unofficial == 0
        and not row.reviewed
    )
    year = row.election_date.year
    return LandingCount(
        REPORTED,
        row.reported,
        unit,
        source,
        first_year=year,
        last_year=year,
        copied_at=_iso(row.fetched_at),
        election_label=_election_label(row.election_date, row.stage),
        results_status="unofficial" if unofficial else None,
    )


_COUNTS: tuple[tuple[str, str, str, Callable[[Session], LandingCount]], ...] = (
    ("campaign_money_records", "campaign money records", BOARD, _campaign_money),
    ("lobbying_spending_reports", "lobbying spending reports", BOARD, _lobbying),
    (
        "current_legislature_bills",
        "bills in the current Legislature",
        "Minnesota Legislature",
        _bills,
    ),
    ("tv_station_files", "TV station files", "FCC public files", _station_files),
    (
        "national_fcc_filings",
        "FCC political filings nationwide",
        FCC,
        _national_fcc_filings,
    ),
    (
        "election_races_with_results",
        "election races with results",
        SECRETARY_OF_STATE,
        _election_races,
    ),
)


def landing_counts(db: Session) -> dict[str, dict]:
    """Each count separately, so 1 unreadable source never hides another."""
    result = {}
    for key, unit, source, read in _COUNTS:
        try:
            count = read(db)
        except ReleaseNoLongerHeld:
            count = _unavailable(unit, source, ROWS_REPLACED)
        except Exception as exc:  # noqa: BLE001 -- 1 failure never hides another count
            db.rollback()
            logger.warning(
                "Finance landing count %s unreadable: %s", key, type(exc).__name__
            )
            count = _unavailable(unit, source, UNREADABLE)
        result[key] = asdict(count)
    return result
