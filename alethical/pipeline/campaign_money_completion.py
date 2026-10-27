"""Keep a filed campaign report owed until its totals and its legislator's page catch up.

Net: a new report on the Minnesota Campaign Finance Board's list used to be handled once.
The daily refresh saw the list change, copied the Board's summary figures, and recorded
the list as done. The Board often updates that summary days after the report itself
appears, so the copy could be valid and still a period behind, and nothing asked again
until the weekly full refresh. On October 27, 2026, 166 of 200 sitting legislators had a
filed report newer than the totals their page showed.

This module is the completion check that closes that gap, run by the shared updater as
the ``campaign-completion`` job (``alethical/pipeline/record_refresh.py``). Each turn it
works out, from the published data alone, what is still owed, so nothing can be consumed
by a run that copied old figures:

1. **Lagging filer-years**: a regular report in the live snapshot ends later than the
   period its stored summary covers. A termination report is listed with a December 31
   cut-off, so a report's period is taken to end on the earliest of its cut-off, its
   filed date and the committee's termination date.
2. **A small, bounded probe** of those filers' own summaries on the Board, sitting
   legislators' committees first. When the Board now covers a newer period than ours,
   the catch-up is recorded in ``cf_refresh_state`` and a full totals refresh is asked
   for, at most once per ``CATCH_UP_SPACING`` since the last full run or request, and
   never while a campaign run holds its lease. The refresh's planner treats the record
   as a reason to fetch totals and removes it after a successful totals run; this check
   removes it once our published totals reach what the Board showed.
3. **Filings a confirmed link's reviewed years leave off a legislator's page.** A link
   records the years its reviewer saw donations; a later filing outside them is hidden
   from the profile. That is never widened here: the case is reported for a person to
   confirm, because which committee belongs to which member is a person's decision
   (`docs/architecture/campaign-finance-system-design.md` §5, Identity).

The JSON finding it prints is stored by the shared runner and shown on the grouped
health issue. Exit 2 means a person is needed (filings hidden in the years a page opens
on, or the Board has been ahead of us for longer than ``BOARD_AHEAD_BUDGET``); exit 1
means every probe failed. Hidden filings in older years are listed without exit 2.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any, Callable, Iterable, Mapping, Optional, Sequence

from sqlalchemy import text
from sqlalchemy.orm import Session

from alethical.pipeline import campaign_finance_filings as filings
from alethical.pipeline.campaign_finance_refresh import TOTALS_CATCH_UP_KEY
from alethical.pipeline.legislator_committee_match import is_for_a_legislative_office

#: The ``cf_refresh_state`` key the totals planner reads as a reason to fetch totals.
CATCH_UP_KEY = TOTALS_CATCH_UP_KEY
#: When each lagging filer was last asked, and since when the Board has been ahead.
PROBES_KEY = "totals_catch_up_probes"
#: Board requests per turn: 20 sitting legislators' committees, then 5 others.
MEMBER_PROBES = 20
OTHER_PROBES = 5
#: A full totals run reads about 6,400 Board responses, so a catch-up asks for one at
#: most this often. Faster than the weekly fallback by a factor of 28.
CATCH_UP_SPACING = timedelta(hours=6)
#: How long the Board may be ahead of our published totals before a person is told.
#: The spacing above plus a full run of about an hour, with room for 1 failed attempt.
BOARD_AHEAD_BUDGET = timedelta(hours=14)
#: Codes the shared runner reads: 2 is its review exit for this job.
REVIEW_EXIT = 2
#: The first year a legislator's money tab offers (``from`` accepts 2015 on
#: ``GET /legislators/{legislator_id}/campaign-finance/years``), so the first year a
#: filing hidden by reviewed years can cost a reader.
PROFILE_FIRST_YEAR = 2015


@dataclass(frozen=True)
class LaggingFilerYear:
    """A filer-year whose newest regular report ends after its stored summary period."""

    registration_number: str
    kind: filings.FilerKind
    filing_year: int
    our_through: Optional[date]
    expected_through: date
    newest_report: Optional[str]
    member: Optional[str]


@dataclass(frozen=True)
class HiddenFilings:
    """Filing years of a confirmed legislative link that its reviewed years leave out."""

    registration_number: str
    member: str
    first_year_as_reviewed: Optional[str]
    last_year_as_reviewed: Optional[str]
    years: tuple[int, ...]


def checked_years(today: date) -> list[int]:
    """The years a legislator's page opens on: last year and this one."""
    return filings.default_years(today)


