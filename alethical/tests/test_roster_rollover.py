from datetime import date
import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from alethical.db.models import (
    Bill,
    Committee,
    CommitteeMembership,
    CommitteeLinkReviewDecision,
    LegislatorCampaignCommittee,
    LegislatorServicePeriod,
)
from alethical.db.session import get_engine
from alethical.pipeline.minnesota import MinnesotaIngestionPipeline
from alethical.pipeline.roster_rollover import (
    promote_roster_session,
    roster_session_transition,
)
from alethical.pipeline.sessions import session_definition


def setup(db, *, with_bill=True):
    pipeline = MinnesotaIngestionPipeline(db)
    previous = pipeline.seed_reference_data("0942026")
    target = pipeline.seed_reference_data("0952027")
    if with_bill:
        db.add(
            Bill(
                session_id=target["session"].id,
                chamber_id=target["chambers"]["house"].id,
                bill_key=f"test-95-{uuid.uuid4().hex}",
                file_type="HF",
                file_number=99998,
                title="Test official bill",
            )
        )
        db.flush()
    return previous, target


def test_promotion_waits_for_start_and_actual_bills(seed_database):
    with Session(get_engine()) as db:
        setup(db, with_bill=False)
        definition = session_definition("0952027")
        with pytest.raises(ValueError, match="has not started"):
            roster_session_transition(db, definition, today=date(2027, 1, 11))
        with pytest.raises(ValueError, match="accepted official bill"):
            roster_session_transition(db, definition, today=date(2027, 1, 12))
        db.rollback()


def test_promotion_and_failed_transaction_preserve_history_and_reviewed_links(
    seed_database,
):
    with Session(get_engine()) as db:
        previous, target = setup(db)
        old = db.scalar(
            select(LegislatorServicePeriod).where(
                LegislatorServicePeriod.session_id == previous["session"].id,
                LegislatorServicePeriod.is_current.is_(True),
            )
        )
        assert old is not None
        new = LegislatorServicePeriod(
            legislator_id=old.legislator_id,
            session_id=target["session"].id,
            chamber_id=old.chamber_id,
            district_id=old.district_id,
            period_sequence=1,
            is_current=True,
        )
        db.add(new)
        committee = Committee(
            session_id=previous["session"].id,
            chamber_id=old.chamber_id,
            name=f"Test {uuid.uuid4().hex}",
        )
        db.add(committee)
        db.flush()
        membership = CommitteeMembership(
            legislator_id=old.legislator_id,
            committee_id=committee.id,
            is_current=True,
        )
        link = LegislatorCampaignCommittee(
            legislator_id=old.legislator_id,
            registration_number=f"t{uuid.uuid4().hex[:12]}",
            decision=CommitteeLinkReviewDecision.confirmed,
            committee_name_as_reviewed="Reviewed account",
            reviewed_by="Test",
            first_year_as_reviewed="2025",
            last_year_as_reviewed="2026",
        )
        db.add_all([membership, link])
        db.flush()
        with pytest.raises(RuntimeError):
            with db.begin_nested():
                a, b = roster_session_transition(
                    db, session_definition("0952027"), today=date(2027, 1, 12)
                )
                assert promote_roster_session(db, a, b)
                assert not old.is_current and new.is_current
                assert not membership.is_current
                assert b.is_current and not a.is_current
                raise RuntimeError("later validation failed")
        db.expire_all()
        assert previous["session"].is_current and not target["session"].is_current
        assert old.is_current and membership.is_current
        a, b = roster_session_transition(
            db, session_definition("0952027"), today=date(2027, 1, 12)
        )
        assert promote_roster_session(db, a, b)
        assert db.get(LegislatorServicePeriod, old.id) is old
        MinnesotaIngestionPipeline(db).seed_reference_data("0942026")
        assert b.is_current and not a.is_current
        assert link.decision == CommitteeLinkReviewDecision.confirmed
        assert (link.first_year_as_reviewed, link.last_year_as_reviewed) == (
            "2025",
            "2026",
        )
        with pytest.raises(ValueError, match="newer current legislature"):
            roster_session_transition(
                db, session_definition("0942026"), today=date(2027, 1, 12)
            )
        db.rollback()


def test_partial_profile_preserves_held_contacts_and_accepts_corrections(seed_database):
    with Session(get_engine()) as db:
        pipeline = MinnesotaIngestionPipeline(db)
        refs = pipeline.seed_reference_data("0942026")
        period = db.scalar(
            select(LegislatorServicePeriod).where(
                LegislatorServicePeriod.session_id == refs["session"].id,
                LegislatorServicePeriod.is_current.is_(True),
            )
        )
        assert period is not None
        from alethical.db.models import Legislator, Chamber, District

        legislator = db.get(Legislator, period.legislator_id)
        chamber = db.get(Chamber, period.chamber_id)
        district = db.get(District, period.district_id)
        period.phone = "651-555-0100"
        period.photo_url = "https://house.mn.gov/held.jpg"
        pipeline.upsert_service_period(
            refs,
            legislator,
            chamber,
            district,
            {"office_phone": None, "image_url": "", "email": "new@example.test"},
        )
        assert period.phone == "651-555-0100"
        assert period.photo_url == "https://house.mn.gov/held.jpg"
        assert period.email == "new@example.test"
        db.rollback()
