"""What the /money landing's counts and filings feed must never claim.

Every test here stands in for a way these 2 endpoints could put a false sentence on the
landing page. The 4 that matter most:

* **A count we cannot compute is never 0.** "We have loaded no register" and "Minnesota
  registers nobody" are different facts, and one of them is a claim about the state.
* **A report the Board scheduled is not a report anybody filed.** The catalogue lists a
  report from the moment its period opens, so a feed that shows every catalogued row
  prints "filed" under a committee that has not filed.
* **No row carries an amount**, so nothing on this page can be ranked by money -- which
  would rank filing calendars rather than fundraising
  (``docs/architecture/campaign-finance-system-design.md`` §7).
* **A period start is read off a document or omitted.** §7 forbids hardcoding 1 January
  because a special-election filer's period does not open there.

Fixtures are tiny and hand-written. Registration numbers and the counts quoted in
docstrings are from the live data measured on 18 Aug 2026
([#1661](https://github.com/alethical-org/alethical/issues/1661)), evidence for the test
rather than something asserted here.

Needs the local Postgres on port 54329.
"""

from __future__ import annotations

import hashlib
import uuid
from datetime import UTC, date, datetime

import pytest
from sqlalchemy import select, text

from alethical.api.services.campaign_finance_register import (
    NO_FILINGS_SNAPSHOT,
    ROWS_REPLACED,
)
from alethical.api.services.independent_spending import REPORTED, UNAVAILABLE
from alethical.db import models
from alethical.db.session import get_session_factory

Dataset = models.CampaignFinanceDataset
SnapshotStatus = models.CampaignFinanceSnapshotStatus
ReleaseStatus = models.CampaignFinanceReleaseStatus
FilerKind = models.CampaignFinanceFilerKind

SUMMARY = "/api/v1/campaign-finance/summary"
FILINGS = "/api/v1/campaign-finance/filings"

# Real numbers from the live register, so a reader can check any of these rows against
# the Board's own directory.
CANDIDATE = "18466"  # Port, Lindsey Senate Committee.
PARTY_UNIT = "20010"  # HRCC, a legislative caucus.
# The filer whose 2025 period opens 11 July rather than 1 January, because it ran in a
# special election (§9.5). The one case a printed calendar start would be wrong for.
SPECIAL_ELECTION_FILER = "19223"

# Period ends the Board's own 2026 disclosure calendars print, with the starts they print
# beside them. Transcribed in `alethical/pipeline/campaign_finance_filing_calendars.py`.
PRE_PRIMARY_END = date(2026, 7, 20)
PRE_PRIMARY_START = date(2026, 1, 1)
YEAR_END_2025 = date(2025, 12, 31)
YEAR_END_2025_START = date(2025, 1, 1)


def _clear(session) -> None:
    session.rollback()
    session.execute(text("UPDATE cf_filing_current SET snapshot_id = NULL"))
    session.execute(text("DELETE FROM cf_filing_report"))
    session.execute(text("DELETE FROM cf_filer"))
    session.execute(text("DELETE FROM cf_filing_snapshot"))
    session.execute(text("UPDATE cf_current_release SET release_id = NULL"))
    session.execute(text("DELETE FROM cf_release"))
    session.execute(text("DELETE FROM cf_snapshot"))
    session.execute(text("DELETE FROM legislator_campaign_committee"))
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


