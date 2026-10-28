"""Finance's committee-member and bill-author reads: records, never money."""

# ruff: noqa: F811 -- pytest fixtures arrive as parameters named after the imports

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import select

from alethical.db import models as m
from alethical.tests.finance_fixtures import finance_api, finance_db  # noqa: F401

COMMITTEES = "/api/v1/finance/legislative-committees"


def _link(db, legislator, number, decision, name="Example Committee", office=None):
    db.add(
        m.LegislatorCampaignCommittee(
            legislator_id=legislator.id,
            registration_number=number,
            decision=decision,
            committee_name_as_reviewed=name,
            office_as_reviewed=office,
            reviewed_by="test-reviewer",
            reviewed_at=datetime(2026, 9, 1, tzinfo=UTC),
            **(
                {
                    "withdrawn_at": datetime(2026, 9, 2, tzinfo=UTC),
                    "withdrawal_reason": "Wrong committee",
                    "withdrawn_by": "test-reviewer",
                }
                if decision == m.CommitteeLinkReviewDecision.withdrawn
                else {}
            ),
        )
    )


def _committee(db, *, current=True):
    sitting = db.scalar(
        select(m.LegislativeSession).where(m.LegislativeSession.is_current.is_(True))
    )
    session = sitting
    if not current:
        session = m.LegislativeSession(
            jurisdiction_id=sitting.jurisdiction_id,
            slug=f"test-older-{uuid.uuid4().hex[:6]}",
            session_number=sitting.session_number - 1,
            session_type=sitting.session_type,
            year_start=sitting.year_start - 2,
            year_end=sitting.year_end - 2,
            name="An older Legislature",
            is_current=False,
        )
        db.add(session)
        db.flush()
    chamber = db.scalar(select(m.Chamber))
    committee = m.Committee(
        id=uuid.uuid4(),
        chamber_id=chamber.id,
        session_id=session.id,
        name=f"Example Finance Committee {uuid.uuid4().hex[:6]}",
    )
    db.add(committee)
    db.flush()
    return committee, session


def _legislators(db, count):
    return db.scalars(
        select(m.Legislator).order_by(m.Legislator.slug).limit(count)
    ).all()


def test_each_member_carries_their_own_accounts_and_no_money(finance_api, finance_db):  # noqa: F811
    committee, _ = _committee(finance_db)
    confirmed, reviewed, unreviewed, former = _legislators(finance_db, 4)
    for legislator, is_current in (
        (confirmed, True),
        (reviewed, True),
        (unreviewed, True),
        (former, False),
    ):
        finance_db.add(
            m.CommitteeMembership(
                committee_id=committee.id,
                legislator_id=legislator.id,
                role="Member",
                is_current=is_current,
            )
        )
    _link(finance_db, confirmed, "18001", m.CommitteeLinkReviewDecision.confirmed)
    _link(finance_db, confirmed, "18002", m.CommitteeLinkReviewDecision.rejected)
    _link(finance_db, reviewed, "18003", m.CommitteeLinkReviewDecision.withdrawn)
    finance_db.flush()

    response = finance_api.get(f"{COMMITTEES}/{committee.id}/members")
    assert response.status_code == 200, response.text
    assert "no-store" in response.headers["cache-control"]
    data = response.json()["data"]
    assert data["committee"]["name"] == committee.name
    accounts = {row["id"]: row["campaign_accounts"] for row in data["members"]}
    assert str(former.id) not in accounts
    assert accounts[str(confirmed.id)] == {
        "link_state": "confirmed",
        "confirmed": [
            {
                "registration_number": "18001",
                "committee_name": "Example Committee",
                "office": None,
                "for_legislative_office": True,
            }
        ],
    }
    assert accounts[str(reviewed.id)] == {
        "link_state": "reviewed_none_confirmed",
        "confirmed": [],
    }
    assert accounts[str(unreviewed.id)] == {
        "link_state": "unconfirmed",
        "confirmed": [],
    }
    assert not any(
        key in str(data).lower() for key in ("amount", "total", "contribution")
    )


