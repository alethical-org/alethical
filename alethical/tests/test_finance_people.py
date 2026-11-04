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


def test_people_record_cues_follow_validated_profile_records(finance_api, finance_db):
    from copy import deepcopy
    from uuid import UUID

    from alethical.api.services import person_records

    import_reviewed_records(finance_db, today=date(2026, 10, 29))
    data = get(finance_api, q="Kim Ellison")
    person = next(r for r in data["rows"] if r["kind"] == "person")
    candidate = next(r for r in data["rows"] if r["kind"] == "candidate")
    profile = person_records.load_person(finance_db, person["id"])
    assert person["confirmed_record_count"] == len(profile["elections"]) + len(
        profile["service"]
    )
    # The note breaks the count down from the same validated records.
    notes = person["record_notes"]
    assert notes["candidacy_years"] == [candidate["year"]]
    # The same services, statuses and order the person profile shows.
    assert [
        (s["office"], s["voting_area"], s["status"]) for s in notes["services"]
    ] == [
        (s.get("office"), s.get("votingArea"), s["status"]) for s in profile["service"]
    ]
    assert notes["lobbyist"] is False
    assert candidate["person_links"] == [{"id": person["id"], "name": "Kim Ellison"}]
    old_version = data["version"]
    link = finance_db.get(m.PersonCandidacy, (UUID(person["id"]), candidate["id"]))
    changed = deepcopy(link.identity)
    changed["name"] = "Not this candidate"
    link.identity = changed
    finance_db.flush()
    assert finance_api.get(BASE, params={"version": old_version}).status_code == 409
    updated = get(finance_api, q="Kim Ellison")
    assert (
        next(r for r in updated["rows"] if r["kind"] == "candidate")["person_links"]
        == []
    )
    updated_person = next(r for r in updated["rows"] if r["kind"] == "person")
    assert updated_person["confirmed_record_count"] == len(profile["service"])
    # A candidacy that no longer validates leaves the note too.
    assert updated_person["record_notes"]["candidacy_years"] == []


def test_people_count_includes_only_active_identity_lobbyist_links(
    finance_api, finance_db
):
    from datetime import UTC, datetime

    import_reviewed_records(finance_db, today=date(2026, 10, 29))
    person = next(
        r for r in get(finance_api, q="Kim Ellison")["rows"] if r["kind"] == "person"
    )
    base_count = person["confirmed_record_count"]
    identity = m.IdentityEntity(
        kind="person",
        name="Kim Ellison",
        reference="PER-9911",
        made_by_alethical_team=False,
    )
    finance_db.add(identity)
    finance_db.flush()

    def confirmation(kind, key):
        row = m.IdentityConfirmation(
            entity_id=identity.id,
            record_kind=kind,
            record_key=key,
            relation="Confirmed record",
            evidence_source="official_page",
            evidence_url="https://example.test/record",
            evidence_quote="Exact record",
            basis="Reviewed exact record",
            made_by_alethical_team=False,
        )
        finance_db.add(row)
        return row

    public = confirmation("public_person", person["id"])
    lobbyist = confirmation("lobbyist", "9911")
    finance_db.flush()
    current = get(finance_api, q="Kim Ellison", type="persons")
    assert current["rows"][0]["confirmed_record_count"] == base_count + 1
    assert current["rows"][0]["record_notes"]["lobbyist"] is True
    # The public-person anchor and lobbyist confirmation remain on the merged
    # identity; the directory must follow the same standing identity as the profile.
    target = m.IdentityEntity(
        kind="person",
        name="Kim Ellison",
        reference="PER-9912",
        made_by_alethical_team=False,
    )
    finance_db.add(target)
    finance_db.flush()
    identity.status = "merged"
    identity.merged_into_id = target.id
    finance_db.flush()
    assert (
        finance_api.get(BASE, params={"version": current["version"]}).status_code == 409
    )
    current = get(finance_api, q="Kim Ellison", type="persons")
    assert current["rows"][0]["confirmed_record_count"] == base_count + 1
    assert current["rows"][0]["record_notes"]["lobbyist"] is True
    token = current["version"]
    lobbyist.active = False
    lobbyist.withdrawn_at = datetime.now(UTC)
    lobbyist.withdrawal_reason = "Wrong record"
    finance_db.flush()
    assert finance_api.get(BASE, params={"version": token}).status_code == 409
    withdrawn = get(finance_api, q="Kim Ellison", type="persons")["rows"][0]
    assert withdrawn["confirmed_record_count"] == base_count
    assert withdrawn["record_notes"]["lobbyist"] is False
    # A fresh lobbyist confirmation cannot count once the person-to-identity link is withdrawn.
    confirmation("lobbyist", "9912")
    public.active = False
    public.withdrawn_at = datetime.now(UTC)
    public.withdrawal_reason = "Wrong person"
    finance_db.flush()
    assert (
        get(finance_api, q="Kim Ellison", type="persons")["rows"][0][
            "confirmed_record_count"
        ]
        == base_count
    )
    empty = m.PublicPerson(
        name="No linked records", identity_evidence={"review": "test"}
    )
    finance_db.add(empty)
    finance_db.flush()
    empty_row = get(finance_api, type="persons", q=empty.name)["rows"][0]
    assert empty_row["confirmed_record_count"] == 0
    assert empty_row["record_notes"] == {
        "candidacy_years": [],
        "services": [],
        "lobbyist": False,
    }