def _filings_snapshot(
    db, *, fetched: datetime | None = None, filer_count: int = 0, report_count: int = 0
):
    """One published register-and-catalogue run.

    ``filer_count`` and ``report_count`` are what the run recorded at publish time, which
    is what tells a pruned snapshot from one that was legitimately empty: a snapshot that
    published 1,603 filers and holds none has been replaced under the read.
    """
    completed = fetched or datetime(2026, 8, 11, 6, 40, tzinfo=UTC)
    snapshot = models.CampaignFinanceFilingSnapshot(
        fetch_started_at=completed,
        fetch_completed_at=completed,
        status=SnapshotStatus.loaded,
        filer_count=filer_count,
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
):
    """One catalogue row.

    ``amendment_index=None`` is what an unfiled report looks like: the Board serves a null
    amendment list for a report nobody has filed, and every filed report carries at least
    ``['0']`` (§9.6).
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
        )
    )
    db.commit()


def _download_snapshot(db, dataset: Dataset):
    marker = f"{dataset.value}-{uuid.uuid4()}"
    snapshot = models.CampaignFinanceSnapshot(
        dataset=dataset,
        download_id="-2113865252",
        source_url=f"https://cfb.mn.gov/reports/{dataset.value}.csv",
        content_hash=hashlib.sha256(marker.encode()).hexdigest(),
        record_set_hash=hashlib.sha256(f"records-{marker}".encode()).hexdigest(),
        byte_size=1024,
        row_count=0,
        status=SnapshotStatus.loaded,
    )
    db.add(snapshot)
    db.flush()
    return snapshot


def _published_release(db, *, fetched: datetime | None = None):
    """The 3 bulk downloads published together, which carry the page's freshness date."""
    completed = fetched or datetime(2026, 8, 11, 2, 54, tzinfo=UTC)
    release = models.CampaignFinanceRelease(
        contributions_snapshot_id=_download_snapshot(db, Dataset.contributions).id,
        expenditures_snapshot_id=_download_snapshot(db, Dataset.expenditures).id,
        independent_expenditures_snapshot_id=_download_snapshot(
            db, Dataset.independent_expenditures
        ).id,
        status=ReleaseStatus.published,
        fetch_started_at=completed,
        fetch_completed_at=completed,
        published_at=completed,
    )
    db.add(release)
    db.flush()
    db.execute(
        text(
            "INSERT INTO cf_current_release (id, release_id) VALUES (true, :rid) "
            "ON CONFLICT (id) DO UPDATE SET release_id = EXCLUDED.release_id"
        ),
        {"rid": release.id},
    )
    db.commit()
    return release


def _a_sitting_legislator(db):
    """One member the legislator directory would list, from the seeded sample data."""
    session_id = db.scalar(
        select(models.LegislativeSession.id).where(
            models.LegislativeSession.is_current.is_(True)
        )
    )
    return db.scalar(
        select(models.LegislatorServicePeriod.legislator_id)
        .join(
            models.District,
            models.District.id == models.LegislatorServicePeriod.district_id,
        )
        .where(
            models.LegislatorServicePeriod.session_id == session_id,
            models.LegislatorServicePeriod.is_current.is_(True),
            models.District.code.not_like("%-unknown"),
        )
        .limit(1)
    )


def _link(db, legislator_id, registration: str, decision, *, reviewed_at=None):
    row = models.LegislatorCampaignCommittee(
        legislator_id=legislator_id,
        registration_number=registration,
        decision=decision,
        committee_name_as_reviewed="Port, Lindsey Senate Committee",
        reviewed_by="a person",
    )
    db.add(row)
    db.flush()
    if reviewed_at is not None:
        row.reviewed_at = reviewed_at
    db.commit()
    return row


# --- The register count ---------------------------------------------------------


def test_the_register_count_is_counted_live_and_broken_down_by_kind(client, db) -> None:
    """The lane card's number comes from the rows, never from a figure typed into a page.

    A pasted count is how the landing once said 1,336 registered filers on a day the
    register held 1,603 (#1661). The live register holds 778 candidate committees, 299
    party units and 526 committees and funds.
    """
    snapshot = _filings_snapshot(db, filer_count=3)
    _filer(db, snapshot, CANDIDATE)
    _filer(db, snapshot, PARTY_UNIT, kind=FilerKind.party_unit, name="HRCC")
    _filer(db, snapshot, "41360", kind=FilerKind.party_unit, name="Another Party Unit")

    register = client.get(SUMMARY).json()["data"]["register"]

    assert register["state"] == REPORTED
    assert register["filer_count"] == 3
    assert register["by_kind"] == {
        "candidate_committee": 1,
        "party_unit": 2,
        # Present and 0 rather than absent: the register is loaded whole per snapshot, so
        # a kind with no rows is a kind Minnesota registered nobody under, which the
        # committees lane's filters may honestly label.
        "political_committee_or_fund": 0,
    }
    assert register["as_of"] == "2026-08-11"
    assert str(snapshot.id) == register["snapshot_id"]
    assert register["reason"] is None


def test_no_register_loaded_is_null_and_never_a_count_of_zero(client, db) -> None:
    """ "We have loaded no register" is about us; "0 filers" is about Minnesota."""
    register = client.get(SUMMARY).json()["data"]["register"]

    assert register["state"] == UNAVAILABLE
    assert register["filer_count"] is None
    assert register["by_kind"] is None
    assert register["reason"] == NO_FILINGS_SNAPSHOT


