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


def service_member(db, slug):
    """Own the service history instead of relying on another test's member rows."""
    base = db.scalar(select(m.LegislatorServicePeriod))
    member = m.Legislator(
        jurisdiction_id=base.legislator.jurisdiction_id,
        slug=slug,
        full_name=slug,
        sort_name=slug,
    )
    member.service_periods.append(
        m.LegislatorServicePeriod(
            session_id=base.session_id,
            chamber_id=base.chamber_id,
            district_id=base.district_id,
            period_sequence=1,
            is_current=False,
        )
    )
    db.add(member)
    db.flush()
    return member


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
    members = [
        service_member(finance_db, "service-ended"),
        service_member(finance_db, "service-unknown"),
    ]
    # Only the first member has a recorded end date. A session date cannot stand in.
    members[0].service_periods[0].end_date = date(2025, 1, 1)
    finance_db.flush()
    former = get(finance_api, type="legislators", service="former", q="service-")
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


def test_older_end_date_does_not_establish_latest_service_has_ended(
    finance_api, finance_db
):
    member = service_member(finance_db, "service-latest-unknown")
    prior = member.service_periods[0]
    prior.is_current = False
    prior.end_date = date(2025, 1, 1)
    latest = m.LegislatorServicePeriod(
        legislator_id=member.id,
        session_id=prior.session_id,
        chamber_id=prior.chamber_id,
        district_id=prior.district_id,
        period_sequence=prior.period_sequence + 1,
        is_current=False,
    )
    finance_db.add(latest)
    finance_db.flush()
    assert (
        get(finance_api, type="legislators", q=member.full_name)["rows"][0][
            "service_status"
        ]
        == "unknown"
    )
    assert (
        get(finance_api, type="legislators", service="former", q=member.full_name)[
            "total"
        ]
        == 0
    )
    latest.end_date = date(2025, 2, 1)
    finance_db.flush()
    assert (
        get(finance_api, type="legislators", service="former", q=member.full_name)[
            "total"
        ]
        == 1
    )


def test_same_year_sibling_session_with_unended_service_is_not_former(
    finance_api, finance_db
):
    member = service_member(finance_db, "service-sibling-unknown")
    for held in member.service_periods:
        held.is_current = False
    base = member.service_periods[0]
    for kind, end in [
        (m.SessionType.regular, date(2026, 1, 1)),
        (m.SessionType.special, None),
    ]:
        session = m.LegislativeSession(
            jurisdiction_id=member.jurisdiction_id,
            slug=f"review-sibling-{kind.value}",
            session_number=999,
            session_type=kind,
            year_start=2026,
            year_end=2026,
            name=f"Review {kind.value}",
            is_current=False,
        )
        finance_db.add(session)
        finance_db.flush()
        finance_db.add(
            m.LegislatorServicePeriod(
                legislator_id=member.id,
                session_id=session.id,
                chamber_id=base.chamber_id,
                district_id=base.district_id,
                period_sequence=1,
                is_current=False,
                start_date=date(2026, 1, 1) if end else date(2026, 2, 1),
                end_date=end,
            )
        )
    finance_db.flush()
    response = finance_api.get(
        "/api/v1/finance/people", params={"type": "legislators", "q": member.full_name}
    )
    assert response.status_code == 200
    person = next(
        row for row in response.json()["data"]["rows"] if row["id"] == str(member.id)
    )
    assert person["service_status"] == "unknown", person


def test_candidate_directory_searches_held_voting_area_and_serves_party(
    finance_api, finance_db
):
    import_reviewed_records(finance_db, today=date(2026, 10, 29))
    data = get(
        finance_api,
        type="candidates",
        q="SSD #1",
        party="NONPARTISAN",
        office="School Board Member At Large (SSD #1)",
    )
    assert data["total"] >= 2
    assert all(row["party"] == "NONPARTISAN" for row in data["rows"])
    assert all("SSD #1" in row["voting_area"] for row in data["rows"])
    assert (
        get(finance_api, type="candidates", q="SSD #1", party="not-held")["total"] == 0
    )
    assert (
        get(finance_api, type="candidates", q="SSD #1", office="not-held")["total"] == 0
    )
    assert get(finance_api, type="candidates", q="SSD #%")["total"] == 0
    assert data["party"] == "NONPARTISAN"
    assert data["office"] == "School Board Member At Large (SSD #1)"


def test_legislative_district_and_party_filters_match_the_same_held_period(
    finance_api, finance_db
):
    member = service_member(finance_db, "district-filter-review")
    first = member.service_periods[0]
    first.party = "Review party"
    other = finance_db.scalar(
        select(m.District).where(m.District.id != first.district_id)
    )
    # Another held term must not lend its party to the district in the first term.
    member.service_periods.append(
        m.LegislatorServicePeriod(
            legislator_id=member.id,
            session_id=first.session_id,
            chamber_id=first.chamber_id,
            district_id=other.id,
            period_sequence=2,
            party="Other party",
            is_current=False,
        )
    )
    finance_db.flush()
    district = finance_db.get(m.District, first.district_id).code
    chamber = finance_db.get(m.Chamber, first.chamber_id).chamber_type.value
    data = get(
        finance_api,
        type="legislators",
        q=district,
        party="Review party",
        chamber=chamber,
    )
    assert str(member.id) in {row["id"] for row in data["rows"]}
    matched = next(row for row in data["rows"] if row["id"] == str(member.id))
    assert [p["party"] for p in matched["matching_periods"]] == ["Review party"]
    assert len(matched["periods"]) == 2
    assert (
        get(finance_api, type="legislators", q=member.full_name, party="missing")[
            "total"
        ]
        == 0
    )
    assert (
        get(finance_api, type="legislators", q=district, party="Other party")["total"]
        == 0
    )
    assert (
        get(
            finance_api,
            type="legislators",
            q=member.full_name,
            chamber="senate" if chamber == "house" else "house",
        )["total"]
        == 0
    )
    assert data["chamber"] == chamber
    assert data["party"] == "Review party"


def test_people_filter_options_come_from_held_fields(finance_api, finance_db):
    import_reviewed_records(finance_db, today=date(2026, 10, 29))
    data = get(finance_api, type="candidates", q="no match")
    assert "NONPARTISAN" in data["parties"]
    assert "School Board Member At Large (SSD #1)" in data["offices"]
    assert data["chambers"] == []


def test_people_filter_values_reject_control_characters_and_unknown_chamber(
    finance_api,
):
    for params in [{"party": "x\x00y"}, {"office": "x\x00y"}, {"chamber": "invented"}]:
        assert finance_api.get(BASE, params=params).status_code == 422


def test_people_party_and_filter_options_change_version(finance_api, finance_db):
    import_reviewed_records(finance_db, today=date(2026, 10, 29))
    finance_db.commit()
    before = get(finance_api, type="candidates", q="Kim Ellison")
    candidate = finance_db.get(m.CandidateRecord, before["rows"][0]["id"])
    candidate.public_payload = {
        **candidate.public_payload,
        "candidate": {
            **candidate.public_payload["candidate"],
            "party": "Changed source party",
        },
    }
    finance_db.commit()
    changed = finance_api.get(
        BASE, params={"type": "candidates", "version": before["version"]}
    )
    assert changed.status_code == 409
    after = get(finance_api, type="candidates", q="Kim Ellison")
    assert after["rows"][0]["party"] == "Changed source party"
    assert "Changed source party" in after["parties"]
