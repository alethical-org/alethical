"""District search aliases match held codes, never unrelated names or chambers."""

# ruff: noqa: F811
from datetime import UTC, date, datetime

import pytest
from sqlalchemy import select

from alethical.db import models as m
from alethical.tests.finance_fixtures import finance_api, finance_db  # noqa: F401
from alethical.tests.test_finance_people import get, service_member


@pytest.fixture()
def districts(finance_db):
    db = finance_db
    result = {}
    for chamber_name, code in [
        ("house", "32A"),
        ("house", "132A"),
        ("house", "12"),
        ("senate", "12"),
    ]:
        chamber = db.scalar(select(m.Chamber).where(m.Chamber.slug == chamber_name))
        member = service_member(db, "alias-" + chamber_name + "-" + code)
        district = db.scalar(
            select(m.District).where(
                m.District.chamber_id == chamber.id, m.District.code == code
            )
        )
        if district is None:
            district = m.District(
                jurisdiction_id=member.jurisdiction_id,
                chamber_id=chamber.id,
                code=code,
                label="District " + code,
            )
            db.add(district)
            db.flush()
        period = member.service_periods[0]
        period.chamber_id = chamber.id
        period.district_id = district.id
        result[(chamber_name, code)] = str(member.id)
    for label in [
        "House District 32A",
        "District 32A",
        "Senate District 12",
        "House District 132A",
    ]:
        db.add(
            m.CandidateRecord(
                id="alias-" + label,
                election_id="synthetic",
                election_date=date(2026, 11, 3),
                checked_at=datetime.now(UTC),
                source_sha256="a" * 64,
                public_payload={
                    "candidate": {"name": "Candidate " + label},
                    "votingArea": label,
                    "source": {"retained": True},
                },
            )
        )
    db.flush()
    return result


@pytest.mark.parametrize(
    "query",
    ["District 32A", "district32a", "House District 32A", " HOUSE   DISTRICT 32a "],
)
def test_complete_district_alias_matches_exact_held_code(finance_api, districts, query):
    data = get(finance_api, type="legislators", q=query)
    ids = {row["id"] for row in data["rows"]}
    assert districts["house", "32A"] in ids
    assert districts["house", "132A"] not in ids
    row = next(row for row in data["rows"] if row["id"] == districts["house", "32A"])
    assert row["matching_periods"][0]["district"] == "32A"


def test_explicit_chamber_never_matches_same_code_in_other_chamber(
    finance_api, districts
):
    data = get(finance_api, type="legislators", q="Senate District 12")
    ids = {row["id"] for row in data["rows"]}
    assert districts["senate", "12"] in ids
    assert districts["house", "12"] not in ids
    assert (
        get(finance_api, type="legislators", q="Senate District 12", chamber="house")[
            "total"
        ]
        == 0
    )


def test_candidate_alias_uses_its_own_area_without_borrowing_chamber(
    finance_api, districts
):
    generic = get(finance_api, type="candidates", q="District32A")
    assert {row["id"] for row in generic["rows"]} == {
        "alias-House District 32A",
        "alias-District 32A",
    }
    explicit = get(finance_api, type="candidates", q="House District 32A")
    assert {row["id"] for row in explicit["rows"]} == {"alias-House District 32A"}


def test_other_text_remains_literal_name_search(finance_api, finance_db):
    member = service_member(finance_db, "district-literal-person")
    member.full_name = "Jordan District Market"
    finance_db.flush()
    assert str(member.id) in {
        r["id"] for r in get(finance_api, q="District Market")["rows"]
    }
    assert get(finance_api, q="District %")["total"] == 0
