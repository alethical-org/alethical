"""Taking back a confirmed legislator-committee match, and what that state must do (#1902).

A person at Alethical reads Minnesota's records and confirms that a named campaign account
belongs to a named legislator. Nothing could undo one. These tests pin the state that
undoing now writes, and they are grouped around the 2 things it has to get right:

* **A withdrawn confirmation stops reading as confirmed**, on both pages that carry one --
  the committee page (``confirmed_member_for_committee``) and the legislator profile
  (``link_state``) -- and it does *not* fall back to reading as an account nobody checked,
  because a person did check it and then took it back.
* **A withdrawal cannot exist without its 3 facts**: when, why and who. Pinned against the
  database's own check constraint rather than only against the review tool, because a
  guarantee in code is only as good as the next caller.

Needs the local Postgres on port 54329.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError

from alethical.api.services.legislator_finance import (
    LINK_CONFIRMED,
    LINK_REVIEWED_NONE_CONFIRMED,
    LINK_UNCONFIRMED,
    confirmed_member_for_committee,
    link_state,
)
from alethical.db import models
from alethical.db.session import get_session_factory
from scripts.review_legislator_campaign_committees import (
    WithdrawalRefused,
    withdraw_confirmation,
)

CONFIRMED = models.CommitteeLinkReviewDecision.confirmed
REJECTED = models.CommitteeLinkReviewDecision.rejected
WITHDRAWN = models.CommitteeLinkReviewDecision.withdrawn

REASON = "the Board's register now names a different candidate for this account"
SIGNATURE = "Alethical, LLC"


@pytest.fixture()
def db(seed_database: None):
    session = get_session_factory()()
    session.execute(text("DELETE FROM legislator_campaign_committee"))
    session.commit()
    try:
        yield session
    finally:
        session.rollback()
        session.execute(text("DELETE FROM legislator_campaign_committee"))
        session.commit()
        session.close()


def a_legislator(db) -> models.Legislator:
    jurisdiction_id = db.scalars(select(models.Jurisdiction.id)).first()
    token = uuid.uuid4().hex[:8]
    legislator = models.Legislator(
        jurisdiction_id=jurisdiction_id,
        slug=f"withdrawal-member-{token}",
        full_name=f"Withdrawal Member {token}",
        sort_name=f"Member {token}, Withdrawal",
    )
    db.add(legislator)
    db.flush()
    return legislator


def a_confirmed_link(db, legislator, registration: str, decision=CONFIRMED):
    row = models.LegislatorCampaignCommittee(
        legislator_id=legislator.id,
        registration_number=registration,
        decision=decision,
        committee_name_as_reviewed="Testcase, Sample House Committee",
        office_as_reviewed="House",
        first_year_as_reviewed="2022",
        last_year_as_reviewed="2026",
        reviewed_by=SIGNATURE,
        evidence="The Board registers this account for this member's own seat.",
        name_evidence_as_reviewed="exact",
        filer_directory_as_reviewed="same_seat",
        party_agreement_as_reviewed="agrees",
        records_through_as_reviewed="2026-07-20",
    )
    db.add(row)
    db.commit()
    return row


# --- A withdrawn confirmation stops reading as confirmed --------------------------------


def test_the_committee_page_stops_naming_the_member_after_a_withdrawal(db):
    # The leak this closes. Whose committee it is, read from the committee's side, is a
    # single query on ``decision = 'confirmed'``, so moving the row's own decision is what
    # takes it out -- no reader had to be found and edited for this to hold.
    member = a_legislator(db)
    a_confirmed_link(db, member, "18229")
    before = confirmed_member_for_committee(db, "18229")
    assert before is not None and before.legislator_id == member.id

    withdraw_confirmation(db, "18229", reason=REASON, withdrawn_by=SIGNATURE)

    assert confirmed_member_for_committee(db, "18229") is None


def test_the_profile_says_checked_and_none_confirmed_rather_than_never_checked(db):
    # The other half, and the reason a withdrawal is stored at all rather than the row
    # deleted: "a person checked this and confirmed nothing" and "nobody has ever looked"
    # are different facts, and a deleted row can only say the second one.
    member = a_legislator(db)
    a_confirmed_link(db, member, "18229")
    assert link_state(db, member.id) == LINK_CONFIRMED

    withdraw_confirmation(db, "18229", reason=REASON, withdrawn_by=SIGNATURE)

    assert link_state(db, member.id) == LINK_REVIEWED_NONE_CONFIRMED
    assert link_state(db, member.id) != LINK_UNCONFIRMED


def test_the_withdrawals_three_facts_and_the_confirmations_own_record_both_survive(db):
    # Read back through a second session, so what is asserted is what Postgres holds rather
    # than what the objects in this one remember.
    member = a_legislator(db)
    a_confirmed_link(db, member, "18229")
    withdraw_confirmation(db, "18229", reason=REASON, withdrawn_by=SIGNATURE)

    other = get_session_factory()()
    try:
        stored = other.scalars(
            select(models.LegislatorCampaignCommittee).where(
                models.LegislatorCampaignCommittee.registration_number == "18229"
            )
        ).one()
        # The 3 facts a page would need to say anything honest about the withdrawal.
        assert stored.decision is WITHDRAWN
        assert stored.withdrawn_at is not None
        assert stored.withdrawal_reason == REASON
        assert stored.withdrawn_by == SIGNATURE
        # And nothing the confirmation itself recorded is disturbed, which is what makes
        # this a withdrawal rather than a deletion.
        assert stored.reviewed_by == SIGNATURE
        assert stored.reviewed_at is not None
        assert stored.committee_name_as_reviewed == "Testcase, Sample House Committee"
        assert stored.evidence is not None
        assert stored.filer_directory_as_reviewed == "same_seat"
        assert stored.records_through_as_reviewed == "2026-07-20"
    finally:
        other.close()


# --- A withdrawal cannot exist without its 3 facts -------------------------------------


@pytest.mark.parametrize(
    "missing",
    ["withdrawn_at", "withdrawal_reason", "withdrawn_by"],
    ids=["no date", "no reason", "no signature"],
)
def test_the_database_refuses_a_withdrawal_missing_any_of_the_three_facts(db, missing):
    # Pinned against Postgres, not against the tool: a withdrawal nobody explained is the
    # state #1902 exists to prevent, and the next caller may not be the review script.
    member = a_legislator(db)
    row = a_confirmed_link(db, member, "18229")
    facts = {
        "withdrawn_at": text("now()"),
        "withdrawal_reason": REASON,
        "withdrawn_by": SIGNATURE,
    }
    facts.pop(missing)
    row.decision = WITHDRAWN
    for name, value in facts.items():
        setattr(row, name, value)
    with pytest.raises(IntegrityError):
        db.flush()


@pytest.mark.parametrize("blank", ["", "   ", "\t\n"])
def test_the_database_refuses_a_blank_reason_as_well_as_a_missing_one(db, blank):
    # Whitespace is the shape a required field takes when somebody wanted to skip it.
    member = a_legislator(db)
    row = a_confirmed_link(db, member, "18229")
    row.decision = WITHDRAWN
    row.withdrawn_at = text("now()")
    row.withdrawal_reason = blank
    row.withdrawn_by = SIGNATURE
    with pytest.raises(IntegrityError):
        db.flush()


def test_the_review_tool_refuses_to_invent_a_reason_and_writes_nothing(db):
    member = a_legislator(db)
    a_confirmed_link(db, member, "18229")
    with pytest.raises(WithdrawalRefused):
        withdraw_confirmation(db, "18229", reason="   ", withdrawn_by=SIGNATURE)
    still = confirmed_member_for_committee(db, "18229")
    assert still is not None and still.legislator_id == member.id


def test_the_review_tool_refuses_an_unsigned_withdrawal(db):
    member = a_legislator(db)
    a_confirmed_link(db, member, "18229")
    with pytest.raises(WithdrawalRefused):
        withdraw_confirmation(db, "18229", reason=REASON, withdrawn_by="  ")
    assert confirmed_member_for_committee(db, "18229") is not None


def test_only_a_confirmed_link_can_be_taken_back(db):
    # A number nobody confirmed has nothing to take back, and undoing a rejection is a
    # separate question with no unique index against it (#1902, out of scope).
    member = a_legislator(db)
    a_confirmed_link(db, member, "18229", decision=REJECTED)
    with pytest.raises(WithdrawalRefused):
        withdraw_confirmation(db, "18229", reason=REASON, withdrawn_by=SIGNATURE)
    with pytest.raises(WithdrawalRefused):
        withdraw_confirmation(db, "99999", reason=REASON, withdrawn_by=SIGNATURE)


# --- The unique index, both directions -------------------------------------------------


def test_two_live_confirmations_of_one_number_are_still_blocked(db):
    # Unchanged by this work and re-pinned because this work moves the value that index
    # reads. One person's money published under another person's name is the worst error
    # this product can make.
    first, second = a_legislator(db), a_legislator(db)
    a_confirmed_link(db, first, "18229")
    db.add(
        models.LegislatorCampaignCommittee(
            legislator_id=second.id,
            registration_number="18229",
            decision=CONFIRMED,
            committee_name_as_reviewed="Testcase, Sample House Committee",
            reviewed_by=SIGNATURE,
        )
    )
    with pytest.raises(IntegrityError):
        db.flush()


def test_a_withdrawn_number_can_be_confirmed_to_a_different_legislator(db):
    # The correction the January 2027 roster turn actually produces: an account confirmed
    # to the wrong person. Without this the withdrawal would be unusable, because the
    # partial unique index would still hold the number against the first legislator.
    wrong, right = a_legislator(db), a_legislator(db)
    a_confirmed_link(db, wrong, "18229")
    withdraw_confirmation(db, "18229", reason=REASON, withdrawn_by=SIGNATURE)

    a_confirmed_link(db, right, "18229")

    now = confirmed_member_for_committee(db, "18229")
    assert now is not None and now.legislator_id == right.id
    assert link_state(db, wrong.id) == LINK_REVIEWED_NONE_CONFIRMED
