"""Publish a filings snapshot holding exactly the filed figures a test needs.

Rule 12's second number -- what a committee's own filed report says it took in and
paid out -- lives in the filings snapshot, and several suites need one committee-year
of it. They used to fake it by monkeypatching the reader function that returns it.
That went stale the moment the read moved
([#1966](https://github.com/alethical-org/alethical/issues/1966)), and the failure was
worse than a red test: 3 of the 6 patched tests kept passing while exercising nothing,
because they assert the figure is withheld and an unpatched read withholds it too.

Its own module rather than a fixture in one suite, for the same reason
``empty_data_tables.py`` is its own module: pytest imports each ``conftest.py`` under
its own name, and 2 suites need this to mean the same thing.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from datetime import UTC, date, datetime
from decimal import Decimal

from sqlalchemy import text

from alethical.db import models

#: When the fake snapshot was fetched. Fixed rather than "now", so a test reading a
#: date off it keeps meaning the same thing next year.
FETCHED_AT = datetime(2026, 8, 12, 9, 0, tzinfo=UTC)


def clear_filings_snapshots(session) -> None:
    """Remove every published filings snapshot, filer and report.

    Filings and their figures go with the snapshot they belong to, which cascades.
    Called from a suite's own reset so a snapshot one test publishes cannot hand the
    next test a reported figure it never asked for -- the way a stale
    ``cf_stated_spending`` row once turned a ``not_run`` case green.
    """
    session.execute(text("UPDATE cf_filing_current SET snapshot_id = NULL"))
    session.execute(text("DELETE FROM cf_filing_report"))
    session.execute(text("DELETE FROM cf_filer"))
    session.execute(text("DELETE FROM cf_filing_snapshot"))


def publish_filings_snapshot(
    session,
    *,
    filings: Sequence[tuple[str, int, str, Decimal, date | None]],
    special_election: Sequence[tuple[str, int]] = (),
    kind: models.CampaignFinanceFilerKind = (
        models.CampaignFinanceFilerKind.candidate_committee
    ),
) -> uuid.UUID:
    """A live filings snapshot holding exactly these filed figures.

    Written straight in rather than through the loader, the same way
    ``test_campaign_finance_filing_calendars.py`` does it: what is under test is what a
    *read* makes of stored rows, and the loader's own refusals have their own suite.

    Each filing is (registration number, year, line key, amount, coverage end); several
    lines for one filer-year are added together exactly as the reader adds them, so a
    test can build a real multi-line contribution total. ``special_election`` marks a
    filer-year as one the Board's totals route cannot speak for.
    """
    snapshot = models.CampaignFinanceFilingSnapshot(
        fetch_started_at=FETCHED_AT,
        fetch_completed_at=FETCHED_AT,
        status=models.CampaignFinanceSnapshotStatus.loaded,
    )
    session.add(snapshot)
    session.flush()
    stored: dict[tuple[str, int], uuid.UUID] = {}
    for registration, year, line_key, amount, through in filings:
        filing_id = stored.get((registration, year))
        if filing_id is None:
            filing = models.CampaignFinanceFiling(
                snapshot_id=snapshot.id,
                registration_number=registration,
                filer_kind=kind,
                filing_year=year,
                segment_start=year,
                segment_end=year + 1,
                block_heading=str(year),
                reported_through=through,
                response_hash="0" * 64,
                archive_line=0,
            )
            session.add(filing)
            session.flush()
            filing_id = filing.id
            stored[(registration, year)] = filing_id
        session.add(
            models.CampaignFinanceFilingFigure(
                filing_id=filing_id,
                line_key=line_key,
                label_as_served=line_key,
                amount=amount,
            )
        )
    for row_number, (registration, year) in enumerate(special_election):
        session.add(
            models.CampaignFinanceFilingReport(
                snapshot_id=snapshot.id,
                row_number=row_number,
                registration_number=registration,
                filing_year=year,
                report_type="C",
                report_name="Special election report",
                special_election=True,
            )
        )
    pointer = session.get(models.CampaignFinanceFilingCurrentSnapshot, True)
    if pointer is None:
        session.add(
            models.CampaignFinanceFilingCurrentSnapshot(snapshot_id=snapshot.id)
        )
    else:
        pointer.snapshot_id = snapshot.id
    session.commit()
    return snapshot.id
