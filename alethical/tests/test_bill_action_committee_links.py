"""Bill action links require an exact source ID, session and action chamber."""

# ruff: noqa: F811
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from alethical.db import models as m
from alethical.pipeline.minnesota import MinnesotaIngestionPipeline
from alethical.tests.finance_fixtures import finance_db  # noqa: F401


@pytest.fixture()
def scope(finance_db):
    db = finance_db
    bill = db.scalar(select(m.Bill))
    house = db.scalar(select(m.Chamber).where(m.Chamber.slug == "house"))
    senate = db.scalar(select(m.Chamber).where(m.Chamber.slug == "senate"))
    other_session = db.scalar(
        select(m.LegislativeSession).where(m.LegislativeSession.id != bill.session_id)
    )
    if other_session is None:
        current = db.get(m.LegislativeSession, bill.session_id)
        other_session = m.LegislativeSession(
            jurisdiction_id=current.jurisdiction_id,
            slug="synthetic-action-session",
            session_number=80,
            name="Synthetic action session",
            session_type=m.SessionType.regular,
            year_start=2000,
            year_end=2001,
        )
        db.add(other_session)
        db.flush()
    return bill, house, senate, other_session


def committee(db, session_id, chamber, code, name):
    row = m.Committee(
        session_id=session_id, chamber_id=chamber.id, code=code, name=name
    )
    db.add(row)
    db.flush()
    return row


def write(db, scope, source_id, *, chamber="house", name="Same printed name"):
    bill, house, senate, wrong_session = scope
    refs = {"chambers": {"house": house, "senate": senate}, "session": wrong_session}
    action = {
        "action_number": "987654",
        "action_text": "Referred to",
        "committee_id": source_id,
        "committee_name": name,
    }
    MinnesotaIngestionPipeline(db).replace_actions(
        refs, bill, {"actions": {chamber: [action]}}, SimpleNamespace(id=None)
    )
    db.flush()
    return db.scalar(
        select(m.BillAction).where(
            m.BillAction.bill_id == bill.id,
            m.BillAction.action_number == 987654,
            m.BillAction.chamber_id == refs["chambers"][chamber].id,
        )
    )


def test_future_action_uses_exact_code_in_bill_session_and_action_chamber(
    finance_db, scope
):
    bill, house, senate, other = scope
    wanted = committee(
        finance_db, bill.session_id, house, "94012", "Renamed held committee"
    )
    committee(finance_db, bill.session_id, senate, "94012", "Wrong chamber")
    committee(finance_db, other.id, house, "94012", "Wrong session")
    row = write(finance_db, scope, "94012")
    assert row.committee_id == wanted.id
    assert row.committee_name == "Same printed name"


def test_names_never_create_action_links_and_missing_id_clears_stale_link(
    finance_db, scope
):
    bill, house, _, _ = scope
    wanted = committee(finance_db, bill.session_id, house, "94012", "Same printed name")
    assert write(finance_db, scope, "94012").committee_id == wanted.id
    assert write(finance_db, scope, "").committee_id is None
    assert write(finance_db, scope, "unheld-id").committee_id is None
    assert write(finance_db, scope, "094012").committee_id is None


def test_duplicate_held_codes_are_unresolved_not_arbitrary(finance_db, scope):
    bill, house, _, _ = scope
    committee(finance_db, bill.session_id, house, "94012", "First held name")
    committee(finance_db, bill.session_id, house, "94012", "Second held name")
    assert write(finance_db, scope, "94012").committee_id is None


def test_senate_action_on_house_bill_keeps_its_action_chamber(finance_db, scope):
    bill, house, senate, _ = scope
    committee(finance_db, bill.session_id, house, "94-test", "House committee")
    wanted = committee(
        finance_db, bill.session_id, senate, "94-test", "Senate committee"
    )
    assert (
        write(finance_db, scope, "94-test", chamber="senate").committee_id == wanted.id
    )


def test_read_only_report_requires_exact_source_bytes_and_never_assigns(
    finance_db, scope
):
    from uuid import uuid4

    from alethical.pipeline.minnesota import content_hash, parse_bill_xml
    from alethical.tests.test_minnesota_ingestion import COMMITTEE_BILL_XML
    from scripts.report_bill_action_committee_links import inspect_action

    bill, house, _, _ = scope
    wanted = committee(finance_db, bill.session_id, house, "94012", "Held committee")
    source_bill = SimpleNamespace(
        bill_key=parse_bill_xml(COMMITTEE_BILL_XML)["bill_key"],
        session_id=bill.session_id,
    )
    action = SimpleNamespace(
        id=uuid4(), action_number=1, chamber_id=house.id, committee_id=None
    )
    artifact = SimpleNamespace(
        source_url="https://www.revisor.mn.gov/bills/status_result.php",
        content_hash=content_hash(COMMITTEE_BILL_XML),
    )
    assert (
        inspect_action(finance_db, source_bill, action, house, artifact, None)["state"]
        == "source_body_unavailable"
    )
    assert (
        inspect_action(finance_db, source_bill, action, house, artifact, "changed")[
            "state"
        ]
        == "source_hash_mismatch"
    )
    result = inspect_action(
        finance_db, source_bill, action, house, artifact, COMMITTEE_BILL_XML
    )
    assert result["state"] == "matched"
    assert result["proposed_committee_id"] == str(wanted.id)
    assert action.committee_id is None
    source_bill.bill_key = "different-bill"
    assert (
        inspect_action(
            finance_db, source_bill, action, house, artifact, COMMITTEE_BILL_XML
        )["state"]
        == "source_bill_mismatch"
    )


def test_read_only_report_does_not_treat_storage_marker_as_saved_xml(finance_db, scope):
    from scripts.report_bill_action_committee_links import report

    action = write(finance_db, scope, "")
    result = report(finance_db, bill_key=scope[0].bill_key)
    row = next(row for row in result["rows"] if row["action_id"] == str(action.id))
    assert row["state"] == "missing_artifact"
    assert row["proposed_committee_id"] is None
    assert action.committee_id is None
    with pytest.raises(ValueError, match="between 1 and 100"):
        report(finance_db, limit=101)
