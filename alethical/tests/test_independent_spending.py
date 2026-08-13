"""What a legislator's independent-spending figures must never claim (#1332).

Independent spending is money spent to support or oppose a candidate by groups
that are not the candidate's campaign. Every test here stands in for a way this
surface could state something no filing supports, and each names the failure it
prevents. The three that matter most:

* **Our own missing data is never anyone's zero.** A release whose rows have gone
  says nothing about a named person (`.claude/rules/grounded-answers.md` rule 12).
* **A name is never enough to attribute a payment.** The live release carries
  10 "Fateh, Omar for Minneapolis Mayor" committees in 2025 while sitting Senator
  Omar Fateh's own Senate committee has none, so matching on a name would put a
  city mayoral race on a state senator's profile.
* **Three figures, and between them they hold every row.** Every row in the source
  records "For" or "Against", so the third figure is 0 today and a surface shows it
  only when it is not. It exists because a row nothing can classify has to land
  somewhere visible: guessing a side invents a claim about a person, and dropping it
  leaves a total short while the answer still reads as complete (#1454).

Needs the local Postgres on port 54329.
"""

from __future__ import annotations

import hashlib
import uuid
from datetime import UTC, date, datetime
from decimal import Decimal

import pytest
from sqlalchemy import select, text

from alethical.api.services.independent_spending import (
    LINK_UNCONFIRMED,
    REPORTED,
    UNAVAILABLE,
    independent_spending_for_legislator,
)
from alethical.db import models
from alethical.db.session import get_session_factory

Dataset = models.CampaignFinanceDataset
SnapshotStatus = models.CampaignFinanceSnapshotStatus
ReleaseStatus = models.CampaignFinanceReleaseStatus
Decision = models.CommitteeLinkReviewDecision

SENATE_COMMITTEE = "18488"
# The real registration number of one of the 10 Minneapolis mayoral committees
# that carry Senator Omar Fateh's name in the live 2025 release. Kept verbatim,
# negative sign included, because the sign is what separates a city committee
# from a legislative one in the source.
MAYORAL_COMMITTEE = "-2139639405"

CF_TABLES = (
    "cf_contribution_row",
    "cf_expenditure_row",
    "cf_independent_expenditure_row",
    "cf_fetch_observation",
    "cf_snapshot_body",
)


def _clear(session) -> None:
    session.rollback()
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


@pytest.fixture()
def legislator(db):
    return db.scalar(select(models.Legislator).order_by(models.Legislator.full_name))


def _snapshot(db, dataset: Dataset) -> models.CampaignFinanceSnapshot:
    marker = f"{dataset.value}-{uuid.uuid4()}"
    snapshot = models.CampaignFinanceSnapshot(
        dataset=dataset,
        download_id="-617535497",
        source_url="https://cfb.mn.gov/reports/independent-expenditures.csv",
        content_hash=hashlib.sha256(marker.encode()).hexdigest(),
        record_set_hash=hashlib.sha256(f"records-{marker}".encode()).hexdigest(),
        byte_size=1024,
        status=SnapshotStatus.loaded,
    )
    db.add(snapshot)
    db.flush()
    return snapshot


def _publish(db, *, independent: models.CampaignFinanceSnapshot):
    """A published release whose independent slot is ``independent``."""
    release = models.CampaignFinanceRelease(
        contributions_snapshot_id=_snapshot(db, Dataset.contributions).id,
        expenditures_snapshot_id=_snapshot(db, Dataset.expenditures).id,
        independent_expenditures_snapshot_id=independent.id,
        status=ReleaseStatus.published,
        fetch_started_at=datetime(2026, 8, 12, 2, 52, tzinfo=UTC),
        fetch_completed_at=datetime(2026, 8, 12, 2, 54, tzinfo=UTC),
        published_at=datetime(2026, 8, 12, 2, 56, tzinfo=UTC),
    )
    db.add(release)
    db.flush()
    # The pointer is a single row that exists forever in production, but a freshly
    # migrated test database has none, so insert-or-update rather than update.
    db.execute(
        text(
            "INSERT INTO cf_current_release (id, release_id) VALUES (true, :rid) "
            "ON CONFLICT (id) DO UPDATE SET release_id = EXCLUDED.release_id"
        ),
        {"rid": release.id},
    )
    db.commit()
    return release


