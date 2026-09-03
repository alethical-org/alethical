"""What the outside-spending record must never claim ([#1945]).

Each test stands in for a way ``/campaign-finance/outside-spending`` could state
something no filing supports while every number on it was right:

* **Absence is never a zero.** A subject with no rows is ``not_reported``; a stale
  release and an uncovered year are ``unavailable``; neither carries a figure.
* **A short total is never served.** One row with a blank amount withholds every
  money figure and keeps every count.
* **Every row is in exactly one direction figure**, and the third figure is whatever
  the first 2 are not, so nothing falls between them.
* **A name whose number resolves nowhere is still printed**, unlinked, and a number
  this release holds as a filer is linkable.
* **A subject we hold nothing about is a 404**, never a committee reported silent.

Needs the local Postgres on port 54329.
"""

from __future__ import annotations

import hashlib
import uuid
from datetime import UTC, date, datetime
from decimal import Decimal

import pytest
from sqlalchemy import select, text

from alethical.api.services.committee_finance import NOT_REPORTED, current_release
from alethical.api.services.independent_spending import (
    DIRECTION_NOT_RECORDED,
    OPPOSING,
    REPORTED,
    SUPPORTING,
    UNAVAILABLE,
)
from alethical.api.services.outside_spending import (
    PAGE_SIZE,
    SORT_LARGEST,
    UnknownSubject,
    outside_spending,
)
from alethical.db import models
from alethical.db.session import get_session_factory

Dataset = models.CampaignFinanceDataset
SnapshotStatus = models.CampaignFinanceSnapshotStatus
ReleaseStatus = models.CampaignFinanceReleaseStatus
FilerKind = models.CampaignFinanceFilerKind
Decision = models.CommitteeLinkReviewDecision

URL = "/api/v1/campaign-finance/outside-spending"

# Real registration numbers from the live release, so a reader can check anything here
# against the Board's own download.
FUND = "30558"  # Education Minn PAC: the file's largest spender, 4,358 rows.
CAUCUS = "20010"  # HRCC, a legislative caucus that also spends independently.
CANDIDATE = "18129"  # Stephenson, Zachary House Committee: 667 rows spent about it.
OTHER_CANDIDATE = "18168"  # Wolgamott, Dan House Committee.
# A committee reachable only as the target of someone else's spending. 283 of these
# carry a negative number the Board assigns internally, because they are local
# candidates the state does not register.
TARGET_ONLY = "-2139633793"

CF_TABLES = (
    "cf_contribution_row",
    "cf_expenditure_row",
    "cf_independent_expenditure_row",
    "cf_fetch_observation",
    "cf_snapshot_body",
)


def _clear(session) -> None:
    session.rollback()
    session.execute(text("UPDATE cf_filing_current SET snapshot_id = NULL"))
    session.execute(text("DELETE FROM cf_filing_report"))
    session.execute(text("DELETE FROM cf_filer"))
    session.execute(text("DELETE FROM cf_filing_snapshot"))
    session.execute(text("UPDATE cf_current_release SET release_id = NULL"))
    session.execute(text("DELETE FROM cf_release"))
    for table in CF_TABLES:
        session.execute(text(f"DELETE FROM {table}"))
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


def _snapshot(db, dataset: Dataset, *, row_count: int = 0):
    marker = f"{dataset.value}-{uuid.uuid4()}"
    snapshot = models.CampaignFinanceSnapshot(
        dataset=dataset,
        download_id="-617535497",
        source_url=f"https://cfb.mn.gov/reports/{dataset.value}.csv",
        content_hash=hashlib.sha256(marker.encode()).hexdigest(),
        record_set_hash=hashlib.sha256(f"records-{marker}".encode()).hexdigest(),
        byte_size=1024,
        row_count=row_count,
        status=SnapshotStatus.loaded,
    )
    db.add(snapshot)
    db.flush()
    return snapshot


