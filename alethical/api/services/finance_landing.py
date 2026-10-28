"""The 4 record counts on Alethical Finance's public landing page.

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
from datetime import datetime
from typing import Callable

from sqlalchemy import func, select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

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


@dataclass(frozen=True)
class LandingCount:
    state: str
    count: int | None
    unit: str
    source: str
    first_year: int | None = None
    last_year: int | None = None
    copied_at: str | None = None
    reason: str | None = None


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
    count, first_year, last_year = db.execute(
        select(
            func.count(), func.min(row.report_year), func.max(row.report_year)
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
    )


def _bills(db: Session) -> LandingCount:
    unit, source = "bills in the current Legislature", "Minnesota Legislature"
    scope = current_legislature_scope(db)
    # The same list /bills shows: bills of every session of the sitting
    # Legislature that carry a current plain-language summary.
    count = db.scalar(
        select(func.count()).select_from(
            m.bill_list_stmt(scope.ids).order_by(None).subquery()
        )
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
    )


def _station_files(db: Session) -> LandingCount:
    stations = ", ".join(station.call_sign for station in DEFAULT_STATIONS)
    unit, source = "TV station files", f"FCC public files of {stations}"
    # "Station files held" in alethical/api/services/tv_ads.py ``counts``: each
    # station and FCC file ID once, when its original contents were saved.
    # The years are the station folders' own years, as the station filed them.
    count, first_year, last_year, newest_copy = db.execute(
        text("""
        SELECT count(DISTINCT (facility_id, file_id)), min(year), max(year),
               max(last_downloaded_at)
          FROM fcc_document WHERE facility_id = ANY(:stations)
        """),
        {"stations": [station.facility_id for station in DEFAULT_STATIONS]},
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
        copied_at=_iso(newest_copy),
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
)


def landing_counts(db: Session) -> dict[str, dict]:
    """Each count separately, so 1 unreadable source never hides another."""
    result = {}
    for key, unit, source, read in _COUNTS:
        try:
            count = read(db)
        except ReleaseNoLongerHeld:
            count = _unavailable(unit, source, ROWS_REPLACED)
        except (SQLAlchemyError, RuntimeError, LookupError) as exc:
            db.rollback()
            logger.warning(
                "Finance landing count %s unreadable: %s", key, type(exc).__name__
            )
            count = _unavailable(unit, source, UNREADABLE)
        result[key] = asdict(count)
    return result
