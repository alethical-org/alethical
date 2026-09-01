"""What a committee's own filings list must never claim.

The Filings tab on a committee's money page ([#1679](https://github.com/alethical-org/alethical/issues/1679))
lists every report the catalogue records the committee as having filed. Every test here
stands in for a way that list could put a false sentence under a named committee:

* **A report the Board scheduled is not a report anybody filed.** The catalogue lists a
  report from the moment its period opens, so an unguarded list prints "filed" under a
  committee that has not filed (§9.6's amendment-record rule). The excluded rows are
  counted, because before 2008 a missing record means the Board serves no version
  history, not "never filed", and the page says that boundary out loud.
* **No row carries an amount.** This is a list of filings, not of money.
* **A row's filing date is the Board's own or nothing at all.** A report's document
  states the day the Board received it and most of them do not exist to be read
  ([#1670](https://github.com/alethical-org/alethical/issues/1670)), so a row carries
  either that date or ``null`` -- never its period end under a "filed" label, which is
  the one substitution nobody would notice. There is still no amendment date at all.
  ``ordered_by`` names which order the list came back in.
* **A period start is read off a Board calendar or omitted.** §7 forbids hardcoding
  1 January because a special-election filer's period does not open there.
* **A committee's final report is listed even though its period has not ended.** A
  terminating committee files at termination (filer 18472's real 2026 year-end), and on
  the committee's own page that is its newest filing, not noise.

Fixtures are tiny and hand-written; registration numbers quoted in docstrings are from
the live data ([#1661](https://github.com/alethical-org/alethical/issues/1661)).

Needs the local Postgres on port 54329.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime

import pytest
from sqlalchemy import text

from alethical.api.services.campaign_finance_register import (
    NO_FILINGS_SNAPSHOT,
    ROWS_REPLACED,
)
from alethical.api.services.independent_spending import REPORTED, UNAVAILABLE
from alethical.db import models
from alethical.db.session import get_session_factory

FilerKind = models.CampaignFinanceFilerKind
SnapshotStatus = models.CampaignFinanceSnapshotStatus


def _filings_url(registration: str) -> str:
    return f"/api/v1/committees/{registration}/filings"


# Real numbers from the live register, so a reader can check any of these rows against
# the Board's own directory.
CANDIDATE = "18466"  # Port, Lindsey Senate Committee.
OTHER_CANDIDATE = (
    "18472"  # Novotny, Paul House Committee — terminated, final report filed.
)
# The filer whose 2025 period opens 11 July rather than 1 January, because it ran in a
# special election (§9.5). The one case a printed calendar start would be wrong for.
SPECIAL_ELECTION_FILER = "19223"

# Period ends the Board's own 2026 disclosure calendars print, with the starts they
# print beside them (`alethical/pipeline/campaign_finance_filing_calendars.py`).
PRE_PRIMARY_END = date(2026, 7, 20)
PRE_PRIMARY_START = date(2026, 1, 1)
YEAR_END_2025 = date(2025, 12, 31)


def _clear(session) -> None:
    session.rollback()
    session.execute(text("UPDATE cf_filing_current SET snapshot_id = NULL"))
    session.execute(text("DELETE FROM cf_filing_report"))
    session.execute(text("DELETE FROM cf_filer"))
    session.execute(text("DELETE FROM cf_filing_snapshot"))
    session.commit()


@pytest.fixture()
def db(seed_database: None):
    session = get_session_factory()()
    _clear(session)
    try:
        yield session
    finally:
        _clear(session)
        session.close()


def _filings_snapshot(db, *, report_count: int = 0):
    completed = datetime(2026, 8, 11, 6, 40, tzinfo=UTC)
    snapshot = models.CampaignFinanceFilingSnapshot(
        fetch_started_at=completed,
        fetch_completed_at=completed,
        status=SnapshotStatus.loaded,
        filer_count=0,
        report_count=report_count,
    )
    db.add(snapshot)
    db.flush()
    db.execute(
        text(
            "INSERT INTO cf_filing_current (id, snapshot_id) VALUES (true, :sid) "
            "ON CONFLICT (id) DO UPDATE SET snapshot_id = EXCLUDED.snapshot_id"
        ),
        {"sid": snapshot.id},
    )
    db.commit()
    return snapshot


def _filer(
    db,
    snapshot,
    registration: str,
    *,
    kind: FilerKind = FilerKind.candidate_committee,
    name: str = "Port, Lindsey Senate Committee",
):
    db.add(
        models.CampaignFinanceFiler(
            snapshot_id=snapshot.id,
            registration_number=registration,
            kind=kind,
            name=name,
            is_incumbent=False,
        )
    )
    db.commit()


_ROW_COUNTER: dict[uuid.UUID, int] = {}


def _report(
    db,
    snapshot,
    registration: str,
    *,
    year: int = 2026,
    report_type: str = "C",
    report_name: str = "2026 Pre-Primary Report",
    cut_off: date | None = PRE_PRIMARY_END,
    special_election: bool = False,
    amendment_index: int | None = 0,
    amendment_count: int | None = 1,
    filed_date: date | None = None,
):
    """One catalogue row.

    ``amendment_index=None`` is what an unfiled report looks like. ``filed_date=None`` is
    the default because it is the ordinary state: the loader can never set it (the
    catalogue serves no filing date) and the Board serves no readable document for most
    reports (#1670).
    """
    _ROW_COUNTER[snapshot.id] = _ROW_COUNTER.get(snapshot.id, 0) + 1
    db.add(
        models.CampaignFinanceFilingReport(
            snapshot_id=snapshot.id,
            row_number=_ROW_COUNTER[snapshot.id],
            registration_number=registration,
            filing_year=year,
            report_type=report_type,
            report_name=report_name,
            cut_off_date=cut_off,
            special_election=special_election,
            effective_amendment_index=amendment_index,
            amendment_count=amendment_count,
            filed_date=filed_date,
        )
    )
    db.commit()


def test_the_list_is_newest_period_end_first_and_scoped_to_the_committee(
    client, db
) -> None:
    """Another committee's reports never appear, and no row carries an amount.

    The order is stated rather than implied. No report here has a stored filing date, so
    the order genuinely is the period end and ``ordered_by`` says exactly that rather
    than naming an order the rows are not in.
    """
    snapshot = _filings_snapshot(db, report_count=3)
    _filer(db, snapshot, CANDIDATE)
    _filer(db, snapshot, OTHER_CANDIDATE, name="Novotny, Paul House Committee")
    _report(
        db,
        snapshot,
        CANDIDATE,
        year=2025,
        report_type="YE",
        report_name="2025 Year-End Report",
        cut_off=YEAR_END_2025,
    )
    _report(db, snapshot, CANDIDATE)
    _report(db, snapshot, OTHER_CANDIDATE)

    data = client.get(_filings_url(CANDIDATE)).json()["data"]

    assert data["state"] == REPORTED
    assert data["ordered_by"] == "period_end"
    assert [row["report_name"] for row in data["filings"]] == [
        "2026 Pre-Primary Report",
        "2025 Year-End Report",
    ]
    assert data["page"]["total"] == 2
    for row in data["filings"]:
        assert row["registration_number"] == CANDIDATE
        assert not [key for key in row if "amount" in key or "total" in key]
        # A filing date is served, and on these rows it is null -- the Board states
        # none. What must never appear is an amendment date, which no source gives us.
        assert row["filed_date"] is None
        assert "amendment_date" not in row


def test_a_report_nobody_has_filed_is_excluded_and_counted(client, db) -> None:
    """The catalogue is a schedule: it lists a report when its period opens, filed or not.

    An unfiled report carries no amendment record while every filed one carries at least
    ``['0']`` (§9.6). It is left out of the list — and counted, because for pre-2008 rows
    the missing record means the Board serves no version history rather than "never
    filed", and the page must say the boundary rather than imply the list is complete.
    """
    snapshot = _filings_snapshot(db, report_count=2)
    _filer(db, snapshot, CANDIDATE)
    _report(db, snapshot, CANDIDATE, amendment_index=None, amendment_count=None)
    _report(
        db,
        snapshot,
        CANDIDATE,
        year=2025,
        report_type="YE",
        report_name="2025 Year-End Report",
        cut_off=YEAR_END_2025,
    )

    data = client.get(_filings_url(CANDIDATE)).json()["data"]

    assert [row["report_name"] for row in data["filings"]] == ["2025 Year-End Report"]
    assert data["catalogued_without_record"] == 1


def test_a_final_report_whose_period_has_not_ended_is_listed(client, db) -> None:
    """A terminating committee files its final report at termination, before the period ends.

    Filer 18472's 2026 year-end is a real, filed report read in August 2026 (§9.4's
    sixth filer). On the committee's own page it is the newest thing the committee has
    filed — unlike the landing feed, which is a "what's new" list and holds it back
    until the period ends.
    """
    snapshot = _filings_snapshot(db, report_count=2)
    _filer(db, snapshot, OTHER_CANDIDATE, name="Novotny, Paul House Committee")
    _report(
        db,
        snapshot,
        OTHER_CANDIDATE,
        year=2026,
        report_type="YE",
        report_name="2026 Year-End Report",
        cut_off=date(2026, 12, 31),
    )
    _report(
        db,
        snapshot,
        OTHER_CANDIDATE,
        year=2025,
        report_type="YE",
        report_name="2025 Year-End Report",
        cut_off=YEAR_END_2025,
    )

    data = client.get(_filings_url(OTHER_CANDIDATE)).json()["data"]

    assert [row["report_name"] for row in data["filings"]] == [
        "2026 Year-End Report",
        "2025 Year-End Report",
    ]


def test_a_filed_report_with_no_period_end_is_listed_last_not_dropped(
    client, db
) -> None:
    """A committee's own history must not hide a real filing we cannot place.

    The landing feed drops such a row because a "newest" feed has nowhere to put it;
    here it sorts last and its row carries no period line. (0 such rows in the live
    snapshot — this pins the safe shape, not a live state.)
    """
    snapshot = _filings_snapshot(db, report_count=2)
    _filer(db, snapshot, CANDIDATE)
    _report(
        db,
        snapshot,
        CANDIDATE,
        year=2004,
        report_type="YE",
        report_name="2004 Year-End",
        cut_off=None,
    )
    _report(db, snapshot, CANDIDATE)

    data = client.get(_filings_url(CANDIDATE)).json()["data"]

    assert [row["report_name"] for row in data["filings"]] == [
        "2026 Pre-Primary Report",
        "2004 Year-End",
    ]
    assert data["filings"][1]["period_end"] is None
    assert data["filings"][1]["period_start"] is None


def test_a_period_start_comes_off_the_boards_own_calendar_or_not_at_all(
    client, db
) -> None:
    """§7 forbids hardcoding 1 January, so a start is a transcribed calendar's or absent."""
    snapshot = _filings_snapshot(db, report_count=2)
    _filer(db, snapshot, CANDIDATE)
    _report(db, snapshot, CANDIDATE)
    _report(
        db,
        snapshot,
        CANDIDATE,
        year=2024,
        report_type="YE",
        report_name="2024 Year-End Report",
        # No transcribed calendar prints a start for this end, so the row reads
        # "covers through 31 Dec 2024" rather than an assumed 1 January.
        cut_off=date(2024, 12, 31),
    )

    rows = client.get(_filings_url(CANDIDATE)).json()["data"]["filings"]

    assert rows[0]["period_start"] == PRE_PRIMARY_START.isoformat()
    assert rows[0]["period_start_source"] == "board_calendar"
    assert rows[1]["period_start"] is None
    assert rows[1]["period_start_source"] is None