def _row(db, snapshot, *, reg_num, direction, amount, year=2025, row_number=None):
    """One published payment. ``amount=None`` is a row the file leaves blank.

    The column is nullable and the loader stores a blank as missing rather than
    inventing a 0, so a test can produce the row the source has not published yet.
    """
    db.add(
        models.CampaignFinanceIndependentExpenditureRow(
            snapshot_id=snapshot.id,
            row_number=row_number
            if row_number is not None
            else _next_row(db, snapshot),
            spender="Some Independent Committee",
            spender_reg_num="41234",
            affected_committee_name="Fateh, Omar Senate Committee",
            affected_committee_reg_num=reg_num,
            for_against=direction,
            year=year,
            transaction_date=date(year, 6, 1),
            amount=None if amount is None else Decimal(amount),
        )
    )
    db.flush()


_ROW_COUNTER = {}


def _next_row(db, snapshot) -> int:
    _ROW_COUNTER[snapshot.id] = _ROW_COUNTER.get(snapshot.id, 0) + 1
    return _ROW_COUNTER[snapshot.id]


def _confirm(db, legislator, reg_num, *, office="State Senator", first=None, last=None):
    db.add(
        models.LegislatorCampaignCommittee(
            legislator_id=legislator.id,
            registration_number=reg_num,
            decision=Decision.confirmed,
            committee_name_as_reviewed="Fateh, Omar Senate Committee",
            office_as_reviewed=office,
            first_year_as_reviewed=first,
            last_year_as_reviewed=last,
            reviewed_by="test",
        )
    )
    db.commit()


def test_no_release_reads_unavailable(db, legislator):
    """No published release is a fact about us, never a figure about a person."""
    result = independent_spending_for_legislator(db, legislator.id, year=2025)
    assert result.state == UNAVAILABLE
    assert result.supporting is None
    assert result.opposing is None


def test_release_without_rows_is_not_a_zero(db, legislator):
    """A release whose rows have gone is stale.

    The loader keeps one spare generation, so an id held across two publishes
    resolves to none. Rendering that as "0" would state that a named person had
    no money spent about them, on the strength of our own pruning.
    """
    _publish(db, independent=_snapshot(db, Dataset.independent_expenditures))
    _confirm(db, legislator, SENATE_COMMITTEE)
    result = independent_spending_for_legislator(db, legislator.id, year=2025)
    assert result.state == UNAVAILABLE
    assert result.supporting is None


def test_unconfirmed_link_reports_no_figure(db, legislator):
    """With no confirmed link, nothing may be attributed to this legislator.

    This is the launch-day case for all 200 sitting members: 0 links are
    confirmed, and the page must say so rather than print a zero.
    """
    snapshot = _snapshot(db, Dataset.independent_expenditures)
    _publish(db, independent=snapshot)
    _row(db, snapshot, reg_num=SENATE_COMMITTEE, direction="For", amount="1000.00")
    db.commit()
    result = independent_spending_for_legislator(db, legislator.id, year=2025)
    assert result.state == LINK_UNCONFIRMED
    assert result.supporting is None
    assert result.committees == ()


def test_confirmed_link_and_no_rows_is_zero(db, legislator):
    """A confirmed committee the file never names spent nothing. That is a real 0.

    The distinction from the test above is the whole of rule 12: this legislator
    has been checked and the source reports no independent spending about them,
    which is a finding rather than a gap.
    """
    snapshot = _snapshot(db, Dataset.independent_expenditures)
    _publish(db, independent=snapshot)
    _row(db, snapshot, reg_num="19999", direction="For", amount="500.00")
    db.commit()
    _confirm(db, legislator, SENATE_COMMITTEE)
    result = independent_spending_for_legislator(db, legislator.id, year=2025)
    assert result.state == REPORTED
    assert result.supporting == Decimal(0)
    assert result.opposing == Decimal(0)
    assert result.payment_count == 0


