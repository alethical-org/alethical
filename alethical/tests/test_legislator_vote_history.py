"""Profile history keeps the member, source and motion through paging."""

# ruff: noqa: F811
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from sqlalchemy import delete, select

from alethical.db import models as m
from alethical.tests.finance_fixtures import finance_api, finance_db  # noqa: F401
from alethical.tests.test_finance_legislative_reads import _bill, _event


def get_history(client, path, *, params=None):
    return client.get(path, params={"history": "true", **(params or {})})


@pytest.fixture()
def member_votes(finance_db):
    member = finance_db.scalar(select(m.Legislator))
    finance_db.execute(
        delete(m.VoteRecord).where(m.VoteRecord.legislator_id == member.id)
    )
    bill = _bill(finance_db)
    first = _event(finance_db, bill, member, datetime(2025, 3, 1, tzinfo=UTC))
    second = _event(
        finance_db, bill, member, datetime(2025, 3, 2, tzinfo=UTC), m.VoteValue.no
    )
    second.result_text = "Motion failed"
    second.chamber_id = finance_db.scalar(
        select(m.Chamber.id).where(m.Chamber.slug == "house")
    )
    undated = _event(finance_db, bill, member, None, m.VoteValue.excused)
    return member, [second, first, undated]


def test_complete_history_pages_with_motion_source_and_exact_values(
    finance_api, member_votes
):
    member, events = member_votes
    path = f"/api/v1/legislators/{member.slug}/votes"
    response = get_history(finance_api, path, params={"limit": 2})
    assert response.status_code == 200
    assert "no-store" in response.headers["cache-control"]
    first = response.json()
    assert first["page"]["total"] == 3
    assert first["page"]["has_more"]
    assert [r["vote_event_id"] for r in first["data"]] == [
        str(e.id) for e in events[:2]
    ]
    assert [r["vote_value"] for r in first["data"]] == ["no", "yes"]
    assert first["data"][0]["motion_text"] == events[0].motion_text
    assert first["data"][0]["official_url"] == events[0].official_url
    assert first["data"][0]["bill_id"] == "94-2025-SF1832"
    assert first["data"][0]["file_type"] == "SF"
    assert first["data"][0]["file_number"] == 1832
    assert first["data"][0]["chamber"] == "house"
    assert first["data"][0]["result_text"] == "Motion failed"
    assert first["data"][0]["session_name"]
    assert first["data"][0]["session"]
    last = get_history(
        finance_api,
        path,
        params={"limit": 2, "offset": 2, "version": first["page"]["version"]},
    ).json()
    assert not last["page"]["has_more"]
    assert last["data"][0]["vote_value"] == "excused"
    assert last["data"][0]["occurred_at"] is None
    by_id = get_history(
        finance_api, f"/api/v1/legislators/{member.id}/votes", params={"limit": 2}
    ).json()
    assert by_id == first


def test_changed_source_refuses_continuing_old_page(
    finance_api, finance_db, member_votes
):
    member, events = member_votes
    path = f"/api/v1/legislators/{member.id}/votes"
    before = get_history(finance_api, path, params={"limit": 1}).json()
    events[1].official_url = "https://www.senate.mn/corrected-official-vote"
    finance_db.commit()
    response = get_history(
        finance_api, path, params={"version": before["page"]["version"], "offset": 1}
    )
    assert response.status_code == 409
    assert (
        get_history(finance_api, path).json()["page"]["version"]
        != before["page"]["version"]
    )


def test_missing_sources_stay_missing_and_other_members_stay_separate(
    finance_api, finance_db, member_votes
):
    member, events = member_votes
    events[0].motion_text = None
    events[0].official_url = None
    other = finance_db.scalar(select(m.Legislator).where(m.Legislator.id != member.id))
    _event(finance_db, _bill(finance_db), other, datetime(2026, 1, 1, tzinfo=UTC))
    path = f"/api/v1/legislators/{member.id}/votes"
    data = get_history(finance_api, path).json()
    assert data["page"]["total"] == 3
    assert data["data"][0]["motion_text"] is None
    assert data["data"][0]["official_url"] is None
    session = data["data"][0]["session"]
    scoped = get_history(finance_api, path, params={"session": session}).json()
    assert scoped["data"] == data["data"]
    assert scoped["page"]["version"] != data["page"]["version"]
    assert (
        get_history(
            finance_api, path, params={"session": "unknown-session"}
        ).status_code
        == 404
    )


