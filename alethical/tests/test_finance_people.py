"""Finance lists held public records without merging people by spelling."""

# ruff: noqa: F811
from datetime import date

from sqlalchemy import select

from alethical.db import models as m
from alethical.pipeline.candidate_person_records import import_reviewed_records
from alethical.tests.finance_fixtures import finance_api, finance_db  # noqa: F401

BASE = "/api/v1/finance/people"


def get(api, **params):
    response = api.get(BASE, params=params)
    assert response.status_code == 200, response.text
    assert "no-store" in response.headers["cache-control"]
    return response.json()["data"]


def test_people_directory_preserves_candidacies_and_people_as_separate_records(
    finance_api, finance_db
):
    import_reviewed_records(finance_db, today=date(2026, 10, 29))
    data = get(finance_api, q="Kim Ellison")
    assert {row["kind"] for row in data["rows"]} == {"candidate", "person"}
    assert data["counts"]["candidate"] == 1 and data["counts"]["person"] == 1
    candidate = next(row for row in data["rows"] if row["kind"] == "candidate")
    assert candidate["year"] == 2024
    assert candidate["source"]["retained"]
    assert candidate["election"]["date"] == "2024-11-05"
    assert get(finance_api, type="candidates", scope="past", year=2024)["total"] >= 6
    assert get(finance_api, type="candidates", year=2026, q="Kim Ellison")["total"] == 0
    assert get(finance_api, q="Kim Ellison", limit=1)["has_more"]
    assert get(finance_api, q="Kim Ellison", offset=100)["total"] == 2
    assert get(finance_api, q="%")["total"] == 0


def test_people_directory_never_calls_missing_current_service_former(
    finance_api, finance_db
):
    members = finance_db.scalars(
        select(m.Legislator).order_by(m.Legislator.slug).limit(2)
    ).all()
    for member in members:
        for period in member.service_periods:
            period.is_current = False
            period.start_date = None
            period.end_date = None
    # Only the first member has a recorded end date. A session date cannot stand in.
    members[0].service_periods[0].end_date = date(2025, 1, 1)
    finance_db.flush()
    former = get(finance_api, type="legislators", service="former")
    assert str(members[0].id) in {row["id"] for row in former["rows"]}
    assert str(members[1].id) not in {row["id"] for row in former["rows"]}
    unknown = get(finance_api, type="legislators", q=members[1].full_name)
    assert unknown["rows"][0]["service_status"] == "unknown"
    row = next(row for row in former["rows"] if row["id"] == str(members[0].id))
    assert row["periods"][0]["district"]
    assert row["periods"][0]["end_date"] == "2025-01-01"
    assert row["periods"][0]["start_date"] is None


def test_people_directory_requires_finance_access(finance_api):
    finance_api.headers.pop("Authorization")
    assert finance_api.get(BASE).status_code == 401


def test_people_search_rejects_nul(finance_api):
    assert (
        finance_api.get(
            "/api/v1/finance/people", params={"q": "bad\x00input"}
        ).status_code
        == 422
    )