def test_a_register_whose_rows_were_replaced_refuses_rather_than_counting_zero(
    client, db
) -> None:
    """A snapshot that published 1,603 filers and holds none has been replaced under us.

    Rows survive exactly one further publish, so this is a real state and not a
    hypothetical. Counting it would report the register as empty on the strength of our
    own pruning.
    """
    _filings_snapshot(db, filer_count=1603)

    register = client.get(SUMMARY).json()["data"]["register"]

    assert register["state"] == UNAVAILABLE
    assert register["filer_count"] is None
    assert register["reason"] == ROWS_REPLACED


# --- The confirmation state ----------------------------------------------------


def test_the_sitting_count_matches_the_directory_the_lane_opens(client, db) -> None:
    """The lane says "N members" and opens the directory, so the 2 must not disagree.

    Both are filtered on the current session's current service periods with the
    placeholder ``-unknown`` districts excluded. The lane counts people once each, which
    is the same number unless a member holds 2 current periods in one session.
    """
    block = client.get(SUMMARY).json()["data"]["legislator_committee_confirmations"]
    directory = client.get("/api/v1/legislators", params={"limit": 1}).json()

    assert block["state"] == REPORTED
    assert block["sitting_member_count"] == directory["page"]["total"]


def test_zero_confirmed_is_served_as_zero_because_the_log_is_ours(client, db) -> None:
    """0 of 200 is a measured fact, not a gap: nobody has confirmed anything yet.

    Production's ``legislator_campaign_committee`` held 0 rows when this was written, and
    that is the state all 200 profiles are in.
    """
    block = client.get(SUMMARY).json()["data"]["legislator_committee_confirmations"]

    assert block["confirmed_member_count"] == 0
    # No date, because there is no confirmation to date it by. A date here would say we
    # looked on that day and found nothing.
    assert block["newest_confirmation_at"] is None


def test_a_confirmed_link_counts_and_dates_the_count(client, db) -> None:
    reviewed = datetime(2026, 8, 18, 15, 30, tzinfo=UTC)
    _link(
        db,
        _a_sitting_legislator(db),
        CANDIDATE,
        models.CommitteeLinkReviewDecision.confirmed,
        reviewed_at=reviewed,
    )

    block = client.get(SUMMARY).json()["data"]["legislator_committee_confirmations"]

    assert block["confirmed_member_count"] == 1
    assert block["newest_confirmation_at"].startswith("2026-08-18T15:30")


def test_a_rejected_link_is_not_progress(client, db) -> None:
    """ "We looked and it is not theirs" is stored, and it is not a confirmed committee.

    Counting rejections would report review activity as answers landed.
    """
    _link(
        db,
        _a_sitting_legislator(db),
        CANDIDATE,
        models.CommitteeLinkReviewDecision.rejected,
    )

    block = client.get(SUMMARY).json()["data"]["legislator_committee_confirmations"]

    assert block["confirmed_member_count"] == 0
    assert block["newest_confirmation_at"] is None


def test_a_confirmed_link_for_someone_not_sitting_is_outside_the_count(
    client, db
) -> None:
    """The count is "of the sitting members", so a former member cannot inflate it."""
    outsider = models.Legislator(
        jurisdiction_id=db.scalar(select(models.Jurisdiction.id)),
        slug=f"a-former-member-{uuid.uuid4().hex[:8]}",
        external_key=f"former-{uuid.uuid4().hex[:8]}",
        full_name="A Former Member",
        sort_name="Member, A Former",
    )
    db.add(outsider)
    db.commit()
    _link(db, outsider.id, CANDIDATE, models.CommitteeLinkReviewDecision.confirmed)

    block = client.get(SUMMARY).json()["data"]["legislator_committee_confirmations"]

    assert block["confirmed_member_count"] == 0


# --- The freshness dates ------------------------------------------------------


def test_each_copy_of_the_data_carries_its_own_date(client, db) -> None:
    """The downloads and the register are 2 runs, so 1 date cannot speak for both.

    They are copied on the same day today, which is exactly why a single date would look
    right and quietly stop being right the first time the 2 runs diverge.
    """
    release = _published_release(db, fetched=datetime(2026, 8, 11, 2, 54, tzinfo=UTC))
    _filings_snapshot(db, fetched=datetime(2026, 8, 11, 6, 40, tzinfo=UTC))

    data = client.get(SUMMARY).json()["data"]["freshness"]

    assert data["downloads_fetched_at"].startswith("2026-08-11T02:54")
    assert data["register_fetched_at"].startswith("2026-08-11T06:40")
    assert data["release_id"] == str(release.id)