def test_a_special_election_filers_period_start_is_withheld_not_assumed(
    client, db
) -> None:
    """Filer 19223's 2025 period opens 11 July, not 1 January (§9.5).

    The calendar's printed start is the regular series' start, so the whole filer-year
    is withheld — the regular report's row too, not only the special-election one.
    """
    snapshot = _filings_snapshot(db, report_count=2)
    _filer(db, snapshot, SPECIAL_ELECTION_FILER, name="Johnson Stewart, Ann Committee")
    _report(
        db,
        snapshot,
        SPECIAL_ELECTION_FILER,
        year=2025,
        report_name="Special Election: 2025 Pre-Primary",
        cut_off=date(2025, 7, 10),
        special_election=True,
    )
    _report(
        db,
        snapshot,
        SPECIAL_ELECTION_FILER,
        year=2025,
        report_type="YE",
        report_name="2025 Year-End Report",
        cut_off=YEAR_END_2025,
    )

    rows = client.get(_filings_url(SPECIAL_ELECTION_FILER)).json()["data"]["filings"]

    assert [row["period_start"] for row in rows] == [None, None]


def test_the_amendment_record_is_served_without_any_date(client, db) -> None:
    """The AMENDED marker draws from the version indexes, which is all we hold.

    The catalogue's amendment record is a list of version indexes and nothing more, so
    the row serves ``effective_amendment_index`` and ``amendment_count`` and no date —
    a dated AMENDED chip would be a fabricated fact about a named committee.
    """
    snapshot = _filings_snapshot(db, report_count=1)
    _filer(db, snapshot, CANDIDATE)
    _report(db, snapshot, CANDIDATE, amendment_index=2, amendment_count=3)

    row = client.get(_filings_url(CANDIDATE)).json()["data"]["filings"][0]

    assert row["effective_amendment_index"] == 2
    assert row["amendment_count"] == 3