_LAGGING_SQL = text("""
WITH live AS (SELECT snapshot_id FROM cf_filing_current),
reports AS (
    SELECT r.registration_number, r.filing_year,
           LEAST(r.cut_off_date, r.filed_date, t.termination_date) AS period_end,
           r.report_name
    FROM cf_filing_report r JOIN live ON live.snapshot_id = r.snapshot_id
    LEFT JOIN cf_filer t ON t.snapshot_id = r.snapshot_id
                        AND t.registration_number = r.registration_number
    WHERE NOT r.special_election AND r.cut_off_date IS NOT NULL
      AND r.filing_year = ANY(:years)
),
newest AS (
    SELECT DISTINCT ON (registration_number, filing_year)
           registration_number, filing_year, period_end, report_name
    FROM reports
    ORDER BY registration_number, filing_year, period_end DESC, report_name
)
SELECT n.registration_number, k.kind, n.filing_year, f.reported_through,
       n.period_end, n.report_name
FROM newest n
JOIN live ON TRUE
JOIN cf_filer k ON k.snapshot_id = live.snapshot_id
              AND k.registration_number = n.registration_number
LEFT JOIN cf_filing f ON f.snapshot_id = live.snapshot_id
                     AND f.registration_number = n.registration_number
                     AND f.filing_year = n.filing_year
WHERE f.reported_through IS NULL OR n.period_end > f.reported_through
ORDER BY n.registration_number, n.filing_year
""")

_CONFIRMED_SQL = text("""
SELECT l.registration_number, lg.slug, l.office_as_reviewed,
       l.first_year_as_reviewed, l.last_year_as_reviewed
FROM legislator_campaign_committee l
JOIN legislator lg ON lg.id = l.legislator_id
WHERE l.decision = 'confirmed' AND l.withdrawn_at IS NULL
""")

_FILED_YEARS_SQL = text("""
SELECT DISTINCT r.registration_number, r.filing_year
FROM cf_filing_report r JOIN cf_filing_current c ON c.snapshot_id = r.snapshot_id
WHERE NOT r.special_election AND r.filing_year = ANY(:years)
  AND r.registration_number = ANY(:registrations)
""")


def _year(value: Optional[str]) -> Optional[int]:
    """A reviewed year, read the way the profile reads it: unparseable is unbounded."""
    try:
        return int(value) if value else None
    except ValueError:
        return None


def hidden_filings(
    links: Iterable[Mapping[str, Any]],
    filed_years: Mapping[str, set[int]],
) -> list[HiddenFilings]:
    """Confirmed legislative links with filed years outside their reviewed years.

    The same period test as the profile (``_period_covers`` in
    ``alethical/api/services/independent_spending.py``), so a case here is exactly a
    year the page leaves out. A committee for another office is left out on purpose by
    the page and is not a case.
    """
    found = []
    for link in links:
        if not is_for_a_legislative_office(link["office_as_reviewed"]):
            continue
        first = _year(link["first_year_as_reviewed"])
        last = _year(link["last_year_as_reviewed"])
        outside = tuple(
            sorted(
                year
                for year in filed_years.get(link["registration_number"], ())
                if (first is not None and year < first)
                or (last is not None and year > last)
            )
        )
        if outside:
            found.append(
                HiddenFilings(
                    registration_number=link["registration_number"],
                    member=link["slug"],
                    first_year_as_reviewed=link["first_year_as_reviewed"],
                    last_year_as_reviewed=link["last_year_as_reviewed"],
                    years=outside,
                )
            )
    return sorted(found, key=lambda item: (item.member, item.registration_number))


def read_state(db: Session, years: Sequence[int]):
    """Lagging filer-years and hidden filings, from the live snapshot and links."""
    links = [dict(row) for row in db.execute(_CONFIRMED_SQL).mappings()]
    members = {
        link["registration_number"]: link["slug"]
        for link in links
        if is_for_a_legislative_office(link["office_as_reviewed"])
    }
    lagging = [
        LaggingFilerYear(
            registration_number=row["registration_number"],
            kind=filings.FilerKind(
                row["kind"].value if hasattr(row["kind"], "value") else row["kind"]
            ),
            filing_year=int(row["filing_year"]),
            our_through=row["reported_through"],
            expected_through=row["period_end"],
            newest_report=row["report_name"],
            member=members.get(row["registration_number"]),
        )
        for row in db.execute(_LAGGING_SQL, {"years": list(years)}).mappings()
    ]
    filed: dict[str, set[int]] = {}
    for row in db.execute(
        _FILED_YEARS_SQL,
        {
            "years": list(range(PROFILE_FIRST_YEAR, max(years) + 1)),
            "registrations": sorted({link["registration_number"] for link in links}),
        },
    ).mappings():
        filed.setdefault(row["registration_number"], set()).add(int(row["filing_year"]))
    return lagging, hidden_filings(links, filed)