def test_the_as_of_date_names_the_day_the_run_finished_in_utc(client, db) -> None:
    """A run that finished just after midnight UTC must not be dated to the day before.

    Postgres hands a stored instant back in the session's own timezone, so an
    unnormalized read of a 02:00 UTC finish is 22:00 on the previous day in US Eastern --
    and this date is printed on the page as "files last copied". The wrong day is the
    failure, not the wrong offset.
    """
    _filings_snapshot(
        db, fetched=datetime(2026, 8, 11, 2, 0, tzinfo=UTC), filer_count=1
    )

    register = client.get(SUMMARY).json()["data"]["register"]

    assert register["as_of"] == "2026-08-11"


def test_a_missing_download_release_does_not_blank_the_register_lane(
    client, db
) -> None:
    """Three lanes come from 3 places, so one gap must not empty the other 2.

    The same per-block rule ``/committees/{registration_number}/finance`` follows: one
    stale download must not blank the blocks that read something else.
    """
    snapshot = _filings_snapshot(db, filer_count=1)
    _filer(db, snapshot, CANDIDATE)

    data = client.get(SUMMARY).json()["data"]

    assert data["freshness"]["downloads_fetched_at"] is None
    assert data["register"]["state"] == REPORTED
    assert data["register"]["filer_count"] == 1


# --- The newest filings feed --------------------------------------------------


def test_the_feed_is_newest_period_end_first_and_carries_no_amount(client, db) -> None:
    """5 rows with 5 dollar figures is a ranking whether anyone sorted it or not.

    So no row has an amount field at all, and the order is stated rather than implied:
    these rows are ordered by the period end we hold, and we hold no filing date
    ([#1670](https://github.com/alethical-org/alethical/issues/1670)).
    """
    snapshot = _filings_snapshot(db, report_count=2)
    _filer(db, snapshot, CANDIDATE)
    _filer(db, snapshot, PARTY_UNIT, kind=FilerKind.party_unit, name="HRCC")
    _report(
        db,
        snapshot,
        PARTY_UNIT,
        year=2025,
        report_name="2025 Year End Report",
        cut_off=YEAR_END_2025,
    )
    _report(db, snapshot, CANDIDATE)

    data = client.get(FILINGS, params={"limit": 5}).json()["data"]

    assert data["state"] == REPORTED
    assert data["ordered_by"] == "period_end"
    assert [row["period_end"] for row in data["filings"]] == [
        "2026-07-20",
        "2025-12-31",
    ]
    assert [row["filer_name"] for row in data["filings"]] == [
        "Port, Lindsey Senate Committee",
        "HRCC",
    ]
    for row in data["filings"]:
        assert not [key for key in row if "amount" in key or "total" in key]


def test_a_report_nobody_has_filed_never_appears_as_a_filing(client, db) -> None:
    """The catalogue is a schedule: it lists a report when its period opens, filed or not.

    7 of the 1,261 catalogued 2026 pre-primary reports were unfiled when the filing
    calendars were measured, and an unfiled one carries no amendment record while every
    filed one carries at least ``['0']`` (§9.6). Showing it would print "filed" under a
    named politician who has not filed.
    """
    snapshot = _filings_snapshot(db, report_count=2)
    _filer(db, snapshot, CANDIDATE)
    _report(db, snapshot, CANDIDATE, amendment_index=None, amendment_count=None)
    _report(
        db,
        snapshot,
        CANDIDATE,
        year=2025,
        report_name="2025 Year End Report",
        cut_off=YEAR_END_2025,
    )

    data = client.get(FILINGS).json()["data"]

    assert [row["report_name"] for row in data["filings"]] == ["2025 Year End Report"]


def test_a_report_with_no_period_end_is_left_out_rather_than_undated(
    client, db
) -> None:
    """Nothing places it in the order and no row can be drawn from it.

    With no filing date either, such a row would carry no date of any kind while sitting
    in a list whose whole promise is recency.
    """
    snapshot = _filings_snapshot(db, report_count=1)
    _filer(db, snapshot, CANDIDATE)
    _report(db, snapshot, CANDIDATE, cut_off=None)

    data = client.get(FILINGS).json()["data"]

    assert data["filings"] == []
    # And it is not reported as a replaced snapshot: the rows are there, they are just
    # not showable.
    assert data["state"] == REPORTED


def test_a_period_start_comes_off_the_boards_own_calendar(client, db) -> None:
    """§7 forbids hardcoding 1 January, so the start is read off a transcribed calendar.

    Both 2026 candidate calendars and both committee calendars print 1/1/2026 through
    7/20/2026 for the pre-primary report, so the start is the Board's own printed value.
    """
    snapshot = _filings_snapshot(db, report_count=1)
    _filer(db, snapshot, CANDIDATE)
    _report(db, snapshot, CANDIDATE)

    row = client.get(FILINGS).json()["data"]["filings"][0]

    assert row["period_start"] == PRE_PRIMARY_START.isoformat()
    assert row["period_end"] == PRE_PRIMARY_END.isoformat()
    assert row["period_start_source"] == "board_calendar"