def test_a_committee_with_no_filed_report_is_reported_empty_not_unavailable(
    client, db
) -> None:
    """Real for some registered filers: every catalogued row lacks an amendment record.

    (Filer 18684 holds 7 catalogued rows and 0 filed ones in the live snapshot.) That is
    a fact about the catalogue, not a fault of ours, so the state is ``reported`` with 0
    rows and the excluded rows are counted.
    """
    snapshot = _filings_snapshot(db, report_count=1)
    _filer(db, snapshot, CANDIDATE)
    _report(db, snapshot, CANDIDATE, amendment_index=None, amendment_count=None)

    data = client.get(_filings_url(CANDIDATE)).json()["data"]

    assert data["state"] == REPORTED
    assert data["filings"] == []
    assert data["page"]["total"] == 0
    assert data["catalogued_without_record"] == 1


def test_no_register_loaded_is_not_a_claim_that_nobody_filed(client, db) -> None:
    data = client.get(_filings_url(CANDIDATE)).json()["data"]

    assert data["state"] == UNAVAILABLE
    assert data["reason"] == NO_FILINGS_SNAPSHOT
    assert data["filings"] == []
    assert data["page"]["total"] is None
    assert data["catalogued_without_record"] is None


def test_a_catalogue_whose_rows_were_replaced_refuses_rather_than_reading_empty(
    client, db
) -> None:
    """A snapshot that published rows and holds none has been replaced under the read."""
    _filings_snapshot(db, report_count=100)

    data = client.get(_filings_url(CANDIDATE)).json()["data"]

    assert data["state"] == UNAVAILABLE
    assert data["reason"] == ROWS_REPLACED


