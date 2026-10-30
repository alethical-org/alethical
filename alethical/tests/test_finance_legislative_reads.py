"""Source-specific legislative reads used by the Finance screens."""

# ruff: noqa: F811
from datetime import UTC, date, datetime
from uuid import uuid4

from sqlalchemy import select, update

from alethical.db import models as m
from alethical.tests.finance_fixtures import finance_api, finance_db  # noqa: F401


def _bill(db):
    return db.scalar(select(m.Bill).where(m.Bill.bill_key == "94-2025-SF1832"))


def _event(db, bill, member, when, value=m.VoteValue.yes):
    event = m.VoteEvent(
        bill_id=bill.id,
        chamber_id=bill.chamber_id,
        motion_text=f"Exact motion {uuid4()}",
        occurred_at=when,
        official_url="https://www.senate.mn/official-vote",
        yes_count=int(value == m.VoteValue.yes),
        no_count=int(value == m.VoteValue.no),
    )
    db.add(event)
    db.flush()
    db.add(
        m.VoteRecord(vote_event_id=event.id, legislator_id=member.id, vote_value=value)
    )
    db.commit()
    return event


def test_roll_call_id_reads_that_exact_event_and_its_bill(finance_api, finance_db):
    bill = _bill(finance_db)
    member = finance_db.scalar(select(m.Legislator))
    first = _event(finance_db, bill, member, datetime(2025, 3, 1, tzinfo=UTC))
    second = _event(
        finance_db, bill, member, datetime(2025, 3, 2, tzinfo=UTC), m.VoteValue.no
    )
    finance_api.headers.pop("Authorization")
    response = finance_api.get(f"/api/v1/votes/{second.id}")
    assert response.status_code == 200
    row = response.json()["data"]
    assert row["id"] == str(second.id) and row["id"] != str(first.id)
    assert row["bill_id"] == bill.bill_key
    assert row["motion_text"] == second.motion_text
    assert row["records"][0]["vote_value"] == "no"
    assert "public" in response.headers["cache-control"]
    assert finance_api.get(f"/api/v1/votes/{uuid4()}").status_code == 404
    assert finance_api.get("/api/v1/votes/not-an-id").status_code == 422


def test_party_comes_from_the_vote_period_not_current_party(finance_api, finance_db):
    bill = _bill(finance_db)
    period = finance_db.scalar(
        select(m.LegislatorServicePeriod).where(
            m.LegislatorServicePeriod.session_id == bill.session_id,
            m.LegislatorServicePeriod.chamber_id == bill.chamber_id,
            m.LegislatorServicePeriod.is_current,
        )
    )
    period.party = "R"
    period.is_current = False
    period.start_date, period.end_date = date(2025, 1, 1), date(2025, 12, 31)
    finance_db.flush()
    finance_db.add(
        m.LegislatorServicePeriod(
            legislator_id=period.legislator_id,
            session_id=period.session_id,
            chamber_id=period.chamber_id,
            district_id=period.district_id,
            period_sequence=100,
            party="DFL",
            is_current=True,
            start_date=date(2026, 1, 1),
            end_date=date(2026, 12, 31),
        )
    )
    first = _event(
        finance_db, bill, period.legislator, datetime(2025, 5, 1, tzinfo=UTC)
    )
    second = _event(
        finance_db, bill, period.legislator, datetime(2026, 5, 1, tzinfo=UTC)
    )
    undated = _event(finance_db, bill, period.legislator, None)
    rows = {
        r["id"]: r
        for r in finance_api.get(f"/api/v1/bills/{bill.bill_key}/votes").json()["data"]
    }
    assert rows[str(first.id)]["records"][0]["party"] == "R"
    assert rows[str(second.id)]["records"][0]["party"] == "DFL"
    assert rows[str(undated.id)]["records"][0]["party"] is None
    finance_db.add(
        m.LegislatorServicePeriod(
            legislator_id=period.legislator_id,
            session_id=period.session_id,
            chamber_id=period.chamber_id,
            district_id=period.district_id,
            period_sequence=101,
            party="Independent",
            is_current=False,
            start_date=date(2025, 1, 1),
            end_date=date(2025, 12, 31),
        )
    )
    finance_db.commit()
    ambiguous = finance_api.get(f"/api/v1/votes/{first.id}").json()["data"]
    assert ambiguous["records"][0]["party"] is None


def test_actions_keep_held_chamber_and_committee_ids(finance_api, finance_db):
    bill = _bill(finance_db)
    committee = m.Committee(
        chamber_id=bill.chamber_id, session_id=bill.session_id, name="Source committee"
    )
    finance_db.add(committee)
    finance_db.flush()
    action = m.BillAction(
        bill_id=bill.id,
        chamber_id=bill.chamber_id,
        committee_id=committee.id,
        action_number=990001,
        action_text="Referred",
        committee_name=committee.name,
    )
    finance_db.add(action)
    finance_db.commit()
    paths = [
        f"/api/v1/bills/{bill.bill_key}?include=actions",
        f"/api/v1/bills/{bill.bill_key}/actions",
    ]
    for path in paths:
        data = finance_api.get(path).json()["data"]
        rows = data["actions"] if isinstance(data, dict) else data
        row = next(r for r in rows if r["action_number"] == action.action_number)
        assert row["chamber"] == "senate"
        assert row["chamber_id"] == str(bill.chamber_id)
        assert row["committee_id"] == str(committee.id)


def test_summary_names_its_exact_saved_version_not_the_current_one(
    finance_api, finance_db
):
    bill = _bill(finance_db)
    finance_db.execute(
        update(m.AIEnrichment)
        .where(m.AIEnrichment.bill_id == bill.id)
        .values(is_current=False)
    )
    old = m.BillVersion(
        bill_id=bill.id,
        version_code="review-old",
        version_name="Earlier engrossment",
        is_current=False,
        html_url="https://www.revisor.mn.gov/earlier",
    )
    finance_db.add(old)
    finance_db.flush()
    summary = m.AIEnrichment(
        bill_id=bill.id,
        bill_version_id=old.id,
        enrichment_type=m.EnrichmentType.bill_summary,
        model_name="local-test",
        content_json={"summary": "Held earlier summary"},
        is_current=True,
    )
    finance_db.add(summary)
    finance_db.commit()
    path = f"/api/v1/bills/{bill.bill_key}?include=ai_analysis"
    source = finance_api.get(path).json()["data"]["summary_source_version"]
    assert source["id"] == str(old.id) and source["version_code"] == "review-old"
    summary.bill_version_id = None
    finance_db.commit()
    assert finance_api.get(path).json()["data"].get("summary_source_version") is None


def test_global_bill_search_counts_all_matches_not_just_returned_rows(finance_api):
    whole = finance_api.get("/api/v1/bills", params={"q": "1832", "limit": 100}).json()
    page = finance_api.get(
        "/api/v1/search", params={"q": "1832", "types": "bills", "limit": 0}
    ).json()["data"]
    assert page["bills"] == []
    assert page["bill_total"] == whole["page"]["total"] > 0
    absent = finance_api.get(
        "/api/v1/search", params={"q": "zzzz-unheld-name", "types": "bills"}
    ).json()["data"]
    assert absent["bill_total"] == 0
