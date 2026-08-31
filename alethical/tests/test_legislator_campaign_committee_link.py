"""Write-path guarantees for the person-checked committee link (#1354).

The one rule this table exists to hold: **a candidate joins an Alethical legislator only
through a link a person has checked** (`docs/architecture/campaign-finance-system-design.md`
§5, Identity). These tests pin the two halves of that which the *database* enforces rather
than the code, because a guarantee in code is only as good as the next caller:

* One committee reaches at most one legislator. Attaching the wrong committee publishes
  someone else's money under a legislator's name, so this is a unique index and not a check
  in the review script.
* A link with no named reviewer cannot be stored at all.

Needs the local Postgres on port 54329.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from alethical.db import models
from alethical.db.session import get_session_factory

CONFIRMED = models.CommitteeLinkReviewDecision.confirmed
REJECTED = models.CommitteeLinkReviewDecision.rejected


@pytest.fixture()
def db(seed_database: None):
    session = get_session_factory()()
    try:
        yield session
    finally:
        session.rollback()
        session.close()


def a_legislator(db) -> models.Legislator:
    jurisdiction_id = db.scalars(select(models.Jurisdiction.id)).first()
    token = uuid.uuid4().hex[:8]
    legislator = models.Legislator(
        jurisdiction_id=jurisdiction_id,
        slug=f"test-member-{token}",
        full_name=f"Test Member {token}",
        sort_name=f"Member {token}, Test",
    )
    db.add(legislator)
    db.flush()
    return legislator


def a_link(legislator, registration, decision=CONFIRMED, reviewer="Eugene Lopin"):
    return models.LegislatorCampaignCommittee(
        legislator_id=legislator.id,
        registration_number=registration,
        decision=decision,
        committee_name_as_reviewed="Testcase, Sample House Committee",
        office_as_reviewed="House",
        first_year_as_reviewed="2022",
        last_year_as_reviewed="2026",
        reviewed_by=reviewer,
        evidence="Checked the Board's registration record for this candidate.",
    )


def test_a_confirmed_committee_cannot_reach_two_legislators(db):
    # The failure this prevents is the worst one this product can make: one person's money
    # published under another person's name. Two sitting legislators share a surname often
    # enough (Patti and Paul Anderson, both in the House) that the guard has to be the
    # database rather than a reviewer's care.
    first, second = a_legislator(db), a_legislator(db)
    db.add(a_link(first, "16807"))
    db.flush()
    db.add(a_link(second, "16807"))
    with pytest.raises(IntegrityError):
        db.flush()


def test_the_same_committee_may_be_rejected_for_several_legislators(db):
    # Ruling a shared surname out is the ordinary case, so a rejection is not exclusive.
    # It is stored rather than discarded so the proposer stops re-suggesting it, and so
    # "checked, not theirs" stays distinguishable from "nobody has looked yet".
    first, second = a_legislator(db), a_legislator(db)
    db.add(a_link(first, "18229", decision=REJECTED))
    db.add(a_link(second, "18229", decision=REJECTED))
    db.flush()
    stored = db.scalars(
        select(models.LegislatorCampaignCommittee).where(
            models.LegislatorCampaignCommittee.registration_number == "18229"
        )
    ).all()
    assert len(stored) == 2
    assert {row.decision for row in stored} == {REJECTED}


def test_one_legislator_may_hold_several_committees(db):
    # Minnesota registers a committee per office, so a person accumulates them: 17 sitting
    # members tie to more than one (§7, Display rules). A legislator whose second committee
    # were refused would show one year of money and silently drop the rest.
    member = a_legislator(db)
    db.add(a_link(member, "18596"))
    db.add(a_link(member, "19263"))
    db.flush()
    stored = db.scalars(
        select(models.LegislatorCampaignCommittee).where(
            models.LegislatorCampaignCommittee.legislator_id == member.id
        )
    ).all()
    assert {row.registration_number for row in stored} == {"18596", "19263"}


def test_the_same_committee_is_recorded_once_per_legislator(db):
    member = a_legislator(db)
    db.add(a_link(member, "18596"))
    db.flush()
    db.add(a_link(member, "18596", decision=REJECTED))
    with pytest.raises(IntegrityError):
        db.flush()


def test_a_link_with_no_named_reviewer_is_refused(db):
    # A link nobody signed is not a checked link, so there is deliberately no default here
    # and the column is NOT NULL.
    member = a_legislator(db)
    db.add(a_link(member, "17674", reviewer=None))
    with pytest.raises(IntegrityError):
        db.flush()


def test_a_confirmed_link_records_the_office_and_period_it_was_reviewed_under(db):
    # §7 (Display rules) requires each link to carry its committee's office and period, so
    # a figure can name which committee it belongs to rather than only which year, and so a
    # race for a different office can be kept off a legislator's profile.
    member = a_legislator(db)
    db.add(a_link(member, "18596"))
    db.flush()
    stored = db.scalars(
        select(models.LegislatorCampaignCommittee).where(
            models.LegislatorCampaignCommittee.legislator_id == member.id
        )
    ).one()
    assert stored.office_as_reviewed == "House"
    assert (stored.first_year_as_reviewed, stored.last_year_as_reviewed) == (
        "2022",
        "2026",
    )
    assert stored.committee_name_as_reviewed == "Testcase, Sample House Committee"
    assert stored.reviewed_at is not None
