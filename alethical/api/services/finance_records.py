"""Records Finance reads about legislators: committee members and bill authors.

Records only, never money. Each legislator carries whether anyone has confirmed
which campaign committees are theirs and, where confirmed, those committees;
each account's figures come from alethical.com's own
``/legislators/{legislator_id}/campaign-finance`` for the year a reader picks,
1 member at a time, so no figure is ever combined across members
(``.claude/rules/grounded-answers.md`` rules 12 and 13). Reading all of them in
1 request took 15 seconds for a 27-member committee on 28 Oct 2026; 1 account
read here per request keeps this answer quick.
"""

from __future__ import annotations

from collections import defaultdict
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from alethical.api.services.legislative_sessions import current_legislature_scope
from alethical.api.services.legislator_finance import (
    LINK_CONFIRMED,
    LINK_REVIEWED_NONE_CONFIRMED,
    LINK_UNCONFIRMED,
    is_for_a_legislative_office,
)
from alethical.db import models as m


def campaign_accounts(db: Session, legislator_ids: list[UUID]) -> dict[str, dict]:
    """Each legislator's link state and confirmed committees, in 1 query.

    The same facts as ``link_state`` and ``confirmed_committee_links`` in
    ``alethical/api/services/legislator_finance.py``: any confirmed decision is
    ``confirmed``; decisions with none confirmed are ``reviewed_none_confirmed``;
    no decision at all is ``unconfirmed``. An empty list says nothing about the
    person, which is why the state travels with it.
    """
    decisions: dict[str, set] = defaultdict(set)
    confirmed: dict[str, list[dict]] = defaultdict(list)
    if legislator_ids:
        link = m.LegislatorCampaignCommittee
        for legislator_id, decision, number, name, office in db.execute(
            select(
                link.legislator_id,
                link.decision,
                link.registration_number,
                link.committee_name_as_reviewed,
                link.office_as_reviewed,
            )
            .where(link.legislator_id.in_(legislator_ids))
            .order_by(link.committee_name_as_reviewed, link.registration_number)
        ):
            decisions[str(legislator_id)].add(decision)
            if decision == m.CommitteeLinkReviewDecision.confirmed:
                confirmed[str(legislator_id)].append(
                    {
                        "registration_number": number,
                        "committee_name": name,
                        "office": office,
                        # The figures route leaves out a race for another office
                        # (§7 of the campaign-finance design); say so here too.
                        "for_legislative_office": is_for_a_legislative_office(office),
                    }
                )
    result = {}
    for legislator_id in map(str, legislator_ids):
        made = decisions.get(legislator_id, set())
        state = (
            LINK_CONFIRMED
            if m.CommitteeLinkReviewDecision.confirmed in made
            else LINK_REVIEWED_NONE_CONFIRMED
            if made
            else LINK_UNCONFIRMED
        )
        result[legislator_id] = {
            "link_state": state,
            "confirmed": confirmed.get(legislator_id, []),
        }
    return result


def _person(legislator: m.Legislator) -> dict:
    return {
        "id": str(legislator.id),
        "slug": legislator.slug,
        "name": legislator.full_name,
    }


def legislative_committees(db: Session) -> list[dict]:
    """Every committee of the sitting Legislature, A to Z within each chamber."""
    scope = current_legislature_scope(db)
    rows = db.scalars(
        select(m.Committee)
        .where(m.Committee.session_id.in_(scope.ids))
        .options(selectinload(m.Committee.chamber), selectinload(m.Committee.session))
        .order_by(m.Committee.name)
    ).all()
    return sorted(
        (
            {
                "id": str(row.id),
                "name": row.name,
                "chamber": row.chamber.name if row.chamber else None,
                "session": row.session.slug if row.session else None,
            }
            for row in rows
        ),
        key=lambda item: (item["chamber"] or "", item["name"]),
    )


def committee_members(db: Session, committee_id: UUID) -> dict:
    """1 legislative committee and its members, each with their own accounts.

    A committee of the sitting Legislature lists its current members; an older
    committee lists everyone the record names, since none of them is current.
    Raises LookupError when no such committee is held.
    """
    committee = db.scalar(
        select(m.Committee)
        .where(m.Committee.id == committee_id)
        .options(
            selectinload(m.Committee.chamber),
            selectinload(m.Committee.session),
            selectinload(m.Committee.memberships).selectinload(
                m.CommitteeMembership.legislator
            ),
        )
    )
    if committee is None:
        raise LookupError("Not found")
    current = bool(committee.session and committee.session.is_current)
    memberships = [
        membership
        for membership in committee.memberships
        if membership.legislator is not None and (membership.is_current or not current)
    ]
    memberships.sort(key=lambda row: (row.legislator.full_name, row.legislator.slug))
    accounts = campaign_accounts(db, [row.legislator.id for row in memberships])
    return {
        "committee": {
            "id": str(committee.id),
            "name": committee.name,
            "chamber": committee.chamber.name if committee.chamber else None,
            "session": committee.session.slug if committee.session else None,
            "members_are_current": current,
        },
        "members": [
            {
                **_person(row.legislator),
                "role": row.role,
                "campaign_accounts": accounts[str(row.legislator.id)],
            }
            for row in memberships
        ],
    }


def bill_authors(authors: list[dict], db: Session) -> list[dict]:
    """The bill page's own author rows, each with that legislator's accounts."""
    ids = [UUID(row["legislator_id"]) for row in authors if row.get("legislator_id")]
    accounts = campaign_accounts(db, ids)
    return [
        {
            **row,
            "campaign_accounts": accounts.get(row["legislator_id"])
            if row.get("legislator_id")
            else None,
        }
        for row in authors
    ]
