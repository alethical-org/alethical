"""An officer is 1 committee member, never 2: the plain listing and the role are 1 seat.

A member page lists an officer's committee twice, once plainly and once under the
role, and both were stored: on 3 Nov 2026, 159 members in 45 current committees
were held twice, and House Ethics read 10 members for 6 people. The parser keeps the
role only, the stored committee count counts committees, and every reader lists a
member once until the next committee refresh rebuilds the stored rows.
"""

# ruff: noqa: F811
from types import SimpleNamespace

from sqlalchemy import func, select

from alethical.api.routers.public import (
    committee_entries,
    current_committee_assignments,
    current_committee_names,
)
from alethical.db import models as m
from alethical.pipeline.committee_memberships import (
    parse_committee_assignments,
    refresh_committee_stats,
)
from alethical.tests.finance_fixtures import finance_api, finance_db  # noqa: F401
from alethical.tests.test_finance_records import COMMITTEES, _committee, _legislators

PROFILE = """
<h4>Committee Assignments:</h4>
<ul>
  <li><a href="/committees/committee_info?comm=1">Ethics</a></li>
  <li><strong>Chair</strong> <a href="/committees/committee_info?comm=1">Ethics</a></li>
  <li><a href="/committees/committee_info?comm=2">Taxes</a></li>
</ul>
"""


def test_the_parser_keeps_the_role_and_drops_the_plain_duplicate():
    found = parse_committee_assignments(
        PROFILE, "https://www.house.mn.gov/members/profile/1", "house"
    )
    assert [(a.name, a.role) for a in found] == [("Ethics", "Chair"), ("Taxes", None)]


def _seat_twice(db):
    committee, session = _committee(db)
    officer, member = _legislators(db, 2)
    for person, role in ((officer, None), (officer, "Chair"), (member, None)):
        db.add(
            m.CommitteeMembership(
                committee_id=committee.id,
                legislator_id=person.id,
                role=role,
                is_current=True,
            )
        )
    db.flush()
    return committee, session, officer, member


def test_finance_lists_each_member_once_with_their_roles(finance_api, finance_db):
    committee, _, officer, member = _seat_twice(finance_db)
    data = finance_api.get(f"{COMMITTEES}/{committee.id}/members").json()["data"]
    rows = {row["id"]: row for row in data["members"]}
    assert len(data["members"]) == 2
    assert (rows[str(officer.id)]["role"], rows[str(officer.id)]["roles"]) == (
        "Chair",
        ["Chair"],
    )
    assert (rows[str(member.id)]["role"], rows[str(member.id)]["roles"]) == (None, [])


def test_alethical_com_readers_list_the_committee_once(finance_db):
    committee, _, officer, _ = _seat_twice(finance_db)
    names = current_committee_names(finance_db, [officer.id])[str(officer.id)]
    assert names.count(committee.name) == 1
    held = current_committee_assignments(finance_db, [officer.id])[str(officer.id)]
    assert [entry for entry in held if entry[0] == committee.name] == [
        (committee.name, "Chair")
    ]
    memberships = finance_db.scalars(
        select(m.CommitteeMembership).where(
            m.CommitteeMembership.legislator_id == officer.id,
            m.CommitteeMembership.committee_id == committee.id,
        )
    ).all()
    assert committee_entries(memberships) == [{"name": committee.name, "role": "Chair"}]


def test_2_different_roles_stay_2_entries():
    ethics = SimpleNamespace(name="Ethics")
    rows = [
        SimpleNamespace(committee=ethics, role=None),
        SimpleNamespace(committee=ethics, role="Chair"),
        SimpleNamespace(committee=ethics, role="Alternate"),
    ]
    assert committee_entries(rows) == [
        {"name": "Ethics", "role": "Chair"},
        {"name": "Ethics", "role": "Alternate"},
    ]


def test_the_stored_committee_count_counts_committees(finance_db):
    committee, session, officer, _ = _seat_twice(finance_db)
    refresh_committee_stats(finance_db, session.id)
    finance_db.flush()
    stats = finance_db.scalar(
        select(m.LegislatorStats).where(
            m.LegislatorStats.legislator_id == officer.id,
            m.LegislatorStats.session_id == session.id,
        )
    )
    held = finance_db.scalar(
        select(func.count(m.CommitteeMembership.committee_id.distinct())).where(
            m.CommitteeMembership.legislator_id == officer.id,
            m.CommitteeMembership.is_current.is_(True),
        )
    )
    assert stats.committee_count == held