def test_supporting_and_opposing_stay_apart(db, legislator):
    """Two figures, each its own total, and no third bucket invented."""
    snapshot = _snapshot(db, Dataset.independent_expenditures)
    _publish(db, independent=snapshot)
    _row(db, snapshot, reg_num=SENATE_COMMITTEE, direction="For", amount="1000.50")
    _row(db, snapshot, reg_num=SENATE_COMMITTEE, direction="For", amount="99.50")
    _row(db, snapshot, reg_num=SENATE_COMMITTEE, direction="Against", amount="2500.00")
    db.commit()
    _confirm(db, legislator, SENATE_COMMITTEE)
    result = independent_spending_for_legislator(db, legislator.id, year=2025)
    assert result.state == REPORTED
    assert result.supporting == Decimal("1100.00")
    assert result.opposing == Decimal("2500.00")
    assert result.payment_count == 3


def test_a_blank_direction_joins_neither_side(db, legislator):
    """A row whose direction we cannot read is counted into neither figure.

    No such row exists in the live release, which is exactly why this is pinned:
    if the Board ever starts publishing one, the failure must be a figure that
    omits it, never a figure that silently attributes it to one side.
    """
    snapshot = _snapshot(db, Dataset.independent_expenditures)
    _publish(db, independent=snapshot)
    _row(db, snapshot, reg_num=SENATE_COMMITTEE, direction="For", amount="100.00")
    _row(db, snapshot, reg_num=SENATE_COMMITTEE, direction=None, amount="777.00")
    _row(db, snapshot, reg_num=SENATE_COMMITTEE, direction="Undecided", amount="888.00")
    db.commit()
    _confirm(db, legislator, SENATE_COMMITTEE)
    result = independent_spending_for_legislator(db, legislator.id, year=2025)
    assert result.supporting == Decimal("100.00")
    assert result.opposing == Decimal(0)
    assert result.payment_count == 1


def test_a_year_the_download_does_not_reach_is_not_a_zero(db, legislator):
    """"Nobody spent anything in 2027" is a claim about a year nobody has filed for.

    The files stop at the present and the route accepts years to 2100, so a page
    defaulting to "this year" reaches an uncovered year on 1 January and would print
    a confident 0 with nothing to mark it. The committee route closed this hole in
    #1442; this route still had it.
    """
    snapshot = _snapshot(db, Dataset.independent_expenditures)
    _publish(db, independent=snapshot)
    _row(db, snapshot, reg_num=SENATE_COMMITTEE, direction="For", amount="800.00")
    db.commit()
    _confirm(db, legislator, SENATE_COMMITTEE)
    covered = independent_spending_for_legislator(db, legislator.id, year=2025)
    assert covered.state == REPORTED
    beyond = independent_spending_for_legislator(db, legislator.id, year=2027)
    assert beyond.state == UNAVAILABLE
    assert beyond.supporting is None


def test_a_covered_year_with_no_rows_for_this_member_is_still_a_zero(db, legislator):
    """The distinction the test above turns on, from the other side.

    Somebody else filed in 2025, so the year is covered and this member's empty
    result is a checked finding rather than a gap. Collapsing the two would either
    print a zero over an uncovered year or refuse to print a real one.
    """
    snapshot = _snapshot(db, Dataset.independent_expenditures)
    _publish(db, independent=snapshot)
    _row(db, snapshot, reg_num="19999", direction="For", amount="800.00")
    db.commit()
    _confirm(db, legislator, SENATE_COMMITTEE)
    result = independent_spending_for_legislator(db, legislator.id, year=2025)
    assert result.state == REPORTED
    assert result.supporting == Decimal(0)