def choose_probes(
    lagging: Sequence[LaggingFilerYear],
    probes: Mapping[str, Mapping[str, Any]],
    *,
    member_limit: int = MEMBER_PROBES,
    other_limit: int = OTHER_PROBES,
) -> list[tuple[str, filings.FilerKind, tuple[int, int], list[LaggingFilerYear]]]:
    """Which filers to ask the Board about this turn, oldest-asked first.

    1 request answers both years of an election segment, so filer-years are grouped by
    filer and segment before counting. Sitting legislators' committees come first; a
    small share goes to every other committee so committee pages are never starved.
    """
    groups: dict[tuple[str, tuple[int, int]], list[LaggingFilerYear]] = {}
    for item in lagging:
        segment = filings.segment_for_year(item.filing_year)
        groups.setdefault((item.registration_number, segment), []).append(item)

    def order(key):
        registration, _segment = key
        asked = (probes.get(registration) or {}).get("probed_at") or ""
        oldest = min(item.expected_through for item in groups[key])
        return (asked, oldest, registration)

    members = sorted((k for k, v in groups.items() if v[0].member), key=order)
    others = sorted((k for k, v in groups.items() if not v[0].member), key=order)
    chosen = members[:member_limit] + others[:other_limit]
    return [
        (
            registration,
            groups[(registration, segment)][0].kind,
            segment,
            groups[(registration, segment)],
        )
        for registration, segment in chosen
    ]


def board_ahead(
    items: Sequence[LaggingFilerYear], tab: filings.FinancialTab
) -> list[dict[str, Any]]:
    """The filer-years whose Board summary now covers a later period than ours."""
    ahead = []
    for item in items:
        block = tab.years.get(item.filing_year)
        board = block.reported_through if block else None
        if board is not None and (item.our_through is None or board > item.our_through):
            ahead.append(
                {
                    "registration_number": item.registration_number,
                    "year": item.filing_year,
                    "board_through": board.isoformat(),
                    "our_through": item.our_through.isoformat()
                    if item.our_through
                    else None,
                }
            )
    return ahead


def still_ahead(row: Mapping[str, Any], item: Optional[LaggingFilerYear]) -> bool:
    """Whether a saved Board-ahead row still describes our published totals.

    Not when the filer-year left the lagging set, and not when our period now reaches
    what the Board showed: a filer can stay lagging after a totals run because the
    Board's summary is itself behind its newest listed report.
    """
    if item is None:
        return False
    if item.our_through is None:
        return True
    return date.fromisoformat(row["board_through"]) > item.our_through


Probe = Callable[[str, filings.FilerKind, tuple[int, int]], filings.FinancialTab]


@dataclass
class CompletionResult:
    code: int
    finding: dict[str, Any]
    request_totals: bool
    state: dict[str, Any]


def _ahead_rows(state: Mapping[str, Mapping[str, Any]]) -> list[dict[str, Any]]:
    return [row for entry in state.values() for row in entry.get("ahead", [])]