def test_a_special_election_filers_period_start_is_withheld_not_assumed(
    client, db
) -> None:
    """Filer 19223's 2025 period opens 11 July, not 1 January (§9.5).

    The calendar's printed start is the regular series' start, so applying it to a filer
    with a special-election series that year would print a period the filing does not
    state. The row reads "covers through 31 Dec 2025" instead.
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
        report_name="2025 Year End Report",
        cut_off=YEAR_END_2025,
    )

    rows = {
        row["report_name"]: row for row in client.get(FILINGS).json()["data"]["filings"]
    }

    assert rows["2025 Year End Report"]["period_end"] == YEAR_END_2025.isoformat()
    assert rows["2025 Year End Report"]["period_start"] is None
    assert rows["2025 Year End Report"]["period_start_source"] is None


def test_a_year_with_no_transcribed_calendar_has_no_start(client, db) -> None:
    """Only the 2026 calendars are transcribed, so an older report reads "covers through".

    The alternative is asserting 1 January from the pattern the newer calendars follow,
    which is the assumption §7 exists to stop.
    """
    snapshot = _filings_snapshot(db, report_count=1)
    _filer(db, snapshot, CANDIDATE)
    _report(
        db,
        snapshot,
        CANDIDATE,
        year=2024,
        report_name="2024 Year End Report",
        cut_off=date(2024, 12, 31),
    )

    row = client.get(FILINGS).json()["data"]["filings"][0]

    assert row["period_start"] is None
    assert row["period_start_source"] is None


def test_the_2025_year_end_start_is_the_one_the_calendar_prints(client, db) -> None:
    """All 4 calendars print 1/1/2025 for it, which is the start most likely to be assumed."""
    snapshot = _filings_snapshot(db, report_count=1)
    _filer(db, snapshot, CANDIDATE)
    _report(
        db,
        snapshot,
        CANDIDATE,
        year=2025,
        report_name="2025 Year End Report",
        cut_off=YEAR_END_2025,
    )

    row = client.get(FILINGS).json()["data"]["filings"][0]

    assert row["period_start"] == YEAR_END_2025_START.isoformat()


def test_a_report_whose_filer_is_not_in_the_register_is_dropped(client, db) -> None:
    """The name comes from the register, and a nameless row is not worth showing."""
    snapshot = _filings_snapshot(db, report_count=1)
    _report(db, snapshot, "99999")

    data = client.get(FILINGS).json()["data"]

    assert data["filings"] == []


def test_no_register_loaded_is_not_a_claim_that_nobody_filed(client, db) -> None:
    data = client.get(FILINGS).json()["data"]

    assert data["state"] == UNAVAILABLE
    assert data["filings"] == []
    assert data["reason"] == NO_FILINGS_SNAPSHOT


def test_a_catalogue_whose_rows_were_replaced_refuses_rather_than_reading_empty(
    client, db
) -> None:
    _filings_snapshot(db, report_count=1005)

    data = client.get(FILINGS).json()["data"]

    assert data["state"] == UNAVAILABLE
    assert data["reason"] == ROWS_REPLACED


def test_paging_reports_more_without_counting_the_whole_catalogue(client, db) -> None:
    """``limit + 1`` is fetched, the same shape the payments routes use."""
    snapshot = _filings_snapshot(db, report_count=3)
    _filer(db, snapshot, CANDIDATE)
    for index, cut_off in enumerate(
        (PRE_PRIMARY_END, date(2026, 5, 31), date(2026, 3, 31))
    ):
        _report(db, snapshot, CANDIDATE, report_name=f"Report {index}", cut_off=cut_off)

    first = client.get(FILINGS, params={"limit": 2}).json()["data"]
    second = client.get(FILINGS, params={"limit": 2, "offset": 2}).json()["data"]

    assert len(first["filings"]) == 2
    assert first["page"] == {"limit": 2, "offset": 2 - 2, "has_more": True}
    assert len(second["filings"]) == 1
    assert second["page"]["has_more"] is False


def test_the_limit_is_capped_so_one_request_cannot_ask_for_the_catalogue(
    client, db
) -> None:
    """The live catalogue holds 36,655 rows; the landing draws 5."""
    assert client.get(FILINGS, params={"limit": 500}).status_code == 422