def test_a_blank_direction_gets_a_figure_of_its_own(db, legislator):
    """The other half of the test above: neither side, and not gone either (#1454).

    Joining neither side is the right refusal and was the whole fix; leaving the
    money out of the answer entirely was the unfinished half. A page reading only
    the two directional figures was told $100 with nothing to say $1,665 more had
    been spent and could not be classified.
    """
    snapshot = _snapshot(db, Dataset.independent_expenditures)
    _publish(db, independent=snapshot)
    _row(db, snapshot, reg_num=SENATE_COMMITTEE, direction="For", amount="100.00")
    _row(db, snapshot, reg_num=SENATE_COMMITTEE, direction=None, amount="777.00")
    _row(db, snapshot, reg_num=SENATE_COMMITTEE, direction="Undecided", amount="888.00")
    db.commit()
    _confirm(db, legislator, SENATE_COMMITTEE)
    result = independent_spending_for_legislator(db, legislator.id, year=2025)
    assert result.state == REPORTED
    # Both unreadable spellings merge into one figure rather than becoming two.
    assert result.direction_not_recorded == Decimal("1665.00")
    assert result.direction_not_recorded_payments == 2
    (committee,) = result.committees
    assert committee.direction_not_recorded == Decimal("1665.00")
    assert committee.direction_not_recorded_payments == 2


def test_the_three_figures_account_for_every_row(db, legislator):
    """Nothing can fall between the figures, because the third is defined as the rest.

    The failure this closes is not a wrong number, it is a *complete-looking* one:
    the money went missing and the answer still read as whole. So the check is
    arithmetic rather than a spot value -- every payment held is in exactly one
    figure, and the 3 add up to what the file says.
    """
    snapshot = _snapshot(db, Dataset.independent_expenditures)
    _publish(db, independent=snapshot)
    published = {"For": "1000.00", "Against": "250.00", "": "40.00", "Sideways": "5.00"}
    for direction, amount in published.items():
        _row(
            db,
            snapshot,
            reg_num=SENATE_COMMITTEE,
            direction=direction or None,
            amount=amount,
        )
    db.commit()
    _confirm(db, legislator, SENATE_COMMITTEE)
    result = independent_spending_for_legislator(db, legislator.id, year=2025)
    every_figure = (
        result.supporting + result.opposing + result.direction_not_recorded
    )
    assert every_figure == sum(Decimal(a) for a in published.values())
    assert result.payment_count + result.direction_not_recorded_payments == len(published)
    (committee,) = result.committees
    assert committee.last_payment_on == date(2025, 6, 1)


def test_a_blank_amount_is_never_a_verified_zero(db, legislator):
    """A payment with no amount is our gap, not a finding that nothing was spent.

    ``sum`` skips a row whose amount is blank while ``count(*)`` counts it, so
    unguarded this committee reported ``reported``, $0 supporting, over a payment
    the file plainly contains -- the exact sentence rule 12 forbids. 0 of the live
    release's 41,130 rows are like this, and the loader stores a blank as missing
    rather than inventing a value, so the day one is published there would be
    nothing on the page to say so (#1454).
    """
    snapshot = _snapshot(db, Dataset.independent_expenditures)
    _publish(db, independent=snapshot)
    _row(db, snapshot, reg_num=SENATE_COMMITTEE, direction="For", amount=None)
    db.commit()
    _confirm(db, legislator, SENATE_COMMITTEE)
    result = independent_spending_for_legislator(db, legislator.id, year=2025)
    assert result.state == UNAVAILABLE
    assert result.supporting is None
    assert result.payment_count is None