class Published:
    """A published release plus the 3 snapshots behind it, for adding rows to."""

    def __init__(self, db, *, published_rows: int = 0):
        self.contributions = _snapshot(db, Dataset.contributions)
        self.expenditures = _snapshot(db, Dataset.expenditures)
        self.independent = _snapshot(
            db, Dataset.independent_expenditures, row_count=published_rows
        )
        release = models.CampaignFinanceRelease(
            contributions_snapshot_id=self.contributions.id,
            expenditures_snapshot_id=self.expenditures.id,
            independent_expenditures_snapshot_id=self.independent.id,
            status=ReleaseStatus.published,
            fetch_started_at=datetime(2026, 8, 12, 2, 52, tzinfo=UTC),
            fetch_completed_at=datetime(2026, 8, 12, 2, 54, tzinfo=UTC),
            published_at=datetime(2026, 8, 12, 2, 56, tzinfo=UTC),
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
        self.release = release
        db.commit()


_ROW_COUNTER: dict[uuid.UUID, int] = {}


def _next_row(snapshot) -> int:
    _ROW_COUNTER[snapshot.id] = _ROW_COUNTER.get(snapshot.id, 0) + 1
    return _ROW_COUNTER[snapshot.id]


def _independent(
    db,
    snapshot,
    *,
    spender_reg=FUND,
    spender="Education Minn PAC",
    about=CANDIDATE,
    about_name="Stephenson, Zachary House Committee",
    direction="For",
    amount="1000",
    unpaid="0",
    year=2025,
    on=None,
    purpose="Advertising - Print: Direct Mail",
    vendor="A Mail House",
    in_kind="No",
) -> int:
    row_number = _next_row(snapshot)
    db.add(
        models.CampaignFinanceIndependentExpenditureRow(
            snapshot_id=snapshot.id,
            row_number=row_number,
            spender=spender,
            spender_reg_num=spender_reg,
            spender_type="PCF",
            affected_committee_name=about_name,
            affected_committee_reg_num=about,
            for_against=direction,
            year=year,
            transaction_date=on if on is not None else date(year, 6, 1),
            type="Independent Expenditure",
            amount=None if amount is None else Decimal(amount),
            unpaid_amount=Decimal(unpaid),
            in_kind=in_kind,
            purpose=purpose,
            vendor_name=vendor,
        )
    )
    db.flush()
    return row_number


def _receipt(db, snapshot, *, reg_num, name):
    """One contribution row, which is what makes a number a filer with a page."""
    db.add(
        models.CampaignFinanceContributionRow(
            snapshot_id=snapshot.id,
            row_number=_next_row(snapshot),
            recipient_reg_num=reg_num,
            recipient=name,
            recipient_type="PCC",
            amount=Decimal("250"),
            receipt_date=date(2025, 6, 1),
            year=2025,
            contributor="A Donor",
            contrib_type="Individual",
            receipt_type="Contribution",
            in_kind="No",
        )
    )
    db.flush()


def _register(db, *, filer_count: int = 0):
    completed = datetime(2026, 8, 12, 21, 34, tzinfo=UTC)
    snapshot = models.CampaignFinanceFilingSnapshot(
        fetch_started_at=completed,
        fetch_completed_at=completed,
        status=SnapshotStatus.loaded,
        filer_count=filer_count,
        report_count=0,
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
    name: str,
    kind: FilerKind = FilerKind.candidate_committee,
    office: str | None = None,
    district: str | None = None,
):
    db.add(
        models.CampaignFinanceFiler(
            snapshot_id=snapshot.id,
            registration_number=registration,
            kind=kind,
            name=name,
            office=office,
            district=district,
            is_incumbent=False,
        )
    )
    db.commit()


def _release(db):
    release = current_release(db)
    assert release is not None
    return release


def _legislator(db):
    return db.scalar(select(models.Legislator).order_by(models.Legislator.full_name))


# --- The whole record --------------------------------------------------------


def test_the_whole_record_is_every_row_with_every_direction_counted(db):
    """No filter is the file as a whole, and the 3 direction figures partition it.

    The third figure is defined as everything the first 2 are not (#1454): a row whose
    direction is a word the Board has not used before lands in it rather than vanishing
    from the count while the total still reads as complete.
    """
    published = Published(db, published_rows=4)
    snap = published.independent
    _independent(db, snap, direction="For", amount="1000")
    _independent(db, snap, direction="against", amount="250", in_kind="Yes")
    _independent(db, snap, direction="Unclear", amount="5", about=OTHER_CANDIDATE)
    _independent(db, snap, direction="For", amount="100", spender_reg=CAUCUS, year=2024)
    db.commit()

    page = outside_spending(db, _release(db))
    assert page.state == REPORTED
    assert page.total_rows == 4
    assert len(page.rows) == 4
    figures = page.figures
    assert figures is not None
    assert figures.row_count == 4
    assert figures.amount_total == Decimal("1355")
    assert figures.supporting_count == 2
    assert figures.supporting_amount == Decimal("1100")
    # "against" in lower case is the Board's word, spelled the Board's way at the
    # database, so a spelling change moves no money into the third figure.
    assert figures.opposing_count == 1
    assert figures.opposing_amount == Decimal("250")
    assert figures.direction_not_recorded_count == 1
    assert figures.direction_not_recorded_amount == Decimal("5")
    assert figures.in_kind_count == 1
    assert (figures.first_year, figures.last_year) == (2024, 2025)
    assert figures.committee_count == 2
    assert figures.spender_count == 2
    directions = sorted(row.direction for row in page.rows)
    assert directions == sorted(
        [SUPPORTING, SUPPORTING, OPPOSING, DIRECTION_NOT_RECORDED]
    )


def test_newest_first_is_the_default_and_largest_first_is_the_other_order(db):
    published = Published(db, published_rows=3)
    snap = published.independent
    _independent(db, snap, amount="10", on=date(2025, 1, 5))
    _independent(db, snap, amount="30", on=date(2025, 3, 5))
    _independent(db, snap, amount="20", on=date(2025, 5, 5))
    db.commit()
    release = _release(db)
    newest = outside_spending(db, release)
    assert [int(row.amount) for row in newest.rows] == [20, 30, 10]
    largest = outside_spending(db, release, sort=SORT_LARGEST)
    assert [int(row.amount) for row in largest.rows] == [30, 20, 10]


def test_pages_hold_50_rows_and_the_total_counts_every_row(db):
    published = Published(db, published_rows=PAGE_SIZE + 2)
    for index in range(PAGE_SIZE + 2):
        _independent(db, published.independent, amount=str(index + 1))
    db.commit()
    release = _release(db)
    first = outside_spending(db, release)
    assert len(first.rows) == PAGE_SIZE
    assert first.has_more is True
    assert first.total_rows == PAGE_SIZE + 2
    second = outside_spending(db, release, page_number=2)
    assert len(second.rows) == 2
    assert second.has_more is False
    assert second.total_rows == PAGE_SIZE + 2
    # A page past the end is still the record's, not silence: the total is kept.
    third = outside_spending(db, release, page_number=3)
    assert third.state == REPORTED
    assert third.rows == ()
    assert third.total_rows == PAGE_SIZE + 2


# --- One subject -------------------------------------------------------------


def test_one_committee_spent_about_reads_only_its_own_rows(db):
    published = Published(db, published_rows=3)
    snap = published.independent
    _independent(db, snap, about=CANDIDATE, amount="100", direction="For")
    _independent(db, snap, about=CANDIDATE, amount="40", direction="Against")
    _independent(db, snap, about=OTHER_CANDIDATE, amount="999")
    db.commit()
    register = _register(db, filer_count=1)
    _filer(
        db,
        register,
        CANDIDATE,
        name="Stephenson, Zachary House Committee",
        office="State Representative",
        district="3B",
    )

    page = outside_spending(db, _release(db), about=CANDIDATE)
    assert page.state == REPORTED
    assert page.total_rows == 2
    assert page.figures is not None
    assert page.figures.amount_total == Decimal("140")
    assert page.figures.supporting_amount == Decimal("100")
    assert page.figures.opposing_amount == Decimal("40")
    assert page.figures.spender_count == 1
    assert page.about is not None
    assert page.about.name == "Stephenson, Zachary House Committee"
    assert page.about.in_register is True
    assert page.about.linkable is True
    assert page.about.office == "State Representative"
    assert page.about.district == "3B"
    assert page.about.confirmed_member is None
    assert page.spender is None


def test_one_spender_reads_the_same_rows_keyed_the_other_way(db):
    published = Published(db, published_rows=3)
    snap = published.independent
    _independent(db, snap, spender_reg=FUND, about=CANDIDATE, amount="100")
    _independent(db, snap, spender_reg=FUND, about=OTHER_CANDIDATE, amount="50")
    _independent(db, snap, spender_reg=CAUCUS, spender="HRCC", amount="7")
    db.commit()

    page = outside_spending(db, _release(db), spender=FUND)
    assert page.total_rows == 2
    assert page.figures is not None
    assert page.figures.amount_total == Decimal("150")
    assert page.figures.committee_count == 2
    assert page.spender is not None
    # No register is held, so the name is the file's own and nothing is in it.
    assert page.spender.name == "Education Minn PAC"
    assert page.spender.in_register is False
    assert page.spender.kind is None


def test_a_confirmed_link_adds_a_person_and_changes_no_figure(db):
    """A confirmation names the register's candidate; the figures stay the committee's."""
    published = Published(db, published_rows=1)
    _independent(db, published.independent, about=CANDIDATE, amount="100")
    db.commit()
    before = outside_spending(db, _release(db), about=CANDIDATE)
    legislator = _legislator(db)
    db.add(
        models.LegislatorCampaignCommittee(
            legislator_id=legislator.id,
            registration_number=CANDIDATE,
            decision=Decision.confirmed,
            committee_name_as_reviewed="Stephenson, Zachary House Committee",
            reviewed_by="test",
        )
    )
    db.commit()
    after = outside_spending(db, _release(db), about=CANDIDATE)
    assert after.about is not None and after.about.confirmed_member is not None
    assert after.about.confirmed_member.slug == legislator.slug
    assert after.about.confirmed_member.full_name == legislator.full_name
    assert after.figures == before.figures
    assert after.rows == before.rows


def test_a_rejected_link_names_nobody(db):
    published = Published(db, published_rows=1)
    _independent(db, published.independent, about=CANDIDATE, amount="100")
    db.commit()
    db.add(
        models.LegislatorCampaignCommittee(
            legislator_id=_legislator(db).id,
            registration_number=CANDIDATE,
            decision=Decision.rejected,
            committee_name_as_reviewed="Stephenson, Zachary House Committee",
            reviewed_by="test",
        )
    )
    db.commit()
    page = outside_spending(db, _release(db), about=CANDIDATE)
    assert page.about is not None
    assert page.about.confirmed_member is None


# --- Names, numbers and links --------------------------------------------------


def test_a_number_is_linkable_only_where_this_release_holds_a_page_for_it(db):
    """A target-only committee is printed as filed and never linked.

    283 committees in the live release appear only as the subject of somebody's
    spending, under a negative number the Board assigns internally. Linking one would
    invent a page; dropping it would shrink the record. A spender that files its own
    contributions is linkable even when the Board's current register no longer lists
    it, because its page exists.
    """
    published = Published(db, published_rows=2)
    snap = published.independent
    _independent(
        db,
        snap,
        spender_reg=FUND,
        about=TARGET_ONLY,
        about_name="Olsen, Tom for Minneapolis Park and Recreation Commissioner",
    )
    _independent(db, snap, spender_reg=FUND, about=CANDIDATE)
    _receipt(db, published.contributions, reg_num=FUND, name="Education Minn PAC")
    db.commit()
    register = _register(db, filer_count=1)
    _filer(db, register, CANDIDATE, name="Stephenson, Zachary House Committee")

    page = outside_spending(db, _release(db))
    by_about = {row.about_committee_registration_number: row for row in page.rows}
    target_only = by_about[TARGET_ONLY]
    assert target_only.about_committee_linkable is False
    assert target_only.about_committee_in_register is False
    assert (
        target_only.about_committee_name
        == "Olsen, Tom for Minneapolis Park and Recreation Commissioner"
    )
    candidate = by_about[CANDIDATE]
    assert candidate.about_committee_linkable is True
    assert candidate.about_committee_in_register is True
    # The spender files its own money and is not in the register we hold.
    assert candidate.spender_linkable is True
    assert candidate.spender_in_register is False
    assert page.figures is not None
    assert page.figures.committees_not_linkable == 1


def test_the_not_linkable_count_is_withheld_when_no_register_is_held(db):
    published = Published(db, published_rows=1)
    _independent(db, published.independent, about=TARGET_ONLY)
    db.commit()
    page = outside_spending(db, _release(db))
    assert page.figures is not None
    assert page.figures.committees_not_linkable is None


def test_a_blank_purpose_or_vendor_is_missing_rather_than_empty_text(db):
    """The page prints its own words for a blank, so the blank must arrive as ``None``."""
    published = Published(db, published_rows=1)
    _independent(db, published.independent, purpose="  ", vendor="", in_kind="Yes")
    db.commit()
    (row,) = outside_spending(db, _release(db)).rows
    assert row.purpose is None
    assert row.vendor_name is None
    assert row.in_kind is True
    assert row.paid_on == date(2025, 6, 1)


# --- Absence is never a zero ------------------------------------------------------


def test_a_registered_committee_with_no_rows_is_not_reported_and_never_a_zero(db):
    published = Published(db, published_rows=1)
    _independent(db, published.independent, about=OTHER_CANDIDATE)
    db.commit()
    register = _register(db, filer_count=1)
    _filer(db, register, CANDIDATE, name="Stephenson, Zachary House Committee")
    page = outside_spending(db, _release(db), about=CANDIDATE)
    assert page.state == NOT_REPORTED
    assert page.rows == ()
    assert page.figures is None
    assert page.total_rows is None
    assert page.about is not None
    assert page.about.name == "Stephenson, Zachary House Committee"


def test_a_number_we_hold_nothing_about_is_refused(db):
    published = Published(db, published_rows=1)
    _independent(db, published.independent, about=OTHER_CANDIDATE)
    db.commit()
    with pytest.raises(UnknownSubject):
        outside_spending(db, _release(db), about="99999999")


def test_a_year_the_download_does_not_reach_is_our_gap(db):
    published = Published(db, published_rows=1)
    _independent(db, published.independent, about=CANDIDATE, year=2025)
    db.commit()
    page = outside_spending(db, _release(db), about=CANDIDATE, year=2031)
    assert page.state == UNAVAILABLE
    assert page.figures is None


def test_a_year_the_download_covers_with_no_rows_for_the_subject_is_silence(db):
    published = Published(db, published_rows=1)
    _independent(db, published.independent, about=OTHER_CANDIDATE, year=2024)
    _independent(db, published.independent, about=CANDIDATE, year=2025)
    db.commit()
    page = outside_spending(db, _release(db), about=CANDIDATE, year=2024)
    assert page.state == NOT_REPORTED


def test_a_release_whose_rows_were_replaced_refuses(db):
    Published(db, published_rows=41_130)
    db.commit()
    page = outside_spending(db, _release(db))
    assert page.state == UNAVAILABLE
    assert page.rows == ()
    assert page.figures is None


def test_one_blank_amount_withholds_every_money_figure_and_keeps_every_count(db):
    """``sum`` skips a blank while ``count(*)`` counts it, so a total would be short."""
    published = Published(db, published_rows=2)
    snap = published.independent
    _independent(db, snap, amount="100")
    _independent(db, snap, amount=None, direction="Against")
    db.commit()
    page = outside_spending(db, _release(db))
    assert page.state == REPORTED
    figures = page.figures
    assert figures is not None
    assert figures.rows_missing_an_amount == 1
    assert figures.row_count == 2
    assert figures.supporting_count == 1
    assert figures.opposing_count == 1
    assert figures.amount_total is None
    assert figures.supporting_amount is None
    assert figures.opposing_amount is None
    assert figures.direction_not_recorded_amount is None
    # The rows themselves still list, each with its own amount or none.
    assert sorted(row.amount is None for row in page.rows) == [False, True]


def test_the_freshness_date_is_utc(db):
    published = Published(db, published_rows=1)
    _independent(db, published.independent)
    db.commit()
    page = outside_spending(db, _release(db))
    assert page.fetched_at is not None
    assert page.fetched_at.utcoffset().total_seconds() == 0
    assert page.fetched_at == datetime(2026, 8, 12, 2, 54, tzinfo=UTC)


# --- Over HTTP -----------------------------------------------------------------


def test_the_route_serves_the_whole_record_with_its_figures(client, db):
    published = Published(db, published_rows=2)
    snap = published.independent
    _independent(
        db, snap, amount="1000.50", unpaid="25", year=2026, on=date(2026, 8, 3)
    )
    _independent(db, snap, amount="20", direction="Against", about=OTHER_CANDIDATE)
    db.commit()
    response = client.get(URL)
    assert response.status_code == 200
    body = response.json()["data"]
    assert body["state"] == REPORTED
    assert body["about"] is None and body["spender"] is None
    assert body["page"] == {
        "number": 1,
        "size": PAGE_SIZE,
        "has_more": False,
        "total_rows": 2,
    }
    assert body["figures"]["amount_total"] == "1020.5000"
    assert body["figures"]["supporting_count"] == 1
    assert body["figures"]["opposing_count"] == 1
    assert body["figures"]["committee_count"] == 2
    assert body["dataset"] == "independent_expenditures"
    assert body["fetched_at"].startswith("2026-08-12T02:54")
    newest = body["rows"][0]
    assert newest["paid_on"] == "2026-08-03"
    assert newest["amount"] == "1000.5000"
    assert newest["unpaid_amount"] == "25.0000"
    assert newest["direction"] == SUPPORTING
    assert newest["direction_as_filed"] == "For"
    assert newest["in_kind"] is False
    assert newest["year"] == 2026
    assert newest["spender_registration_number"] == FUND


def test_the_route_answers_one_subject_with_its_header_facts(client, db):
    published = Published(db, published_rows=1)
    _independent(db, published.independent, about=CANDIDATE, direction="Against")
    db.commit()
    register = _register(db, filer_count=1)
    _filer(
        db,
        register,
        CANDIDATE,
        name="Stephenson, Zachary House Committee",
        office="State Representative",
        district="3B",
    )
    response = client.get(URL, params={"about": CANDIDATE, "sort": "largest"})
    assert response.status_code == 200
    body = response.json()["data"]
    assert body["sort"] == "largest"
    assert body["about"]["registration_number"] == CANDIDATE
    assert body["about"]["kind"] == "candidate_committee"
    assert body["about"]["district"] == "3B"
    assert body["about"]["in_register"] is True
    assert body["about"]["confirmed_member"] is None
    assert body["figures"]["opposing_count"] == 1


def test_the_route_refuses_a_subject_we_hold_nothing_about(client, db):
    Published(db, published_rows=0)
    db.commit()
    assert client.get(URL, params={"spender": "99999999"}).status_code == 404


def test_the_route_refuses_when_no_release_is_published(client, db):
    assert client.get(URL).status_code == 503


def test_the_route_rejects_an_order_it_does_not_serve(client, db):
    Published(db, published_rows=0)
    db.commit()
    assert client.get(URL, params={"sort": "amount"}).status_code == 422
    assert client.get(URL, params={"page": 0}).status_code == 422