def test_paging_reports_more_without_serving_it(client, db) -> None:
    snapshot = _filings_snapshot(db, report_count=3)
    _filer(db, snapshot, CANDIDATE)
    for year, cut_off in (
        (2026, PRE_PRIMARY_END),
        (2025, YEAR_END_2025),
        (2024, date(2024, 12, 31)),
    ):
        _report(
            db,
            snapshot,
            CANDIDATE,
            year=year,
            report_type="YE",
            report_name=f"{year} Report",
            cut_off=cut_off,
        )

    data = client.get(_filings_url(CANDIDATE), params={"limit": 2}).json()["data"]

    assert len(data["filings"]) == 2
    assert data["page"]["has_more"] is True
    assert data["page"]["total"] == 3

    rest = client.get(_filings_url(CANDIDATE), params={"limit": 2, "offset": 2}).json()[
        "data"
    ]
    assert [row["report_name"] for row in rest["filings"]] == ["2024 Report"]
    assert rest["page"]["has_more"] is False


def test_the_limit_is_capped_so_one_request_cannot_ask_for_the_catalogue(
    client, db
) -> None:
    assert client.get(_filings_url(CANDIDATE), params={"limit": 101}).status_code == 422


def test_a_report_with_no_filed_date_is_never_dated_from_its_period_end(
    client, db
) -> None:
    """The one substitution a reader could not catch, so it is pinned rather than trusted.

    This report covers a period ending 20 Jul 2026 and the Board states no day it was
    received. The honest row serves ``filed_date: null`` and the page prints no filed
    date. The tempting shortcut serves 20 Jul 2026 under a "filed" label, and a reader
    has no way to tell the difference -- it is a plausible date on a real committee's
    real report, which is exactly why
    [#1670](https://github.com/alethical-org/alethical/issues/1670) was filed rather
    than closed with a coalesce.

    So this asserts the absence of the value as well as the null: no field on the row may
    carry the period end other than ``period_end`` itself.
    """
    snapshot = _filings_snapshot(db, report_count=1)
    _filer(db, snapshot, CANDIDATE)
    _report(db, snapshot, CANDIDATE, cut_off=PRE_PRIMARY_END, filed_date=None)

    data = client.get(_filings_url(CANDIDATE)).json()["data"]
    row = data["filings"][0]

    assert row["filed_date"] is None
    assert row["period_end"] == PRE_PRIMARY_END.isoformat()
    dated_like_the_period = [
        key
        for key, value in row.items()
        if key != "period_end" and value == PRE_PRIMARY_END.isoformat()
    ]
    assert dated_like_the_period == []
    # And the order is named for what it is. Nothing here carries a filing date, so
    # claiming a filing order would be a claim about rows that have none.
    assert data["ordered_by"] == "period_end"