def test_a_blank_amount_withholds_a_total_it_would_understate(db, legislator):
    """One blank beside a real payment withholds the figure instead of shortening it.

    Harder than the test above and the reason the guard is a count rather than a
    "did we get nothing" check: $1,000 is a true sum of the rows we could read and
    a false statement about what was spent, and nothing on the page would mark the
    difference.
    """
    snapshot = _snapshot(db, Dataset.independent_expenditures)
    _publish(db, independent=snapshot)
    _row(db, snapshot, reg_num=SENATE_COMMITTEE, direction="For", amount="1000.00")
    _row(db, snapshot, reg_num=SENATE_COMMITTEE, direction="For", amount=None)
    db.commit()
    _confirm(db, legislator, SENATE_COMMITTEE)
    result = independent_spending_for_legislator(db, legislator.id, year=2025)
    assert result.state == UNAVAILABLE
    assert result.supporting is None


def test_a_blank_amount_in_the_third_figure_withholds_it_too(db, legislator):
    """The new figure is held to the same rule as the two it sits beside.

    A row can be unreadable twice over -- no direction and no amount -- and the
    third figure must not become a place where an untotallable row is quietly
    accepted because it was already set aside once.
    """
    snapshot = _snapshot(db, Dataset.independent_expenditures)
    _publish(db, independent=snapshot)
    _row(db, snapshot, reg_num=SENATE_COMMITTEE, direction="For", amount="600.00")
    _row(db, snapshot, reg_num=SENATE_COMMITTEE, direction=None, amount=None)
    db.commit()
    _confirm(db, legislator, SENATE_COMMITTEE)
    result = independent_spending_for_legislator(db, legislator.id, year=2025)
    assert result.state == UNAVAILABLE
    assert result.direction_not_recorded is None


def test_one_untotallable_committee_withholds_the_whole_figure(db, legislator):
    """A member holding 2 committees gets no figure when either one cannot be totalled.

    The figures a page prints are sums across every confirmed committee, so a
    good committee beside a bad one still produces a page total that is short by
    an unknown amount while reading as complete.
    """
    snapshot = _snapshot(db, Dataset.independent_expenditures)
    _publish(db, independent=snapshot)
    _row(db, snapshot, reg_num="18488", direction="For", amount="300.00")
    _row(db, snapshot, reg_num="19205", direction="Against", amount=None)
    db.commit()
    _confirm(db, legislator, "18488")
    _confirm(db, legislator, "19205")
    result = independent_spending_for_legislator(db, legislator.id, year=2025)
    assert result.state == UNAVAILABLE
    assert result.committees == ()


def test_another_office_never_joins_the_total(db, legislator):
    """The Omar Fateh case, from the live release.

    A sitting senator's name also sits on Minneapolis mayoral committees. Only
    the registration number a person confirmed may contribute, so the mayoral
    money stays off the Senate profile and the year reads as the 0 it is.
    """
    snapshot = _snapshot(db, Dataset.independent_expenditures)
    _publish(db, independent=snapshot)
    _row(db, snapshot, reg_num=MAYORAL_COMMITTEE, direction="For", amount="34623.72")
    _row(
        db, snapshot, reg_num=MAYORAL_COMMITTEE, direction="Against", amount="162841.95"
    )
    # The Senate committee carries money of its own, so the figures below are a
    # real total that excludes the mayoral race, not an empty result that would
    # read the same whether the filter worked or not.
    _row(db, snapshot, reg_num=SENATE_COMMITTEE, direction="For", amount="500.00")
    db.commit()
    _confirm(db, legislator, SENATE_COMMITTEE)
    result = independent_spending_for_legislator(db, legislator.id, year=2025)
    assert result.state == REPORTED
    assert result.supporting == Decimal("500.00")
    assert result.opposing == Decimal(0)


def test_each_committee_keeps_its_own_money(db, legislator):
    """A member with two confirmed committees gets two figures, not two copies of one.

    Minnesota registers a committee per office, so a member can hold several at
    once (§7). Reading one committee's rows under another's name is the same
    class of error as reading another person's, and it hides inside a page total
    that happens to add up.
    """
    snapshot = _snapshot(db, Dataset.independent_expenditures)
    _publish(db, independent=snapshot)
    _row(db, snapshot, reg_num="18488", direction="For", amount="300.00")
    _row(db, snapshot, reg_num="19205", direction="Against", amount="7000.00")
    db.commit()
    _confirm(db, legislator, "18488")
    _confirm(db, legislator, "19205")
    result = independent_spending_for_legislator(db, legislator.id, year=2025)
    by_number = {c.registration_number: c for c in result.committees}
    assert by_number["18488"].supporting == Decimal("300.00")
    assert by_number["18488"].opposing == Decimal(0)
    assert by_number["19205"].supporting == Decimal(0)
    assert by_number["19205"].opposing == Decimal("7000.00")
    assert result.supporting == Decimal("300.00")
    assert result.opposing == Decimal("7000.00")