def test_confirmed_committees_come_a_to_z_and_say_their_office(finance_api, finance_db):
    committee, _ = _committee(finance_db)
    member = _legislators(finance_db, 1)[0]
    finance_db.add(
        m.CommitteeMembership(
            committee_id=committee.id,
            legislator_id=member.id,
            role="Vice Chair",
            is_current=True,
        )
    )
    _link(
        finance_db,
        member,
        "18021",
        m.CommitteeLinkReviewDecision.confirmed,
        "Zeta Committee",
        "House",
    )
    _link(
        finance_db,
        member,
        "18022",
        m.CommitteeLinkReviewDecision.confirmed,
        "Alpha Committee",
        "Governor",
    )
    finance_db.flush()
    [row] = finance_api.get(f"{COMMITTEES}/{committee.id}/members").json()["data"][
        "members"
    ]
    assert row["role"] == "Vice Chair"
    assert [
        (c["committee_name"], c["office"], c["for_legislative_office"])
        for c in row["campaign_accounts"]["confirmed"]
    ] == [
        ("Alpha Committee", "Governor", False),
        ("Zeta Committee", "House", True),
    ]


def test_an_older_committee_lists_everyone_it_names(finance_api, finance_db):  # noqa: F811
    committee, _ = _committee(finance_db, current=False)
    legislator = _legislators(finance_db, 1)[0]
    finance_db.add(
        m.CommitteeMembership(
            committee_id=committee.id, legislator_id=legislator.id, is_current=False
        )
    )
    finance_db.flush()
    data = finance_api.get(f"{COMMITTEES}/{committee.id}/members").json()["data"]
    assert data["committee"]["members_are_current"] is False
    assert [row["id"] for row in data["members"]] == [str(legislator.id)]


def test_the_sitting_legislatures_committees_are_listed(finance_api, finance_db):  # noqa: F811
    sitting, _ = _committee(finance_db)
    older, _ = _committee(finance_db, current=False)
    rows = finance_api.get(COMMITTEES).json()["data"]
    names = [row["name"] for row in rows]
    assert sitting.name in names and older.name not in names
    assert all(row["chamber"] for row in rows)
    assert rows == sorted(rows, key=lambda row: (row["chamber"], row["name"]))


def test_an_unknown_committee_is_not_found(finance_api):  # noqa: F811
    response = finance_api.get(f"{COMMITTEES}/{uuid.uuid4()}/members")
    assert response.status_code == 404


def test_bill_authors_are_the_bill_pages_own_list_with_accounts(
    finance_api,  # noqa: F811
    finance_db,  # noqa: F811
):
    bill = finance_db.scalar(select(m.Bill).where(m.Bill.bill_key == "94-2025-SF1832"))
    author_ids = {s.legislator_id for s in bill.sponsorships}
    co_author = finance_db.scalar(
        select(m.Legislator).where(m.Legislator.id.not_in(author_ids)).limit(1)
    )
    finance_db.add(
        m.Sponsorship(
            bill_id=bill.id,
            legislator_id=co_author.id,
            role=m.SponsorshipRole.co_author,
            source_order=99,
            source_chamber="senate",
        )
    )
    finance_db.flush()
    finance_db.expire(bill)
    page = finance_api.get(
        "/api/v1/bills/94-2025-SF1832", params={"include": "all_sponsors"}
    ).json()["data"]
    first = next(row for row in page["all_sponsors"] if row.get("legislator_id"))
    legislator = finance_db.get(m.Legislator, uuid.UUID(first["legislator_id"]))
    _link(finance_db, legislator, "18010", m.CommitteeLinkReviewDecision.confirmed)
    finance_db.flush()

    data = finance_api.get("/api/v1/finance/bills/94-2025-SF1832/authors").json()[
        "data"
    ]
    assert data["bill"]["id"] == "94-2025-SF1832"
    assert data["bill"]["file_type"] == "SF"
    assert set(data["bill"]) == {"id", "short_title", "file_type", "companion"}
    assert "co_author" in {row["role"] for row in data["authors"]}
    assert [
        {k: v for k, v in row.items() if k != "campaign_accounts"}
        for row in data["authors"]
    ] == page["all_sponsors"]
    by_id = {row["legislator_id"]: row["campaign_accounts"] for row in data["authors"]}
    assert by_id[first["legislator_id"]]["link_state"] == "confirmed"
    assert by_id[first["legislator_id"]]["confirmed"][0]["registration_number"] == (
        "18010"
    )


def test_an_unknown_bill_is_not_found(finance_api):  # noqa: F811
    assert (
        finance_api.get("/api/v1/finance/bills/94-2025-SF999999/authors").status_code
        == 404
    )


def test_these_reads_need_finance_access(client):
    assert client.get(COMMITTEES).status_code == 401
    assert client.get("/api/v1/finance/bills/94-2025-SF1832/authors").status_code == 401