def test_access_and_invalid_inputs(finance_api, member_votes):
    member, _ = member_votes
    path = f"/api/v1/legislators/{member.id}/votes"
    for params in ({"limit": 0}, {"limit": 101}, {"offset": -1}, {"version": "bad"}):
        assert get_history(finance_api, path, params=params).status_code == 422
    assert (
        get_history(finance_api, f"/api/v1/legislators/{uuid4()}/votes").status_code
        == 404
    )
    finance_api.headers.pop("Authorization")
    assert get_history(finance_api, path).status_code == 200


def test_sessions_tied_dates_and_empty_history(finance_api, finance_db, member_votes):
    member, events = member_votes
    current_bill = _bill(finance_db)
    current_session = finance_db.get(m.LegislativeSession, current_bill.session_id)
    earlier = m.LegislativeSession(
        jurisdiction_id=current_session.jurisdiction_id,
        slug="finance-history-test",
        session_number=9001,
        session_type=current_session.session_type,
        year_start=2023,
        year_end=2024,
        name="Earlier test session",
    )
    finance_db.add(earlier)
    finance_db.flush()
    bill = m.Bill(
        session_id=earlier.id,
        chamber_id=current_bill.chamber_id,
        bill_key="finance-history-test-SF1",
        file_type="SF",
        file_number=1,
        title="Earlier test bill",
    )
    finance_db.add(bill)
    finance_db.flush()
    older = _event(finance_db, bill, member, datetime(2023, 3, 1, tzinfo=UTC))
    tied = _event(finance_db, current_bill, member, events[0].occurred_at)
    path = f"/api/v1/legislators/{member.id}/votes"
    whole = get_history(finance_api, path).json()
    assert whole["page"]["total"] == 5
    assert {row["session"] for row in whole["data"]} == {
        earlier.slug,
        current_session.slug,
    }
    assert {row["vote_event_id"] for row in whole["data"][:2]} == {
        str(events[0].id),
        str(tied.id),
    }
    pages = [
        get_history(
            finance_api,
            path,
            params={"limit": 1, "offset": offset, "version": whole["page"]["version"]},
        ).json()["data"][0]
        for offset in range(whole["page"]["total"])
    ]
    assert pages == whole["data"]
    scoped = get_history(finance_api, path, params={"session": earlier.slug}).json()
    assert [row["vote_event_id"] for row in scoped["data"]] == [str(older.id)]
    finance_db.execute(
        delete(m.VoteRecord).where(m.VoteRecord.legislator_id == member.id)
    )
    finance_db.commit()
    assert (
        get_history(
            finance_api, path, params={"version": whole["page"]["version"]}
        ).status_code
        == 409
    )
    empty = get_history(finance_api, path).json()
    assert empty["data"] == [] and empty["page"]["total"] == 0
    assert empty["page"]["has_more"] is False


def test_existing_preview_shape_is_unchanged(finance_api, member_votes):
    member, _ = member_votes
    path = f"/api/v1/legislators/{member.id}/votes"
    finance_api.headers.pop("Authorization")
    response = finance_api.get(path)
    assert response.status_code == 200
    data = response.json()
    assert "public" in response.headers["cache-control"]
    assert "version" not in data["page"]
    assert data["page"] == {
        "limit": 20,
        "offset": None,
        "next_cursor": None,
        "has_more": False,
        "total": None,
    }
    assert "motion_text" not in data["data"][0]
    assert get_history(finance_api, path).headers["cache-control"] == "no-store"
    assert finance_api.get(path, params={"offset": 1}).status_code == 422