def test_reviewed_period_bounds_the_year(db, legislator):
    """A committee contributes only to the years the reviewer said it covers.

    Minnesota registers a committee per office, so a member's earlier committee
    must not lend its money to a year it never ran in.
    """
    snapshot = _snapshot(db, Dataset.independent_expenditures)
    _publish(db, independent=snapshot)
    _row(db, snapshot, reg_num=SENATE_COMMITTEE, direction="For", amount="900.00")
    db.commit()
    _confirm(db, legislator, SENATE_COMMITTEE, first="2020", last="2022")
    result = independent_spending_for_legislator(db, legislator.id, year=2025)
    assert result.state == LINK_UNCONFIRMED


def test_each_figure_names_its_committee(db, legislator):
    """A figure says which committee and office it belongs to, not only which year."""
    snapshot = _snapshot(db, Dataset.independent_expenditures)
    _publish(db, independent=snapshot)
    _row(db, snapshot, reg_num=SENATE_COMMITTEE, direction="For", amount="250.00")
    db.commit()
    _confirm(db, legislator, SENATE_COMMITTEE, office="State Senator")
    result = independent_spending_for_legislator(db, legislator.id, year=2025)
    (committee,) = result.committees
    assert committee.registration_number == SENATE_COMMITTEE
    assert committee.office == "State Senator"
    assert committee.supporting == Decimal("250.00")
    assert committee.first_payment_on == date(2025, 6, 1)
    assert result.source_url.startswith("https://")


def test_a_different_year_is_left_out(db, legislator):
    """Each figure covers one calendar year and borrows nothing from another."""
    snapshot = _snapshot(db, Dataset.independent_expenditures)
    _publish(db, independent=snapshot)
    _row(
        db,
        snapshot,
        reg_num=SENATE_COMMITTEE,
        direction="For",
        amount="500.00",
        year=2024,
    )
    # Somebody else's 2025 payment, so 2025 is a year the download covers and this
    # member's empty 2025 is a finding rather than a gap. Added when the year-coverage
    # check landed: without it this fixture is a snapshot holding one year, which the
    # real file never is, and the assertion below would have passed for the wrong
    # reason -- an uncovered year rather than money that stayed in its own year.
    _row(db, snapshot, reg_num="19999", direction="For", amount="1.00", year=2025)
    db.commit()
    _confirm(db, legislator, SENATE_COMMITTEE)
    result = independent_spending_for_legislator(db, legislator.id, year=2025)
    assert result.state == REPORTED
    assert result.supporting == Decimal(0)


def test_a_rejected_link_never_counts(db, legislator):
    """A rejection is stored rather than discarded, and it is not a link."""
    snapshot = _snapshot(db, Dataset.independent_expenditures)
    _publish(db, independent=snapshot)
    _row(db, snapshot, reg_num=SENATE_COMMITTEE, direction="For", amount="400.00")
    db.add(
        models.LegislatorCampaignCommittee(
            legislator_id=legislator.id,
            registration_number=SENATE_COMMITTEE,
            decision=Decision.rejected,
            committee_name_as_reviewed="Fateh, Omar Senate Committee",
            reviewed_by="test",
        )
    )
    db.commit()
    result = independent_spending_for_legislator(db, legislator.id, year=2025)
    assert result.state == LINK_UNCONFIRMED


