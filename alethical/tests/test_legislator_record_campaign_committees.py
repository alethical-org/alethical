"""The legislator record can carry the committees a person has confirmed as the
member's, so a served profile links each committee's own page (decisions doc §28)."""

from __future__ import annotations

import pytest
from sqlalchemy import delete, select

from alethical.db import models
from alethical.db.session import get_session_factory


@pytest.fixture()
def db(seed_database):
    session = get_session_factory()()
    session.execute(delete(models.LegislatorCampaignCommittee))
    session.commit()
    try:
        yield session
    finally:
        session.execute(delete(models.LegislatorCampaignCommittee))
        session.commit()
        session.close()


def _legislator(db):
    return db.scalar(
        select(models.Legislator).order_by(models.Legislator.slug).limit(1)
    )


def _link(db, legislator, number, name, decision):
    db.add(
        models.LegislatorCampaignCommittee(
            legislator_id=legislator.id,
            registration_number=number,
            decision=decision,
            committee_name_as_reviewed=name,
            reviewed_by="Alethical",
        )
    )
    db.commit()


def test_record_lists_confirmed_committees_only_when_asked_and_only_confirmed_ones(
    client, db
):
    legislator = _legislator(db)
    confirmed = models.CommitteeLinkReviewDecision.confirmed
    _link(db, legislator, "19019", "Zed, Sample House Committee", confirmed)
    _link(db, legislator, "18000", "Able, Sample Senate Committee", confirmed)
    _link(
        db,
        legislator,
        "17000",
        "Rejected, Sample Committee",
        models.CommitteeLinkReviewDecision.rejected,
    )

    plain = client.get(f"/api/v1/legislators/{legislator.slug}").json()["data"]
    assert "campaign_committees" not in plain

    asked = client.get(
        f"/api/v1/legislators/{legislator.slug}?include=current_service,campaign_committees"
    ).json()["data"]
    # A to Z by the name as reviewed; the rejected review names nobody's money.
    assert asked["campaign_committees"] == [
        {
            "registration_number": "18000",
            "committee_name": "Able, Sample Senate Committee",
        },
        {
            "registration_number": "19019",
            "committee_name": "Zed, Sample House Committee",
        },
    ]


def test_record_lists_no_committee_for_the_ordinary_unconfirmed_member(client, db):
    legislator = _legislator(db)
    data = client.get(
        f"/api/v1/legislators/{legislator.slug}?include=campaign_committees"
    ).json()["data"]
    assert data["campaign_committees"] == []