def evaluate(
    lagging: Sequence[LaggingFilerYear],
    hidden: Sequence[HiddenFilings],
    probes_state: Mapping[str, Mapping[str, Any]],
    *,
    probe: Probe,
    now: datetime,
    last_full_refresh_at: Optional[datetime],
    last_requested_at: Optional[datetime] = None,
    totals_running: bool = False,
    alarm_years: Iterable[int] = (),
) -> CompletionResult:
    """One turn's decision, with the Board reached only through ``probe``.

    Pure apart from ``probe``, so the whole rule is testable without a network or a
    database. Returns the finding to print, whether to ask for a totals refresh, and
    the probe state to save. A totals refresh is asked for only while no campaign run
    holds its lease and ``CATCH_UP_SPACING`` has passed since both the last full totals
    run and the last request, so a quarantined run waiting for a person is not
    repeated every hour. Hidden filings need a person only in ``alarm_years``, the
    years a page opens on; older ones are listed without holding the job in review.
    """
    current = {(item.registration_number, item.filing_year): item for item in lagging}
    registrations = {registration for registration, _year in current}
    state: dict[str, dict[str, Any]] = {}
    for registration, entry in probes_state.items():
        if registration not in registrations:
            continue
        kept = dict(entry)
        rows = [
            row
            for row in entry.get("ahead", [])
            if still_ahead(row, current.get((registration, row["year"])))
        ]
        if rows:
            kept["ahead"] = rows
        else:
            kept.pop("ahead", None)
        state[registration] = kept

    errors = 0
    asked = 0
    for registration, kind, segment, items in choose_probes(lagging, state):
        asked += 1
        entry = state.setdefault(registration, {})
        entry["probed_at"] = now.isoformat()
        try:
            tab = probe(registration, kind, segment)
        except Exception as error:  # a source failure is counted, never raised
            errors += 1
            entry["error"] = type(error).__name__
            continue
        if tab.errors:
            errors += 1
            entry["error"] = "unreadable"
            continue
        entry.pop("error", None)
        # 1 answer covers 1 election segment; rows for the filer's other segment stay.
        years = {item.filing_year for item in items}
        earlier = {row["year"]: row for row in entry.get("ahead", [])}
        rows = [row for row in entry.get("ahead", []) if row["year"] not in years]
        for row in board_ahead(items, tab):
            row["since"] = earlier.get(row["year"], {}).get("since", now.isoformat())
            rows.append(row)
        if rows:
            entry["ahead"] = rows
        else:
            entry.pop("ahead", None)

    ahead = _ahead_rows(state)
    since = [datetime.fromisoformat(row["since"]) for row in ahead if row.get("since")]
    ahead_since = min(since) if since else None
    recent = [moment for moment in (last_full_refresh_at, last_requested_at) if moment]
    request_totals = (
        bool(ahead)
        and not totals_running
        and (not recent or now - max(recent) >= CATCH_UP_SPACING)
    )
    late = ahead_since is not None and now - ahead_since > BOARD_AHEAD_BUDGET
    alarm = set(alarm_years)
    hidden_now = [h for h in hidden if alarm & set(h.years)]
    unavailable = bool(asked) and errors == asked

    members = sorted({item.member for item in lagging if item.member})
    results = []
    if late:
        # Keyed by when the oldest unresolved case began, so the hourly churn of which
        # filers were asked does not read as a new problem and mention the owner again.
        results.append(
            {
                "source": "campaign-totals-catch-up",
                "status": "review_required",
                "finding_key": _key(["late", ahead_since.isoformat()]),
            }
        )
    if hidden_now:
        results.append(
            {
                "source": "campaign-reviewed-years",
                "status": "review_required",
                "finding_key": _key(
                    [(h.registration_number, list(h.years)) for h in hidden_now]
                ),
            }
        )
    if unavailable:
        results.append({"source": "campaign-totals-catch-up", "status": "unavailable"})

    oldest = min((item.expected_through for item in lagging), default=None)
    finding = {
        "status": "review_required"
        if late or hidden_now
        else "unavailable"
        if unavailable
        else "complete",
        "results": results,
        "lagging_filer_years": len(lagging),
        "lagging_members": len(members),
        "oldest_report_period_end": oldest.isoformat() if oldest else None,
        "probed": asked,
        "probe_errors": errors,
        "board_ahead": sorted(
            ahead, key=lambda row: (row["registration_number"], row["year"])
        )[:20],
        "board_ahead_count": len(ahead),
        "board_ahead_since": ahead_since.isoformat() if ahead_since else None,
        "catch_up_requested": request_totals,
        "hidden_filings": [
            {
                "registration_number": h.registration_number,
                "member": h.member,
                "reviewed_years": [h.first_year_as_reviewed, h.last_year_as_reviewed],
                "years": list(h.years),
                "needs_review": h in hidden_now,
            }
            for h in hidden
        ],
    }
    code = REVIEW_EXIT if late or hidden_now else 1 if unavailable else 0
    return CompletionResult(code, finding, request_totals, state)


def _key(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()[:16]


def catch_up_marker(
    existing: Optional[Mapping[str, Any]], result: CompletionResult, now: datetime
) -> Optional[dict[str, Any]]:
    """The planner's reason to fetch totals, or None when nothing is owed any more.

    None removes the record: an empty set of Board-ahead rows means our published totals
    reach what the Board showed, and a leftover record would only cost another full
    Board read. ``detected_at`` is the newest row's first sighting, so a totals run that
    started after every row was seen settles the record, and a row first seen during
    the run keeps it.
    """
    ahead = _ahead_rows(result.state)
    if not ahead:
        return None
    seen = sorted(row["since"] for row in ahead if row.get("since")) or [
        now.astimezone(UTC).isoformat()
    ]
    return {
        "detected_at": seen[-1],
        "first_detected_at": seen[0],
        "requested_at": now.astimezone(UTC).isoformat()
        if result.request_totals
        else (existing or {}).get("requested_at"),
        "filer_years": sorted(
            f"{row['registration_number']}:{row['year']}" for row in ahead
        )[:50],
    }
