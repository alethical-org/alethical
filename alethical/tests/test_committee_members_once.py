"""An officer is 1 committee member, never 2: the plain row and the role are 1 seat.

Member pages list each officer once, under the role. The roster import, which runs
before the committee rebuild, checked only for a plain row before writing one, so it
added a plain row beside every officer's role row: on 3 Nov 2026 159 members in 45
current committees were held twice until the rebuild cleared them, and House Ethics
read 10 members for 6 people. The roster import now leaves a seat that has any row
alone, both stored counts count committees, and every reader lists a member once.
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
from alethical.pipeline.committee_memberships import refresh_committee_stats
from alethical.pipeline.minnesota import MinnesotaIngestionPipeline
from alethical.tests.finance_fixtures import finance_api, finance_db  # noqa: F401
from alethical.tests.test_finance_records import COMMITTEES, _committee, _legislators


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


def test_the_roster_import_adds_no_plain_row_beside_a_role(finance_db):
    committee, session = _committee(finance_db)
    officer, member = _legislators(finance_db, 2)
    finance_db.add(
        m.CommitteeMembership(
            committee_id=committee.id,
            legislator_id=officer.id,
            role="Co-Chair",
            is_current=True,
        )
    )
    finance_db.flush()
    pipeline = MinnesotaIngestionPipeline(finance_db)
    profile = {"committees": [committee.name]}
    for person in (officer, member):
        pipeline.upsert_committees(
            {"session": session}, person, committee.chamber, profile
        )
    finance_db.flush()
    rows = finance_db.execute(
        select(m.CommitteeMembership.legislator_id, m.CommitteeMembership.role).where(
            m.CommitteeMembership.committee_id == committee.id
        )
    ).all()
    assert sorted(rows, key=lambda row: str(row[0])) == sorted(
        [(officer.id, "Co-Chair"), (member.id, None)], key=lambda row: str(row[0])
    )


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


def _stored_count(db, legislator, session):
    db.expire_all()
    return db.scalar(
        select(m.LegislatorStats.committee_count).where(
            m.LegislatorStats.legislator_id == legislator.id,
            m.LegislatorStats.session_id == session.id,
        )
    )


def test_both_stored_committee_counts_count_committees(finance_db):
    committee, session, officer, _ = _seat_twice(finance_db)
    others = finance_db.scalar(
        select(func.count(m.CommitteeMembership.committee_id.distinct())).where(
            m.CommitteeMembership.legislator_id == officer.id,
            m.CommitteeMembership.is_current.is_(True),
            m.CommitteeMembership.committee_id != committee.id,
        )
    )
    refresh_committee_stats(finance_db, session.id)
    finance_db.flush()
    # The 2 rows of 1 seat count as 1 committee.
    assert _stored_count(finance_db, officer, session) == others + 1
    MinnesotaIngestionPipeline(finance_db).refresh_legislator_stats(
        {"session": session}, {officer.id}
    )
    finance_db.flush()
    assert _stored_count(finance_db, officer, session) == others + 1
