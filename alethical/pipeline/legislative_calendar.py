"""Reviewed sitting intervals, separate from the two-year bill storage session.

Source: https://www.lrl.mn.gov/history/sessions, read 2026-10-07.
Unknown session codes still require a reviewed mapping in sessions.py.
"""

from dataclasses import dataclass
from datetime import date, timedelta

from alethical.pipeline.legislative_refresh import bill_refresh_interval
from alethical.pipeline.sessions import session_definition

SOURCE_URL = "https://www.lrl.mn.gov/history/sessions"
REVIEWED_AT = date(2026, 10, 7)


@dataclass(frozen=True)
class SittingInterval:
    session_code: str
    start: date
    end: date | None
    special: bool = False


REVIEWED_SITTINGS = (
    SittingInterval("0942025", date(2025, 1, 14), date(2025, 5, 19)),
    SittingInterval("1942025", date(2025, 6, 9), date(2025, 6, 10), special=True),
    SittingInterval("0942026", date(2026, 2, 17), date(2026, 5, 18)),
    # Scheduled convening, House session information; actual adjournment unknown.
    SittingInterval("0952027", date(2027, 1, 12), None),
)


def session_refresh_interval(session_code: str, now: date) -> timedelta:
    definition = session_definition(session_code)
    # Either yearly regular discovery code returns the whole biennium, so both
    # aliases share its clock. The scheduler selects only 1 job for their slug.
    intervals = [
        interval
        for interval in REVIEWED_SITTINGS
        if session_definition(interval.session_code).slug == definition.slug
    ]
    return min(
        (
            bill_refresh_interval(
                now,
                sitting_start=interval.start,
                sitting_end=interval.end,
                special=interval.special,
            )
            for interval in intervals
        ),
        default=timedelta(days=7),
    )