def test_people_link_cue_read_cost_is_bounded_to_the_selected_page(
    finance_api, finance_db
):
    from time import perf_counter
    from sqlalchemy import event

    import_reviewed_records(finance_db, today=date(2026, 10, 29))
    # The retained register and seed contain 17 records. Add three independent
    # held service records to exercise a full 20-row request without fake links.
    for index in range(3):
        service_member(finance_db, f"read-cost-service-{index}")
    finance_db.flush()
    statements = []
    connection = finance_db.connection()

    def capture(_connection, _cursor, statement, _parameters, _context, _many):
        statements.append(statement)

    event.listen(connection, "before_cursor_execute", capture)
    started = perf_counter()
    try:
        result = get(finance_api, limit=20)
    finally:
        elapsed = perf_counter() - started
        event.remove(connection, "before_cursor_execute", capture)
    print(
        f"People read cost: {len(result['rows'])} rows; {len(statements)} statements; {elapsed:.4f}s"
    )
    assert len(result["rows"]) == 20
    # This fixture includes the actual retained civic-person register plus the
    # seeded legislature. Linked records are batched, not one profile read per row.
    assert len(statements) <= 20


def test_people_note_service_status_follows_the_profile_after_a_term_ends(
    finance_api, finance_db
):
    """A held "current" record whose term has ended reads "unknown" in the note
    exactly as on the person profile, never "current"."""
    from datetime import UTC, datetime
    from uuid import UUID

    from alethical.api.services import person_records

    import_reviewed_records(finance_db, today=date(2026, 10, 29))
    person = next(
        r for r in get(finance_api, q="Kim Ellison")["rows"] if r["kind"] == "person"
    )
    statuses = {s["status"] for s in person["record_notes"]["services"]}
    assert "current" in statuses
    later = date(2029, 3, 1)
    profile = person_records.load_person(
        finance_db, person["id"], now=datetime(2029, 3, 1, 18, tzinfo=UTC)
    )
    *_, notes = person_records.directory_record_cues(
        finance_db,
        person_ids=[UUID(person["id"])],
        candidate_ids=[],
        legislator_ids=[],
        today=later,
    )
    served = notes[person["id"]]["services"]
    assert [(s["office"], s["status"]) for s in served] == [
        (s.get("office"), s["status"]) for s in profile["service"]
    ]
    assert "current" not in {s["status"] for s in served}
    assert all(
        s.get("current_service_confirmed") is False
        for s in served
        if s["status"] == "unknown"
    )