def test_the_list_puts_the_report_the_board_received_latest_first(client, db) -> None:
    """Two reports, one period end, and only the received date separates them.

    This is the whole point of #1670 on a committee's own page: a committee amends a
    report weeks after filing it, both versions cover the same period, and ordering by
    the period end alone leaves which one is newer to a tiebreak on the row number. The
    Board's own received dates put them in the order they actually arrived.
    """
    snapshot = _filings_snapshot(db, report_count=2)
    _filer(db, snapshot, CANDIDATE)
    _report(
        db,
        snapshot,
        CANDIDATE,
        report_name="2026 Pre-Primary Report",
        filed_date=date(2026, 7, 24),
    )
    _report(
        db,
        snapshot,
        CANDIDATE,
        report_name="2026 Pre-Primary Report, Amendment 1",
        amendment_index=1,
        amendment_count=2,
        filed_date=date(2026, 8, 10),
    )

    data = client.get(_filings_url(CANDIDATE)).json()["data"]

    assert [row["report_name"] for row in data["filings"]] == [
        "2026 Pre-Primary Report, Amendment 1",
        "2026 Pre-Primary Report",
    ]
    assert [row["filed_date"] for row in data["filings"]] == [
        "2026-08-10",
        "2026-07-24",
    ]
    assert data["ordered_by"] == "filed_date_then_period_end"


def test_an_undated_report_keeps_its_place_by_period_instead_of_sinking(
    client, db
) -> None:
    """A row the Board serves no document for still sits where its period puts it.

    The alternative -- every dated row above every undated one -- would drop a 2026
    report whose document is an unreadable scan below dated reports from 2023, on a page
    whose first row a reader takes for the committee's latest filing. A report is always
    received after its period closes in all but one shape, so the period end is a sound place to
    rank an undated row and using it to *rank* invents nothing. The exception is real and is not an
    invariant to lean on: a terminating committee files its final report at termination, and 7 of the
    3,735 dated reports on production are received before their period ends, every one a terminated
    filer (31 Aug 2026). The served ``filed_date``
    stays null, which is the difference between ranking and claiming.
    """
    snapshot = _filings_snapshot(db, report_count=2)
    _filer(db, snapshot, CANDIDATE)
    _report(
        db,
        snapshot,
        CANDIDATE,
        report_name="2026 Pre-Primary Report",
        cut_off=PRE_PRIMARY_END,
        filed_date=None,
    )
    _report(
        db,
        snapshot,
        CANDIDATE,
        year=2025,
        report_type="YE",
        report_name="2025 Year-End Report",
        cut_off=YEAR_END_2025,
        filed_date=date(2026, 1, 27),
    )

    data = client.get(_filings_url(CANDIDATE)).json()["data"]

    # 20 Jul 2026 as a rank beats 27 Jan 2026, so the undated 2026 report stays on top.
    assert [row["report_name"] for row in data["filings"]] == [
        "2026 Pre-Primary Report",
        "2025 Year-End Report",
    ]
    assert [row["filed_date"] for row in data["filings"]] == [None, "2026-01-27"]
    assert data["ordered_by"] == "filed_date_then_period_end"