def test_the_freshness_date_is_utc(db, legislator):
    """The freshness date is normalised to UTC before anyone reads it.

    The driver can return a ``timestamptz`` in the session's own timezone, and
    this instant is the date a page prints beside the money. Left alone, a page
    can name the wrong day for when we last fetched.
    """
    snapshot = _snapshot(db, Dataset.independent_expenditures)
    _publish(db, independent=snapshot)
    _row(db, snapshot, reg_num=SENATE_COMMITTEE, direction="For", amount="10.00")
    db.commit()
    _confirm(db, legislator, SENATE_COMMITTEE)
    result = independent_spending_for_legislator(db, legislator.id, year=2025)
    assert result.fetched_at is not None
    assert result.fetched_at.utcoffset().total_seconds() == 0
    assert result.fetched_at == datetime(2026, 8, 12, 2, 54, tzinfo=UTC)


def test_the_route_serves_the_same_states(client, db, legislator):
    """The endpoint carries ``state`` so a page cannot read a figure it may not."""
    response = client.get(
        f"/api/v1/legislators/{legislator.slug}/independent-spending",
        params={"year": 2025},
    )
    assert response.status_code == 200
    body = response.json()["data"]
    assert body["state"] == UNAVAILABLE
    assert body["supporting"] is None
    assert body["committees"] == []


def test_each_figure_carries_its_own_payment_count(client, db, legislator):
    """The counts are served split, not only combined.

    A page has 3 figures and needs a count under each. Handed only the combined
    number it would print "3 payments" beneath both sides, saying the same payments
    produced each of them. The 3 counts here are deliberately all different, so a
    figure reading the wrong one cannot look right by coincidence.
    """
    snapshot = _snapshot(db, Dataset.independent_expenditures)
    _publish(db, independent=snapshot)
    for amount in ("10.00", "20.00", "30.00"):
        _row(db, snapshot, reg_num=SENATE_COMMITTEE, direction="For", amount=amount)
    for amount in ("40.00", "50.00"):
        _row(db, snapshot, reg_num=SENATE_COMMITTEE, direction="Against", amount=amount)
    _row(db, snapshot, reg_num=SENATE_COMMITTEE, direction="Unclear", amount="60.00")
    db.commit()
    _confirm(db, legislator, SENATE_COMMITTEE)
    response = client.get(
        f"/api/v1/legislators/{legislator.slug}/independent-spending",
        params={"year": 2025},
    )
    body = response.json()["data"]
    assert body["supporting_payments"] == 3
    assert body["opposing_payments"] == 2
    assert body["direction_not_recorded_payments"] == 1
    # The combined count stays the 2 directional figures only, unchanged.
    assert body["payment_count"] == 5


def test_the_route_serves_the_third_figure(client, db, legislator):
    """The count of unclassifiable money reaches the page, not only the service.

    A count the service keeps to itself is the same silent omission with an extra
    step, so the route is pinned separately from the query (#1454).
    """
    snapshot = _snapshot(db, Dataset.independent_expenditures)
    _publish(db, independent=snapshot)
    _row(db, snapshot, reg_num=SENATE_COMMITTEE, direction="For", amount="120.00")
    _row(db, snapshot, reg_num=SENATE_COMMITTEE, direction="Unclear", amount="55.00")
    db.commit()
    _confirm(db, legislator, SENATE_COMMITTEE)
    response = client.get(
        f"/api/v1/legislators/{legislator.slug}/independent-spending",
        params={"year": 2025},
    )
    assert response.status_code == 200
    body = response.json()["data"]
    assert body["state"] == REPORTED
    # Serialized as a string, because the column carries 4 decimal places and JSON
    # numbers would round them. Compared as money rather than as text.
    assert Decimal(body["direction_not_recorded"]) == Decimal("55.00")
    assert body["direction_not_recorded_payments"] == 1
    assert body["payment_count"] == 1
    (committee,) = body["committees"]
    assert Decimal(committee["direction_not_recorded"]) == Decimal("55.00")
    assert committee["direction_not_recorded_payments"] == 1
