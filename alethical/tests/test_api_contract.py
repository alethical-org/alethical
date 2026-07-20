from __future__ import annotations

import pytest
import requests
from sqlalchemy import select
from sqlalchemy.orm import Session

from alethical.db.schema import load_schema
from alethical.db.session import get_engine
from alethical.api.services.representative_lookup import (
    DistrictMatch,
    GeocodedAddress,
    RepresentativeLookupNotFound,
    RepresentativeLookupResult,
    get_representative_lookup_service,
)


def test_health_and_meta_endpoints(client):
    health_response = client.get("/healthz")
    assert health_response.status_code == 200
    assert health_response.json() == {"status": "ok"}

    meta_response = client.get("/api/v1/meta")
    assert meta_response.status_code == 200
    payload = meta_response.json()
    assert payload["data"]["api_version"] == "v1"
    assert payload["data"]["jurisdiction"]["slug"] == "minnesota"
    assert payload["data"]["current_session"]["slug"] == "94-2025-regular"
    # "Data as of {date}" provenance strip source (#134): latest succeeded ingestion.
    assert payload["data"]["data_as_of"]


def test_bill_list_and_bill_detail_support_public_and_signed_in_views(
    client, auth_headers
):
    public_response = client.get("/api/v1/bills", params={"session": "94-2025-regular"})
    assert public_response.status_code == 200
    public_payload = public_response.json()
    assert len(public_payload["data"]) >= 2
    first_bill = public_payload["data"][0]
    assert first_bill["id"].startswith("94-2025-")
    assert "tracked" not in first_bill
    assert "chief_sponsors" in first_bill
    assert first_bill["status_key"] in {
        "proposed",
        "in_committee",
        "passed_house",
        "passed_senate",
        "signed_into_law",
        "vetoed",
    }
    assert first_bill["ai_analysis"]["summary"]
    assert first_bill["ai_analysis"]["key_points"]
    assert first_bill["ai_analysis"]["policy_areas"]

    listed_bill_id = first_bill["id"]
    seed_tracking_response = client.put(
        f"/api/v1/me/tracked-bills/{listed_bill_id}",
        json={"alerts_enabled": True, "note": None},
        headers=auth_headers,
    )
    assert seed_tracking_response.status_code == 200

    authed_response = client.get(
        "/api/v1/bills",
        params={"session": "94-2025-regular", "include": "tracking"},
        headers=auth_headers,
    )
    assert authed_response.status_code == 200
    tracked_bill = next(
        item for item in authed_response.json()["data"] if item["id"] == listed_bill_id
    )
    assert tracked_bill["tracked"]["is_tracked"] is True

    detail_response = client.get(
        f"/api/v1/bills/{listed_bill_id}",
        params={"include": "all_sponsors,actions,versions,tracking,ai_summary"},
        headers=auth_headers,
    )
    assert detail_response.status_code == 200
    detail_payload = detail_response.json()["data"]
    assert detail_payload["id"] == listed_bill_id
    assert detail_payload["tracking"]["is_tracked"] is True
    assert isinstance(detail_payload["actions"], list)
    assert isinstance(detail_payload["versions"], list)
    assert isinstance(detail_payload["all_sponsors"], list)
    assert detail_payload["status_key"] in {
        "proposed",
        "in_committee",
        "passed_house",
        "passed_senate",
        "signed_into_law",
        "vetoed",
    }
    assert detail_payload["all_sponsors"][0]["role"]
    assert "party" in detail_payload["all_sponsors"][0]

    progress_response = client.get(
        "/api/v1/bills/94-2025-SF1832",
        params={"include": "progress,actions"},
    )
    assert progress_response.status_code == 200
    progress_payload = progress_response.json()["data"]["progress"]
    assert [step["key"] for step in progress_payload] == [
        "proposed",
        "in_committee",
        "passed_house",
        "passed_senate",
        "signed_into_law",
    ]


def test_bill_and_legislator_lists_support_search_filter_contract(client):
    policy_areas_response = client.get(
        "/api/v1/policy-areas",
        params={"session": "94-2025-regular", "limit": 20},
    )
    assert policy_areas_response.status_code == 200
    policy_areas = policy_areas_response.json()["data"]
    assert policy_areas
    assert all(item["name"] and item["bill_count"] >= 1 for item in policy_areas)

    sessions_response = client.get("/api/v1/sessions")
    assert sessions_response.status_code == 200
    sessions = sessions_response.json()["data"]
    assert sessions
    assert all(item["slug"] and item["name"] for item in sessions)

    senate_bills_response = client.get(
        "/api/v1/bills",
        params={"session": "94-2025-regular", "chamber": "senate", "limit": 20},
    )
    assert senate_bills_response.status_code == 200
    senate_bills = senate_bills_response.json()["data"]
    assert senate_bills
    assert all(bill["file_type"] == "SF" for bill in senate_bills)

    omnibus_bills_response = client.get(
        "/api/v1/bills",
        params={"session": "94-2025-regular", "omnibus": True, "limit": 20},
    )
    assert omnibus_bills_response.status_code == 200
    omnibus_bills = omnibus_bills_response.json()["data"]
    assert omnibus_bills
    # The list item exposes is_omnibus so the card can render its OMNIBUS pill.
    assert all(bill["is_omnibus"] is True for bill in omnibus_bills)

    committee_bills_response = client.get(
        "/api/v1/bills",
        params={"session": "94-2025-regular", "status": "in_committee", "limit": 20},
    )
    assert committee_bills_response.status_code == 200
    assert isinstance(committee_bills_response.json()["data"], list)

    # policy_area filters on the canonical issue a /policy-areas chip sends
    # (issue_taxonomy), and card badges render that same canonical label — so
    # the chip's count and the filtered list agree and badges match filters.
    economy_bills_response = client.get(
        "/api/v1/bills",
        params={
            "session": "94-2025-regular",
            "policy_area": "Economic Development",
            "limit": 20,
        },
    )
    assert economy_bills_response.status_code == 200
    economy_bills = economy_bills_response.json()["data"]
    assert economy_bills
    assert all(
        "Economic Development" in bill["ai_analysis"]["policy_areas"]
        for bill in economy_bills
    )

    senate_legislators_response = client.get(
        "/api/v1/legislators",
        params={"session": "94-2025-regular", "chamber": "senate", "limit": 20},
    )
    assert senate_legislators_response.status_code == 200
    senate_legislators = senate_legislators_response.json()["data"]
    assert senate_legislators
    assert all(
        item["current_service"]["chamber"] == "senate" for item in senate_legislators
    )


def test_bill_list_supports_offset_pagination(client):
    first_page_response = client.get(
        "/api/v1/bills",
        params={"session": "94-2025-regular", "limit": 1, "offset": 0},
    )
    assert first_page_response.status_code == 200
    first_page_payload = first_page_response.json()
    assert len(first_page_payload["data"]) == 1
    assert first_page_payload["page"]["limit"] == 1
    assert first_page_payload["page"]["offset"] == 0
    assert first_page_payload["page"]["has_more"] is True

    second_page_response = client.get(
        "/api/v1/bills",
        params={"session": "94-2025-regular", "limit": 1, "offset": 1},
    )
    assert second_page_response.status_code == 200
    second_page_payload = second_page_response.json()
    assert len(second_page_payload["data"]) == 1
    assert second_page_payload["page"]["offset"] == 1
    assert second_page_payload["data"][0]["id"] != first_page_payload["data"][0]["id"]
    # Total is the full matching-bill count, independent of the page window (#134).
    total = first_page_payload["page"]["total"]
    assert total >= 2
    assert second_page_payload["page"]["total"] == total


def test_bill_search_supports_bill_number_query(client):
    # "SF 1832" — a bill-number query — must resolve the bill by file_type +
    # file_number, even though its number appears in neither title nor
    # description (#134). Spacing and case are normalized.
    for query in ("SF 1832", "SF1832", "sf 1832"):
        response = client.get(
            "/api/v1/bills",
            params={"session": "94-2025-regular", "q": query, "limit": 20},
        )
        assert response.status_code == 200
        payload = response.json()
        ids = [bill["id"] for bill in payload["data"]]
        assert ids == ["94-2025-SF1832"], query
        assert payload["page"]["total"] == 1

    # A chamber-mismatched prefix does not resolve the Senate bill.
    chamber_miss = client.get(
        "/api/v1/bills",
        params={"session": "94-2025-regular", "q": "HF 1832", "limit": 20},
    )
    assert chamber_miss.status_code == 200
    assert "94-2025-SF1832" not in [b["id"] for b in chamber_miss.json()["data"]]

    # Keyword search is unchanged — a plain word still matches title/description.
    keyword_response = client.get(
        "/api/v1/bills",
        params={"session": "94-2025-regular", "q": "education", "limit": 20},
    )
    assert keyword_response.status_code == 200
    assert keyword_response.json()["data"]


def test_legislator_list_supports_offset_pagination_and_total(client):
    first_response = client.get(
        "/api/v1/legislators",
        params={"session": "94-2025-regular", "limit": 1, "offset": 0},
    )
    assert first_response.status_code == 200
    first_payload = first_response.json()
    assert len(first_payload["data"]) == 1
    assert first_payload["page"]["offset"] == 0
    # has_more is real now, not hardcoded False — a next page exists (#267).
    assert first_payload["page"]["has_more"] is True
    total = first_payload["page"]["total"]
    assert total >= 2

    second_response = client.get(
        "/api/v1/legislators",
        params={"session": "94-2025-regular", "limit": 1, "offset": 1},
    )
    assert second_response.status_code == 200
    second_payload = second_response.json()
    assert second_payload["page"]["offset"] == 1
    assert second_payload["page"]["total"] == total
    assert second_payload["data"][0]["id"] != first_payload["data"][0]["id"]

    # The full directory is reachable — the last page reports no more.
    full_response = client.get(
        "/api/v1/legislators",
        params={"session": "94-2025-regular", "limit": total, "offset": 0},
    )
    assert len(full_response.json()["data"]) == total
    assert full_response.json()["page"]["has_more"] is False

    # A chamber filter narrows the total to that chamber's members.
    senate_response = client.get(
        "/api/v1/legislators",
        params={"session": "94-2025-regular", "chamber": "senate", "limit": 100},
    )
    senate_total = senate_response.json()["page"]["total"]
    assert 1 <= senate_total < total
    assert len(senate_response.json()["data"]) == senate_total


def test_bill_detail_and_action_endpoints_expose_live_action_dates(client):
    detail_response = client.get(
        "/api/v1/bills/94-2025-SF1832",
        params={"include": "actions,versions,topics,ai_analysis"},
    )
    assert detail_response.status_code == 200
    detail_payload = detail_response.json()["data"]
    assert detail_payload["actions"]
    assert "action_at" in detail_payload["actions"][0]

    actions_response = client.get("/api/v1/bills/94-2025-SF1832/actions")
    assert actions_response.status_code == 200
    action_payload = actions_response.json()["data"]
    assert action_payload
    assert "action_at" in action_payload[0]


def test_bill_detail_exposes_normalized_ai_analysis_without_metadata(client):
    detail_response = client.get(
        "/api/v1/bills/94-2025-SF1832",
        params={"include": "ai_analysis,ai_summary"},
    )
    assert detail_response.status_code == 200
    detail_payload = detail_response.json()["data"]

    assert detail_payload["ai_analysis"] == {
        "short_title": None,
        "summary": (
            "SF 1832 is an omnibus jobs, labor, and economic development package. "
            "It combines agency appropriations with policy changes for workforce programs, "
            "business development, labor standards, tourism, and worker safety."
        ),
        "key_points": [
            "Funds workforce, labor, tourism, and economic development agencies for the biennium.",
            "Updates grant and loan programs for small businesses, redevelopment, child care capacity, and job training.",
            "Changes labor and worker safety rules, including underground telecommunications installer certification.",
            "Requires reports and makes technical corrections across jobs and economic development statutes.",
        ],
        # Canonical issues (issue_taxonomy): "workforce development" → Labor &
        # Employment, "economic development" → Economic Development, and the
        # unmapped "labor policy" falls through Title-Cased.
        "policy_areas": [
            "Labor & Employment",
            "Economic Development",
            "Labor Policy",
        ],
    }
    assert "confidence" not in detail_payload["ai_analysis"]
    assert "truncated_source" not in detail_payload["ai_analysis"]
    assert detail_payload["ai_summary"]["confidence"] == "high"
    assert detail_payload["ai_summary"]["truncated_source"] is False


def test_legislator_directory_profile_search_and_lookup_cover_user_story(client):
    directory_response = client.get(
        "/api/v1/legislators", params={"session": "94-2025-regular"}
    )
    assert directory_response.status_code == 200
    directory_payload = directory_response.json()
    assert len(directory_payload["data"]) >= 2
    first_legislator = directory_payload["data"][0]
    assert first_legislator["id"]
    assert first_legislator["current_service"]["district"]["code"]
    assert not first_legislator["current_service"]["district"]["code"].endswith(
        "-unknown"
    )

    legislator_id = first_legislator["id"]
    profile_response = client.get(
        f"/api/v1/legislators/{legislator_id}",
        params={
            "session": "94-2025-regular",
            "include": "current_service,committees,stats",
        },
    )
    assert profile_response.status_code == 200
    profile_payload = profile_response.json()["data"]
    assert profile_payload["id"] == legislator_id
    assert "current_service" in profile_payload

    bills_response = client.get(
        f"/api/v1/legislators/{legislator_id}/bills",
        params={"session": "94-2025-regular"},
    )
    assert bills_response.status_code == 200
    assert isinstance(bills_response.json()["data"], list)

    search_response = client.get(
        "/api/v1/search", params={"q": "jobs", "types": "bills,legislators"}
    )
    assert search_response.status_code == 200
    search_payload = search_response.json()["data"]
    assert "bills" in search_payload
    assert "legislators" in search_payload
    assert search_payload["bills"]
    assert all(bill["id"].startswith("94-2025-") for bill in search_payload["bills"])

    lookup_response = client.post(
        "/api/v1/representative-lookups",
        json={"address_text": "75 Rev Dr Martin Luther King Jr Blvd, Saint Paul, MN"},
    )
    assert lookup_response.status_code == 200
    lookup_payload = lookup_response.json()["data"]
    assert lookup_payload["resolved_place"]["state_code"] == "MN"
    assert lookup_payload["resolved_place"]["matched_address"]
    assert lookup_payload["resolved_place"]["house_district"] == "51A"
    assert lookup_payload["resolved_place"]["senate_district"] == "35"
    assert lookup_payload["house_legislator"] is not None
    assert lookup_payload["senate_legislator"] is not None


def test_legislator_list_includes_current_committee_names(client):
    """The /legislators list item carries current committee names (#296) so the
    directory card can show committee chips without a per-row detail fetch."""
    schema = load_schema()
    directory = client.get(
        "/api/v1/legislators", params={"session": "94-2025-regular"}
    ).json()["data"]
    legislator_id = directory[0]["id"]

    with Session(get_engine()) as db:
        service = db.scalar(
            select(schema.LegislatorServicePeriod).where(
                schema.LegislatorServicePeriod.legislator_id == legislator_id,
                schema.LegislatorServicePeriod.is_current.is_(True),
            )
        )
        committee = schema.Committee(
            session_id=service.session_id,
            chamber_id=service.chamber_id,
            name="Test Committee on Roster Chips",
        )
        db.add(committee)
        db.flush()
        membership = schema.CommitteeMembership(
            committee_id=committee.id,
            legislator_id=legislator_id,
            is_current=True,
        )
        db.add(membership)
        db.commit()
        committee_id, membership_id = committee.id, membership.id

    try:
        item = next(
            leg
            for leg in client.get(
                "/api/v1/legislators", params={"session": "94-2025-regular"}
            ).json()["data"]
            if leg["id"] == legislator_id
        )
        names = [c["name"] for c in item.get("committees", [])]
        assert "Test Committee on Roster Chips" in names
    finally:
        with Session(get_engine()) as db:
            db.delete(db.get(schema.CommitteeMembership, membership_id))
            db.delete(db.get(schema.Committee, committee_id))
            db.commit()


def test_representative_lookup_maps_service_district_codes_to_legislators(client):
    response = client.post(
        "/api/v1/representative-lookups",
        json={"address_text": "75 Rev Dr Martin Luther King Jr Blvd, Saint Paul, MN"},
    )

    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["resolved_place"]["house_district"] == "51A"
    assert payload["resolved_place"]["senate_district"] == "35"
    assert payload["house_legislator"]["current_service"]["district"]["code"] == "51A"
    assert payload["senate_legislator"]["current_service"]["district"]["code"] == "35"


def test_representative_lookup_accepts_coordinate_pin_input(client):
    response = client.post(
        "/api/v1/representative-lookups",
        json={"latitude": 44.9551, "longitude": -93.1022},
    )

    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["resolved_place"]["input_mode"] == "coordinates"
    assert payload["resolved_place"]["latitude"] == 44.9551
    assert payload["resolved_place"]["longitude"] == -93.1022
    assert payload["resolved_place"]["house_district"] == "51A"
    assert payload["resolved_place"]["senate_district"] == "35"
    assert payload["house_legislator"] is not None
    assert payload["senate_legislator"] is not None


def test_representative_lookup_rejects_invalid_input_modes(client):
    missing_response = client.post("/api/v1/representative-lookups", json={})
    assert missing_response.status_code == 422

    partial_coordinate_response = client.post(
        "/api/v1/representative-lookups",
        json={"latitude": 44.9551},
    )
    assert partial_coordinate_response.status_code == 422

    mixed_response = client.post(
        "/api/v1/representative-lookups",
        json={
            "address_text": "75 Rev Dr Martin Luther King Jr Blvd, Saint Paul, MN",
            "latitude": 44.9551,
            "longitude": -93.1022,
        },
    )
    assert mixed_response.status_code == 422

    out_of_range_response = client.post(
        "/api/v1/representative-lookups",
        json={"latitude": 144.9551, "longitude": -93.1022},
    )
    assert out_of_range_response.status_code == 422


def test_representative_lookup_returns_not_found_for_unresolved_addresses(client):
    class NotFoundLookupService:
        def lookup(self, _address_text: str):
            raise RepresentativeLookupNotFound("address could not be geocoded")

    client.app.dependency_overrides[get_representative_lookup_service] = lambda: (
        NotFoundLookupService()
    )

    response = client.post(
        "/api/v1/representative-lookups", json={"address_text": "Nowhere"}
    )

    assert response.status_code == 404
    problem = response.json()
    assert problem["title"] == "Not Found"
    assert problem["detail"] == "address could not be geocoded"


def test_representative_lookup_returns_not_found_for_unknown_database_districts(client):
    class UnknownDistrictLookupService:
        def lookup(self, address_text: str):
            return RepresentativeLookupResult(
                geocoded_address=GeocodedAddress(
                    requested_address=address_text,
                    matched_address="1 TEST ST, SAINT PAUL, MN",
                    latitude=44.0,
                    longitude=-93.0,
                    state_code="MN",
                ),
                house_district=DistrictMatch(chamber="house", district_code="99Z"),
                senate_district=DistrictMatch(chamber="senate", district_code="99"),
            )

    client.app.dependency_overrides[get_representative_lookup_service] = lambda: (
        UnknownDistrictLookupService()
    )

    response = client.post(
        "/api/v1/representative-lookups",
        json={"address_text": "1 Test St, Saint Paul, MN"},
    )

    assert response.status_code == 404
    assert (
        response.json()["detail"]
        == "resolved districts are not available in the database"
    )


def test_representative_lookup_returns_bad_gateway_for_upstream_failure(client):
    class UpstreamFailureLookupService:
        def lookup(self, _address_text: str):
            raise requests.Timeout("GIS request timed out")

    client.app.dependency_overrides[get_representative_lookup_service] = lambda: (
        UpstreamFailureLookupService()
    )

    response = client.post(
        "/api/v1/representative-lookups",
        json={"address_text": "75 Rev Dr Martin Luther King Jr Blvd, Saint Paul, MN"},
    )

    assert response.status_code == 502
    assert response.json()["title"] == "Bad Gateway"


def test_legislator_directory_limit_search_no_results_and_missing_profile(client):
    limited_response = client.get(
        "/api/v1/legislators", params={"session": "94-2025-regular", "limit": 1}
    )
    assert limited_response.status_code == 200
    limited_payload = limited_response.json()
    assert len(limited_payload["data"]) == 1
    assert limited_payload["page"]["limit"] == 1

    matching_response = client.get(
        "/api/v1/legislators", params={"q": "Howard", "limit": 10}
    )
    assert matching_response.status_code == 200
    matching_names = [item["full_name"] for item in matching_response.json()["data"]]
    assert any("Howard" in name for name in matching_names)

    no_results_response = client.get(
        "/api/v1/legislators", params={"q": "definitely-not-a-real-legislator"}
    )
    assert no_results_response.status_code == 200
    assert no_results_response.json()["data"] == []

    missing_response = client.get("/api/v1/legislators/not-a-real-id")
    assert missing_response.status_code == 404
    missing_problem = missing_response.json()
    assert missing_problem["title"] == "Not Found"
    assert missing_problem["status"] == 404


def test_legislator_sponsored_bills_cover_empty_and_card_payload_shapes(client):
    empty_legislator_response = client.get(
        "/api/v1/legislators", params={"q": "Howard", "limit": 1}
    )
    assert empty_legislator_response.status_code == 200
    empty_legislator = empty_legislator_response.json()["data"][0]

    bills_response = client.get(f"/api/v1/legislators/{empty_legislator['id']}/bills")
    assert bills_response.status_code == 200
    assert isinstance(bills_response.json()["data"], list)

    sponsored_legislator_response = client.get(
        "/api/v1/legislators", params={"q": "Fateh", "limit": 1}
    )
    assert sponsored_legislator_response.status_code == 200
    sponsored_legislator = sponsored_legislator_response.json()["data"][0]

    empty_bills_response = client.get(
        f"/api/v1/legislators/{sponsored_legislator['id']}/bills", params={"limit": 0}
    )
    assert empty_bills_response.status_code == 200
    assert empty_bills_response.json()["data"] == []

    sponsored_bills_response = client.get(
        f"/api/v1/legislators/{sponsored_legislator['id']}/bills"
    )
    assert sponsored_bills_response.status_code == 200
    sponsored_bills = sponsored_bills_response.json()["data"]
    assert sponsored_bills
    first_bill = sponsored_bills[0]
    assert first_bill["id"].startswith("94-2025-")
    assert "chief_sponsors" in first_bill
    assert "stats" in first_bill

    first_page_response = client.get(
        f"/api/v1/legislators/{sponsored_legislator['id']}/bills",
        params={"limit": 1, "offset": 0},
    )
    assert first_page_response.status_code == 200
    first_page_payload = first_page_response.json()
    assert first_page_payload["page"]["offset"] == 0

    second_page_response = client.get(
        f"/api/v1/legislators/{sponsored_legislator['id']}/bills",
        params={"limit": 1, "offset": 1},
    )
    assert second_page_response.status_code == 200
    second_page_payload = second_page_response.json()
    assert second_page_payload["page"]["offset"] == 1
    if first_page_payload["page"]["has_more"]:
        assert second_page_payload["data"]
        assert (
            second_page_payload["data"][0]["id"] != first_page_payload["data"][0]["id"]
        )


def test_legislator_directory_authored_count_uses_live_sponsorships(client):
    """Regression for #291: the directory (and detail) authored-bill count must
    resolve the sponsorship-bearing shadow row, not read the directory row's own
    stored LegislatorStats — which is always 0.

    Reproduces the real production topology exactly (Scenario B), because reading
    Sponsorship on the directory row's own id would pass a naive test but fixes
    nothing on the live site:

      * a "roster" row (external_key = a member profile URL, a real district)
        that appears in the directory but carries NO sponsorships and a stored
        LegislatorStats.total_bill_count of 0 — the state that renders "0 bills";
      * a separate "author" row whose external_key is the numeric member key
        (a suffix of the roster URL) on a "*-unknown" placeholder district
        excluded from the directory, which carries every Sponsorship.

    The two are linked only by the roster key ending with the author key. Under
    the old logic (count Sponsorship.legislator_id == roster id) the directory
    returned 0; the fix joins roster -> author by that suffix and returns the
    real count. total counts all authorship (chief + co), chief only chief-author,
    and the count matches wherever the person is shown (directory, detail, and
    detail reached via the placeholder/author id)."""
    from sqlalchemy import delete, select

    from alethical.db.schema import load_schema
    from alethical.db.session import get_session_factory

    schema = load_schema()
    author_key = "reg291authorkey"
    roster_key = f"https://www.house.mn.gov/members/profile/{author_key}"
    roster_name = "Regressionia Twoninetyone Rosterrow"

    created_ids: dict[str, object] = {}
    try:
        with get_session_factory()() as db:
            session_row = db.scalar(
                select(schema.LegislativeSession).where(
                    schema.LegislativeSession.slug == "94-2025-regular"
                )
            )
            chamber = db.scalar(
                select(schema.Chamber).where(schema.Chamber.slug == "house")
            )
            bills = db.scalars(
                select(schema.Bill)
                .where(schema.Bill.session_id == session_row.id)
                .limit(2)
            ).all()
            assert session_row is not None and chamber is not None
            assert len(bills) >= 2

            real_district = schema.District(
                jurisdiction_id=chamber.jurisdiction_id,
                chamber_id=chamber.id,
                code="R291",
                label="District R291",
            )
            unknown_district = schema.District(
                jurisdiction_id=chamber.jurisdiction_id,
                chamber_id=chamber.id,
                code="HR291-unknown",
                label="District HR291 (unknown)",
            )
            db.add_all([real_district, unknown_district])
            db.flush()

            # Roster row: real district, in the directory, no sponsorships.
            roster = schema.Legislator(
                jurisdiction_id=chamber.jurisdiction_id,
                slug="regressionia-291-rosterrow",
                external_key=roster_key,
                full_name=roster_name,
                sort_name=roster_name,
            )
            # Author row: placeholder district, excluded from the directory,
            # bears the sponsorships; keyed so roster_key ends with author_key.
            author = schema.Legislator(
                jurisdiction_id=chamber.jurisdiction_id,
                slug="regressionia-291-authorrow",
                external_key=author_key,
                full_name="Rosterrow, R. T.",
                sort_name="Rosterrow, R. T.",
            )
            db.add_all([roster, author])
            db.flush()
            db.add_all(
                [
                    schema.LegislatorServicePeriod(
                        legislator_id=roster.id,
                        session_id=session_row.id,
                        chamber_id=chamber.id,
                        district_id=real_district.id,
                        is_current=True,
                    ),
                    schema.LegislatorServicePeriod(
                        legislator_id=author.id,
                        session_id=session_row.id,
                        chamber_id=chamber.id,
                        district_id=unknown_district.id,
                        is_current=True,
                    ),
                    schema.Sponsorship(
                        bill_id=bills[0].id,
                        legislator_id=author.id,
                        role=schema.SponsorshipRole.chief_author,
                        source_order=1,
                    ),
                    schema.Sponsorship(
                        bill_id=bills[1].id,
                        legislator_id=author.id,
                        role=schema.SponsorshipRole.co_author,
                        source_order=2,
                    ),
                    # Stored stats on the roster row are 0 — the bug's state.
                    schema.LegislatorStats(
                        legislator_id=roster.id,
                        session_id=session_row.id,
                        total_bill_count=0,
                        chief_bill_count=0,
                    ),
                ]
            )
            db.commit()
            created_ids = {
                "roster": roster.id,
                "author": author.id,
                "real_district": real_district.id,
                "unknown_district": unknown_district.id,
            }

        directory_response = client.get(
            "/api/v1/legislators",
            params={"session": "94-2025-regular", "q": roster_name, "limit": 5},
        )
        assert directory_response.status_code == 200
        directory_ids = {item["id"] for item in directory_response.json()["data"]}
        # The author (placeholder) row must never appear in the directory.
        assert str(created_ids["author"]) not in directory_ids
        matches = [
            item
            for item in directory_response.json()["data"]
            if item["id"] == str(created_ids["roster"])
        ]
        assert len(matches) == 1
        directory_total = matches[0]["stats"]["total_bill_count"]
        # The core bug: this was 0 (roster row bears no sponsorships) before the fix.
        assert directory_total == 2
        assert matches[0]["stats"]["chief_bill_count"] == 1

        # Detail on the roster row: same number, everywhere we show it.
        detail_response = client.get(
            f"/api/v1/legislators/{created_ids['roster']}",
            params={"session": "94-2025-regular", "include": "stats"},
        )
        assert detail_response.status_code == 200
        detail_stats = detail_response.json()["data"]["stats"]
        assert detail_stats["total_bill_count"] == directory_total
        assert detail_stats["chief_bill_count"] == 1

        # Detail reached via the placeholder/author id resolves to the roster row
        # and reports the same count (canonical_legislator_for_placeholder path).
        placeholder_response = client.get(
            f"/api/v1/legislators/{created_ids['author']}",
            params={"session": "94-2025-regular", "include": "stats"},
        )
        assert placeholder_response.status_code == 200
        assert (
            placeholder_response.json()["data"]["stats"]["total_bill_count"]
            == directory_total
        )
    finally:
        with get_session_factory()() as db:
            if created_ids:
                leg_ids = [created_ids["roster"], created_ids["author"]]
                db.execute(
                    delete(schema.Sponsorship).where(
                        schema.Sponsorship.legislator_id.in_(leg_ids)
                    )
                )
                db.execute(
                    delete(schema.LegislatorStats).where(
                        schema.LegislatorStats.legislator_id.in_(leg_ids)
                    )
                )
                db.execute(
                    delete(schema.LegislatorServicePeriod).where(
                        schema.LegislatorServicePeriod.legislator_id.in_(leg_ids)
                    )
                )
                db.execute(
                    delete(schema.Legislator).where(schema.Legislator.id.in_(leg_ids))
                )
                db.execute(
                    delete(schema.District).where(
                        schema.District.id.in_(
                            [
                                created_ids["real_district"],
                                created_ids["unknown_district"],
                            ]
                        )
                    )
                )
                db.commit()


def test_signed_in_bill_tracking_and_notification_preferences(client, auth_headers):
    me_response = client.get("/api/v1/me", headers=auth_headers)
    assert me_response.status_code == 200
    assert me_response.json()["data"]["primary_email"] == "ada@example.com"

    tracked_response = client.get("/api/v1/me/tracked-bills", headers=auth_headers)
    assert tracked_response.status_code == 200
    tracked_payload = tracked_response.json()["data"]
    assert len(tracked_payload) >= 2
    first_tracked = tracked_payload[0]
    assert first_tracked["bill_id"].startswith("94-2025-")
    assert first_tracked["bill"]["id"] == first_tracked["bill_id"]
    assert "chief_sponsors" in first_tracked["bill"]
    assert "stats" in first_tracked["bill"]

    delete_response = client.delete(
        "/api/v1/me/tracked-bills/94-2025-SF2483", headers=auth_headers
    )
    assert delete_response.status_code == 204

    recreate_response = client.put(
        "/api/v1/me/tracked-bills/94-2025-SF2483",
        json={"alerts_enabled": True, "note": "important bill"},
        headers=auth_headers,
    )
    assert recreate_response.status_code == 200
    assert recreate_response.json()["data"]["bill_id"] == "94-2025-SF2483"

    patch_response = client.patch(
        "/api/v1/me/tracked-bills/94-2025-SF2483",
        json={"note": "watch closely"},
        headers=auth_headers,
    )
    assert patch_response.status_code == 200
    assert patch_response.json()["data"]["note"] == "watch closely"

    prefs_response = client.get(
        "/api/v1/me/notification-preferences", headers=auth_headers
    )
    assert prefs_response.status_code == 200
    assert len(prefs_response.json()["data"]) >= 1

    update_pref_response = client.put(
        "/api/v1/me/notification-preferences/email",
        json={"frequency": "daily_digest", "is_enabled": True},
        headers=auth_headers,
    )
    assert update_pref_response.status_code == 200
    assert update_pref_response.json()["data"]["channel"] == "email"


def test_signed_in_chat_session_and_message_flow(client, auth_headers, monkeypatch):
    openai_calls = []

    class FakeOpenAIResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {"output_text": "OpenAI synthesized answer from bill-scoped chunks."}

    def fake_openai_post(*args, **kwargs):
        openai_calls.append({"args": args, "kwargs": kwargs})
        return FakeOpenAIResponse()

    monkeypatch.setenv("OPENAI_API_KEY", "test-openai-key")
    monkeypatch.setattr("alethical.api.routers.me.requests.post", fake_openai_post)
    # build_query_embedding now delegates to rag_ingest._build_embeddings, which
    # calls a different requests.post. Stub it to return a deterministic vector
    # so retrieval still runs against the seeded chunks.
    from alethical.pipeline.rag_ingest import (
        FALLBACK_EMBEDDING_MODEL,
        VECTOR_DIMENSIONS,
        _deterministic_embedding,
    )

    monkeypatch.setattr(
        "alethical.api.routers.me._build_embeddings",
        lambda texts, **kw: [
            _deterministic_embedding(t, dimensions=VECTOR_DIMENSIONS) for t in texts
        ],
    )
    # The stubbed query vector above is the hash fallback, and the sample-data
    # chunks are stored under FALLBACK_EMBEDDING_MODEL (#221). Pin retrieval's
    # model filter to the same label so query and chunks stay a consistent pair
    # even though the (fake) synthesis key is set.
    monkeypatch.setattr(
        "alethical.api.routers.me.effective_embedding_model",
        lambda _model: FALLBACK_EMBEDDING_MODEL,
    )
    sessions_response = client.get("/api/v1/me/chat-sessions", headers=auth_headers)
    assert sessions_response.status_code == 200
    assert len(sessions_response.json()["data"]) >= 1

    create_session_response = client.post(
        "/api/v1/me/chat-sessions",
        json={"title": "Education bill", "subject_bill_id": "94-2025-SF2483"},
        headers=auth_headers,
    )
    assert create_session_response.status_code == 201
    session_payload = create_session_response.json()["data"]
    session_id = session_payload["id"]
    assert session_payload["subject_bill_id"] == "94-2025-SF2483"

    missing_subject_response = client.post(
        "/api/v1/me/chat-sessions",
        json={"title": "General chat"},
        headers=auth_headers,
    )
    assert missing_subject_response.status_code == 400

    send_message_response = client.post(
        f"/api/v1/me/chat-sessions/{session_id}/messages",
        json={"content": "What does this bill do?", "stream": False},
        headers=auth_headers,
    )
    assert send_message_response.status_code == 201
    message_payload = send_message_response.json()["data"]
    assert message_payload["assistant_message"]["role"] == "assistant"
    assert (
        message_payload["assistant_message"]["content"]
        == "OpenAI synthesized answer from bill-scoped chunks."
    )
    assert len(message_payload["assistant_message"]["citations"]) >= 1
    assert {
        citation["bill_id"]
        for citation in message_payload["assistant_message"]["citations"]
    } == {"94-2025-SF2483"}
    assert len(openai_calls) == 1
    assert "94-2025-SF2483" in openai_calls[0]["kwargs"]["json"]["input"][1]["content"]

    transcript_response = client.get(
        f"/api/v1/me/chat-sessions/{session_id}/messages",
        headers=auth_headers,
    )
    assert transcript_response.status_code == 200
    transcript_payload = transcript_response.json()["data"]
    assert len(transcript_payload) >= 2


def test_openai_responses_payload_text_extraction():
    from alethical.api.routers.me import extract_openai_response_text

    assert extract_openai_response_text({"output_text": "Direct text"}) == "Direct text"
    assert (
        extract_openai_response_text(
            {
                "output": [
                    {
                        "type": "message",
                        "content": [
                            {
                                "type": "output_text",
                                "text": "Nested Responses API text",
                            }
                        ],
                    }
                ]
            }
        )
        == "Nested Responses API text"
    )


def _fake_ask_router_response(intent: str, confidence: float | None = None):
    import json

    body = {"intent": intent}
    if confidence is not None:
        body["confidence"] = confidence

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {"output_text": json.dumps(body)}

    return FakeResponse()


def test_ask_classify_llm_intents(client, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-openai-key")
    calls = []

    def fake_post(*args, **kwargs):
        calls.append(kwargs)
        question = kwargs["json"]["input"][1]["content"].lower()
        if "which legislators" in question:
            return _fake_ask_router_response("topic_legislators", 0.9)
        if "vote" in question:
            return _fake_ask_router_response("legislator_vote", 0.85)
        if "bills" in question:
            return _fake_ask_router_response("topic_bills", 0.91)
        if "poem" in question:
            return _fake_ask_router_response("refuse", 0.99)
        return _fake_ask_router_response("bill_text", 0.88)

    monkeypatch.setattr("alethical.api.services.ask_router.requests.post", fake_post)

    # All five v1 intents are anonymous; auth gates only the follow-up
    # composer on the answer page (docs/grounded-ask-spec.md §9.1).
    bill_text = client.post(
        "/api/v1/ask/classify",
        json={"content": "What's in the cannabis legalization bill?"},
    )
    assert bill_text.status_code == 200
    bill_text_data = bill_text.json()["data"]
    assert bill_text_data["intent"] == "bill_text"
    assert bill_text_data["auth_required"] is False
    assert bill_text_data["source"] == "llm"
    assert bill_text_data["confidence"] == 0.88

    listing = client.post(
        "/api/v1/ask/classify",
        json={"content": "What bills have impacted housing?"},
    )
    assert listing.status_code == 200
    assert listing.json()["data"]["intent"] == "topic_bills"
    assert listing.json()["data"]["auth_required"] is False

    legislators = client.post(
        "/api/v1/ask/classify",
        json={"content": "Which legislators support affordable housing?"},
    )
    assert legislators.status_code == 200
    assert legislators.json()["data"]["intent"] == "topic_legislators"
    assert legislators.json()["data"]["auth_required"] is False

    vote = client.post(
        "/api/v1/ask/classify",
        json={"content": "How did my legislator vote on cannabis?"},
    )
    assert vote.status_code == 200
    assert vote.json()["data"]["intent"] == "legislator_vote"
    assert vote.json()["data"]["auth_required"] is False

    refusal = client.post(
        "/api/v1/ask/classify",
        json={"content": "write me a poem"},
    )
    assert refusal.status_code == 200
    assert refusal.json()["data"]["intent"] == "refuse"
    assert refusal.json()["data"]["auth_required"] is False

    assert len(calls) == 5


def test_ask_classify_falls_back_without_api_key(client, monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    def fail_post(*args, **kwargs):
        raise AssertionError("OpenAI must not be called on the fallback path")

    monkeypatch.setattr("alethical.api.services.ask_router.requests.post", fail_post)

    listing = client.post(
        "/api/v1/ask/classify",
        json={"content": "What bills affect affordable housing?"},
    )
    assert listing.status_code == 200
    assert listing.json()["data"]["intent"] == "topic_bills"
    assert listing.json()["data"]["source"] == "fallback"

    answer = client.post(
        "/api/v1/ask/classify",
        json={"content": "How does the paid-leave program work?"},
    )
    assert answer.status_code == 200
    assert answer.json()["data"]["intent"] == "bill_text"
    assert answer.json()["data"]["source"] == "fallback"


def test_ask_classify_rejects_empty_content(client):
    response = client.post("/api/v1/ask/classify", json={"content": "   "})
    assert response.status_code == 400


def test_ask_router_fallback_is_deterministic_and_offline(monkeypatch):
    from alethical.api.services.ask_router import AskIntent, classify_query

    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    assert (
        classify_query("What bills affect healthcare?").intent == AskIntent.TOPIC_BILLS
    )
    result = classify_query("What has Minnesota done about housing?")
    assert result.intent == AskIntent.BILL_TEXT
    assert result.source == "fallback"
    # The fallback never refuses or promises the vote path — those need the LLM.
    assert result.intent in {AskIntent.BILL_TEXT, AskIntent.TOPIC_BILLS}


def test_pick_bill_from_candidates_selects_valid_key_or_refuses(monkeypatch):
    """The LLM bill-picker (#266) returns only a candidate key or None: a valid
    pick resolves, 'none' and an out-of-list key both refuse, and an empty
    candidate list short-circuits without calling OpenAI (grounded rule 1)."""
    import json

    from alethical.api.services import ask_router

    monkeypatch.setenv("OPENAI_API_KEY", "test-openai-key")
    candidates = [
        ("94-2026-HF4138", "civil law; social media", "Chapter number", "Minors."),
        ("94-2026-SF4696", "companion", "in committee", "Companion."),
    ]

    def stub(pick):
        class _R:
            def raise_for_status(self):
                return None

            def json(self):
                return {"output_text": json.dumps({"bill_key": pick})}

        monkeypatch.setattr(
            "alethical.api.services.ask_router.requests.post", lambda *a, **k: _R()
        )

    stub("94-2026-HF4138")
    assert (
        ask_router.pick_bill_from_candidates("the law", candidates) == "94-2026-HF4138"
    )
    stub("none")
    assert ask_router.pick_bill_from_candidates("the law", candidates) is None
    stub("99-9999-XX0000")  # a key not in the list must not be trusted
    assert ask_router.pick_bill_from_candidates("the law", candidates) is None
    # No candidates → no OpenAI call, no resolution.
    monkeypatch.setattr(
        "alethical.api.services.ask_router.requests.post",
        lambda *a, **k: (_ for _ in ()).throw(AssertionError("must not call OpenAI")),
    )
    assert ask_router.pick_bill_from_candidates("the law", []) is None


def test_ask_router_fallback_extracts_topic(monkeypatch):
    from alethical.api.services.ask_router import classify_query

    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    assert classify_query("What bills affect healthcare?").topic == "healthcare"
    assert classify_query("What bills have impacted housing?").topic == "housing"
    assert classify_query("List the laws passed on paid leave.").topic == "paid leave"
    assert (
        classify_query("What bills affect economic development?").topic
        == "economic development"
    )
    # Non-topic classifications carry no topic.
    assert classify_query("How does the paid-leave program work?").topic is None


def test_ask_answers_topic_bills_question_with_cited_list(client, monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    response = client.post(
        "/api/v1/ask",
        json={"content": "What bills affect economic development?"},
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["intent"] == "topic_bills"
    assert data["source"] == "fallback"

    answer = data["answer"]
    assert answer["topic"] == "economic development"
    assert answer["session"]["slug"] == "94-2025-regular"
    assert "data_as_of" in answer
    assert answer["total_matches"] >= 1
    assert 1 <= len(answer["bills"]) <= 6
    assert answer["total_matches"] >= len(answer["bills"])

    bill_ids = [bill["id"] for bill in answer["bills"]]
    assert "94-2025-SF1832" in bill_ids
    for bill in answer["bills"]:
        # Cite-or-refuse: every card is its own citation, with a summary line.
        assert bill["official_url"]
        assert bill["ai_analysis"]["summary"]

    # Deterministic re-run — the ?q= share link must re-render identically.
    again = client.post(
        "/api/v1/ask",
        json={"content": "What bills affect economic development?"},
    )
    assert again.json()["data"] == data


def test_ask_zero_match_topic_returns_no_matches_payload(client, monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    response = client.post(
        "/api/v1/ask",
        json={"content": "What bills affect healthcare?"},
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["intent"] == "topic_bills"
    # In-scope topic, zero matches: distinct NO MATCHES payload, never a
    # normal answer with nothing to cite.
    answer = data["answer"]
    assert answer["topic"] == "healthcare"
    assert answer["total_matches"] == 0
    assert answer["bills"] == []


def test_ask_non_topic_bills_intent_returns_no_answer(client, monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    response = client.post(
        "/api/v1/ask",
        json={"content": "How does the paid-leave program work?"},
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["intent"] == "bill_text"
    assert data["answer"] is None


def test_ask_rejects_empty_content(client):
    response = client.post("/api/v1/ask", json={"content": "   "})
    assert response.status_code == 400


def test_bill_scoped_chat_missing_chunks_returns_grounded_fallback(
    client, auth_headers, monkeypatch
):
    from sqlalchemy import select

    from alethical.db.schema import load_schema
    from alethical.db.session import get_session_factory

    schema = load_schema()
    missing_chunks_bill_key = "94-2025-HF9901"
    with get_session_factory()() as db:
        session_row = db.scalar(
            select(schema.LegislativeSession).where(
                schema.LegislativeSession.slug == "94-2025-regular"
            )
        )
        chamber = db.scalar(
            select(schema.Chamber).where(schema.Chamber.slug == "house")
        )
        assert session_row is not None
        assert chamber is not None
        bill = db.scalar(
            select(schema.Bill).where(schema.Bill.bill_key == missing_chunks_bill_key)
        )
        if bill is None:
            db.add(
                schema.Bill(
                    session_id=session_row.id,
                    chamber_id=chamber.id,
                    bill_key=missing_chunks_bill_key,
                    file_type="HF",
                    file_number=9901,
                    title="No chunks test bill",
                    description="Fixture bill with no RAG chunks",
                    official_url="https://example.test/hf9901",
                    is_omnibus=False,
                )
            )
            db.commit()

    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    create_session_response = client.post(
        "/api/v1/me/chat-sessions",
        json={"title": "No chunks bill", "subject_bill_id": missing_chunks_bill_key},
        headers=auth_headers,
    )
    assert create_session_response.status_code == 201
    session_id = create_session_response.json()["data"]["id"]

    send_message_response = client.post(
        f"/api/v1/me/chat-sessions/{session_id}/messages",
        json={"content": "What does this bill do?", "stream": False},
        headers=auth_headers,
    )
    assert send_message_response.status_code == 201
    assistant_message = send_message_response.json()["data"]["assistant_message"]
    assert assistant_message["content"] == (
        "I could not find retrieval-ready bill text for this bill yet, so I cannot give a grounded answer."
    )
    assert assistant_message["citations"] == []


def test_supporting_public_resources_and_saved_places(client, auth_headers):
    sessions_response = client.get("/api/v1/sessions")
    assert sessions_response.status_code == 200
    assert len(sessions_response.json()["data"]) >= 1

    current_session_response = client.get("/api/v1/sessions/current")
    assert current_session_response.status_code == 200
    assert current_session_response.json()["data"]["is_current"] is True

    actions_response = client.get("/api/v1/bills/94-2025-SF1832/actions")
    assert actions_response.status_code == 200
    assert len(actions_response.json()["data"]) >= 1

    versions_response = client.get("/api/v1/bills/94-2025-SF1832/versions")
    assert versions_response.status_code == 200
    versions_payload = versions_response.json()["data"]
    assert len(versions_payload) >= 1
    version_code = versions_payload[0]["version_code"]

    version_text_response = client.get(
        f"/api/v1/bills/94-2025-SF1832/versions/{version_code}/text",
        params={"format": "structured"},
    )
    assert version_text_response.status_code == 200
    assert len(version_text_response.json()["data"]["sections"]) >= 1

    votes_response = client.get("/api/v1/bills/94-2025-SF1832/votes")
    assert votes_response.status_code == 200
    assert isinstance(votes_response.json()["data"], list)

    districts_response = client.get("/api/v1/districts")
    assert districts_response.status_code == 200
    district_payload = districts_response.json()["data"][0]
    district_id = district_payload["id"]

    district_legislators_response = client.get(
        f"/api/v1/districts/{district_id}/legislators",
        params={"session": "94-2025-regular"},
    )
    assert district_legislators_response.status_code == 200
    assert isinstance(district_legislators_response.json()["data"], list)

    saved_places_response = client.get("/api/v1/me/saved-places", headers=auth_headers)
    assert saved_places_response.status_code == 200
    original_count = len(saved_places_response.json()["data"])

    create_place_response = client.post(
        "/api/v1/me/saved-places",
        json={
            "label": "Capitol",
            "address_text": "Saint Paul, MN",
            "is_default": False,
        },
        headers=auth_headers,
    )
    assert create_place_response.status_code == 201
    place_payload = create_place_response.json()["data"]
    place_id = place_payload["id"]
    assert place_payload["label"] == "Capitol"

    patch_place_response = client.patch(
        f"/api/v1/me/saved-places/{place_id}",
        json={"label": "State Capitol"},
        headers=auth_headers,
    )
    assert patch_place_response.status_code == 200
    assert patch_place_response.json()["data"]["label"] == "State Capitol"

    delete_place_response = client.delete(
        f"/api/v1/me/saved-places/{place_id}", headers=auth_headers
    )
    assert delete_place_response.status_code == 204

    final_places_response = client.get("/api/v1/me/saved-places", headers=auth_headers)
    assert final_places_response.status_code == 200
    assert len(final_places_response.json()["data"]) == original_count


def test_problem_details_and_internal_operations_routes(client, internal_headers):
    auth_required_response = client.get("/api/v1/me")
    assert auth_required_response.status_code == 401
    auth_problem = auth_required_response.json()
    assert auth_problem["type"].endswith("/unauthorized")
    assert auth_problem["status"] == 401

    missing_bill_response = client.get("/api/v1/bills/does-not-exist")
    assert missing_bill_response.status_code == 404
    missing_bill_problem = missing_bill_response.json()
    assert missing_bill_problem["title"] == "Not Found"
    assert missing_bill_problem["status"] == 404

    ingestion_runs_response = client.get(
        "/internal/v1/ingestion-runs", headers=internal_headers
    )
    assert ingestion_runs_response.status_code == 200
    assert isinstance(ingestion_runs_response.json()["data"], list)

    oban_jobs_response = client.get("/internal/v1/oban/jobs", headers=internal_headers)
    assert oban_jobs_response.status_code == 200
    assert "installed" in oban_jobs_response.json()["data"]

    oban_dashboard_response = client.get("/internal/v1/oban", headers=internal_headers)
    assert oban_dashboard_response.status_code == 200
    assert "Oban Jobs" in oban_dashboard_response.text


def test_authenticated_surfaces_reject_anonymous_requests(client):
    protected_requests = [
        ("get", "/api/v1/me", None),
        ("get", "/api/v1/me/tracked-bills", None),
        (
            "put",
            "/api/v1/me/tracked-bills/94-2025-SF1832",
            {"alerts_enabled": True, "note": None},
        ),
        ("get", "/api/v1/me/chat-sessions", None),
        (
            "post",
            "/api/v1/me/chat-sessions",
            {"title": "Private chat", "subject_bill_id": None},
        ),
        ("get", "/api/v1/me/notification-preferences", None),
        ("get", "/api/v1/me/saved-places", None),
    ]

    for method, path, json_body in protected_requests:
        response = (
            getattr(client, method)(path, json=json_body)
            if json_body is not None
            else getattr(client, method)(path)
        )
        assert response.status_code == 401, path
        payload = response.json()
        assert payload["title"] == "Unauthorized"
        assert payload["status"] == 401


def test_tracking_include_requires_authentication_but_public_surfaces_stay_open(
    client, auth_headers
):
    public_bills_response = client.get(
        "/api/v1/bills", params={"session": "94-2025-regular"}
    )
    assert public_bills_response.status_code == 200
    assert "tracked" not in public_bills_response.json()["data"][0]

    anonymous_tracking_response = client.get(
        "/api/v1/bills",
        params={"session": "94-2025-regular", "include": "tracking"},
    )
    assert anonymous_tracking_response.status_code == 401
    assert (
        anonymous_tracking_response.json()["detail"]
        == "Authentication required to include tracking state"
    )

    anonymous_detail_tracking_response = client.get(
        "/api/v1/bills/94-2025-SF1832",
        params={"include": "tracking"},
    )
    assert anonymous_detail_tracking_response.status_code == 401

    authed_tracking_response = client.get(
        "/api/v1/bills",
        params={"session": "94-2025-regular", "include": "tracking"},
        headers=auth_headers,
    )
    assert authed_tracking_response.status_code == 200
    assert "tracked" in authed_tracking_response.json()["data"][0]

    lookup_response = client.post(
        "/api/v1/representative-lookups",
        json={"address_text": "75 Rev Dr Martin Luther King Jr Blvd, Saint Paul, MN"},
    )
    assert lookup_response.status_code == 200


def test_public_bill_reads_are_cacheable_but_user_varying_reads_are_not(
    client, auth_headers
):
    """Anonymous record reads carry a public, shared-cacheable Cache-Control so a
    browser/CDN can absorb repeat loads; responses that vary by user (tracking
    state) are never cached."""
    public = "public, max-age=60, stale-while-revalidate=300"

    list_response = client.get("/api/v1/bills", params={"session": "94-2025-regular"})
    assert list_response.status_code == 200
    assert list_response.headers["Cache-Control"] == public

    detail_response = client.get("/api/v1/bills/94-2025-SF1832")
    assert detail_response.status_code == 200
    assert detail_response.headers["Cache-Control"] == public

    votes_response = client.get("/api/v1/bills/94-2025-SF1832/votes")
    assert votes_response.status_code == 200
    assert votes_response.headers["Cache-Control"] == public

    # Authenticated tracking include returns per-user state → must not be cached.
    tracked_list_response = client.get(
        "/api/v1/bills",
        params={"session": "94-2025-regular", "include": "tracking"},
        headers=auth_headers,
    )
    assert tracked_list_response.status_code == 200
    assert tracked_list_response.headers["Cache-Control"] == "private, no-store"


def test_internal_routes_require_internal_token(client, internal_headers):
    missing_token_response = client.get("/internal/v1/ingestion-runs")
    assert missing_token_response.status_code == 401
    assert missing_token_response.json()["detail"] == "Valid internal token required"

    invalid_token_response = client.get(
        "/internal/v1/ingestion-runs",
        headers={"X-Internal-Token": "not-the-token"},
    )
    assert invalid_token_response.status_code == 401

    valid_token_response = client.get(
        "/internal/v1/ingestion-runs", headers=internal_headers
    )
    assert valid_token_response.status_code == 200


def test_internal_token_fails_closed_when_unset(client, monkeypatch):
    # With INTERNAL_API_TOKEN unset, the endpoint must reject every request —
    # the old guessable "dev-internal-token" default no longer grants access (#97).
    monkeypatch.delenv("INTERNAL_API_TOKEN", raising=False)
    response = client.get(
        "/internal/v1/ingestion-runs",
        headers={"X-Internal-Token": "dev-internal-token"},
    )
    assert response.status_code == 401


def test_internal_dashboard_rejects_query_param_token(client, internal_headers):
    from alethical.tests.conftest import TEST_INTERNAL_TOKEN

    # The Oban dashboard no longer accepts the token as a query param (it leaks
    # into logs/proxies) — the correct token in ?token= must be rejected (#97).
    query_only = client.get(f"/internal/v1/oban?token={TEST_INTERNAL_TOKEN}")
    assert query_only.status_code == 401

    # The header path still works.
    header_response = client.get("/internal/v1/oban", headers=internal_headers)
    assert header_response.status_code == 200


def test_dev_auth_token_refused_when_target_is_production(monkeypatch):
    # A static dev bypass token must never be active against production (#97).
    from alethical.api.services import auth as auth_module

    monkeypatch.setenv("ALETHICAL_DEV_AUTH_TOKEN", "some-dev-token")
    monkeypatch.setenv("ALETHICAL_DATABASE_TARGET", "production")
    auth_module.get_supabase_auth_service.cache_clear()
    try:
        with pytest.raises(RuntimeError, match="ALETHICAL_DEV_AUTH_TOKEN"):
            auth_module.get_supabase_auth_service()
    finally:
        auth_module.get_supabase_auth_service.cache_clear()


def _force_router(monkeypatch, intent: str, topic: str | None = None):
    """Force the LLM router to return a fixed intent (+topic) — the offline
    fallback can't emit topic_legislators, so drive it through the LLM path."""
    import json as _json

    monkeypatch.setenv("OPENAI_API_KEY", "test-openai-key")

    body: dict = {"intent": intent, "confidence": 0.9}
    if topic is not None:
        body["topic"] = topic

    class _Resp:
        def raise_for_status(self):
            return None

        def json(self):
            return {"output_text": _json.dumps(body)}

    monkeypatch.setattr(
        "alethical.api.services.ask_router.requests.post",
        lambda *a, **k: _Resp(),
    )


def test_ask_answers_topic_legislators_question_grouped_by_chamber(client, monkeypatch):
    _force_router(monkeypatch, "topic_legislators", topic="economic development")

    response = client.post(
        "/api/v1/ask",
        json={"content": "Which legislators support economic development?"},
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["intent"] == "topic_legislators"

    answer = data["answer"]
    assert answer["topic"] == "economic development"
    assert answer["session"]["slug"] == "94-2025-regular"
    assert answer["total_bills"] >= 1

    by_name = {row["full_name"]: row for row in answer["legislators"]}
    # SF 1832 (economic development) has chief authors Pinto (House) + Champion (Senate).
    assert "Pinto" in by_name and "Champion" in by_name
    assert answer["total_matches"] == len(answer["legislators"]) == 2

    pinto = by_name["Pinto"]
    assert pinto["authored_count"] == 1
    assert pinto["coauthored_count"] == 0
    assert pinto["chamber"] == "house"
    # The authorship claim is grounded in the underlying bill (its citation).
    assert any(
        bill["file_type"] == "SF" and bill["file_number"] == 1832
        for bill in pinto["bills"]
    )

    # Deterministic re-run for the shareable ?q= link.
    again = client.post(
        "/api/v1/ask",
        json={"content": "Which legislators support economic development?"},
    )
    assert again.json()["data"] == data


def test_ask_topic_legislators_zero_match_returns_no_matches(client, monkeypatch):
    _force_router(monkeypatch, "topic_legislators", topic="healthcare")

    response = client.post(
        "/api/v1/ask",
        json={"content": "Which legislators support healthcare?"},
    )
    assert response.status_code == 200
    answer = response.json()["data"]["answer"]
    assert answer["topic"] == "healthcare"
    assert answer["total_matches"] == 0
    assert answer["legislators"] == []


def test_ask_response_schema_is_strict_valid():
    # OpenAI strict json_schema requires `required` to list every property, or
    # the live classify call 502s (regression guard for that latent bug).
    from alethical.api.services.ask_router import _RESPONSE_SCHEMA

    assert set(_RESPONSE_SCHEMA["required"]) == set(_RESPONSE_SCHEMA["properties"])
    assert _RESPONSE_SCHEMA["additionalProperties"] is False


def test_sliding_window_limiter_enforces_limit_and_recovers():
    from alethical.api.rate_limit import SlidingWindowLimiter

    limiter = SlidingWindowLimiter(max_requests=2, window_seconds=10.0)
    assert limiter.allow("client-a", now=100.0) is True
    assert limiter.allow("client-a", now=100.5) is True
    # Third hit inside the 10s window is blocked...
    assert limiter.allow("client-a", now=101.0) is False
    # ...a different key is unaffected...
    assert limiter.allow("client-b", now=101.0) is True
    # ...and once the first hit ages out of the window, the client recovers.
    assert limiter.allow("client-a", now=111.0) is True


def test_client_ip_prefers_forwarded_header_over_proxy_socket():
    from starlette.requests import Request

    from alethical.api.rate_limit import client_ip

    # Behind Railway's proxy every request's socket peer is the proxy, so the
    # limiter must key on the left-most X-Forwarded-For entry or it throttles
    # all users as one bucket.
    forwarded = Request(
        {
            "type": "http",
            "headers": [(b"x-forwarded-for", b"203.0.113.7, 10.0.0.1")],
            "client": ("10.0.0.1", 0),
        }
    )
    assert client_ip(forwarded) == "203.0.113.7"

    direct = Request({"type": "http", "headers": [], "client": ("198.51.100.9", 0)})
    assert client_ip(direct) == "198.51.100.9"


def test_ask_endpoint_enforces_rate_limit(client, monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)  # offline fallback; no network
    limit = client.app.state.ask_limiter.max_requests
    payload = {"content": "What bills affect economic development?"}

    for _ in range(limit):
        assert client.post("/api/v1/ask", json=payload).status_code == 200

    blocked = client.post("/api/v1/ask", json=payload)
    assert blocked.status_code == 429
    body = blocked.json()
    assert body["status"] == 429
    assert body["title"] == "Too Many Requests"
    assert body["type"].endswith("/rate-limited")


def test_representative_lookup_enforces_rate_limit(client):
    limit = client.app.state.lookup_limiter.max_requests
    payload = {"address_text": "75 Rev Dr Martin Luther King Jr Blvd, Saint Paul, MN"}

    for _ in range(limit):
        assert (
            client.post("/api/v1/representative-lookups", json=payload).status_code
            == 200
        )

    blocked = client.post("/api/v1/representative-lookups", json=payload)
    assert blocked.status_code == 429
    assert blocked.json()["title"] == "Too Many Requests"


def test_ask_classifier_degrades_to_fallback_when_openai_errors(client, monkeypatch):
    # Live outage guard: a failing OpenAI classify call must degrade to the
    # offline heuristic (source="fallback"), never 502 the whole endpoint.
    monkeypatch.setenv("OPENAI_API_KEY", "test-openai-key")

    def boom(*args, **kwargs):
        raise requests.ConnectionError("openai unreachable")

    monkeypatch.setattr("alethical.api.services.ask_router.requests.post", boom)

    from alethical.api.services.ask_router import AskIntent, classify_query

    result = classify_query("What bills affect economic development?")
    assert result.source == "fallback"
    assert result.intent == AskIntent.TOPIC_BILLS

    response = client.post(
        "/api/v1/ask",
        json={"content": "What bills affect economic development?"},
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["source"] == "fallback"
    assert data["intent"] == "topic_bills"
    assert data["answer"]["total_matches"] >= 1


def test_ask_classifier_degrades_to_fallback_on_unparseable_response(
    client, monkeypatch
):
    monkeypatch.setenv("OPENAI_API_KEY", "test-openai-key")

    class _Empty:
        def raise_for_status(self):
            return None

        def json(self):
            return {}  # no output_text/output → nothing to parse

    monkeypatch.setattr(
        "alethical.api.services.ask_router.requests.post", lambda *a, **k: _Empty()
    )

    response = client.post(
        "/api/v1/ask",
        json={"content": "What bills affect economic development?"},
    )
    assert response.status_code == 200
    assert response.json()["data"]["source"] == "fallback"


PROGRESS_SORT_SESSION_SLUG = "test-progress-sort-fixture"


def _seed_progress_sort_bills(schema) -> str:
    """Idempotently seed one listed bill per legislative stage (plus a
    same-stage recency pair) into a dedicated, isolated legislative session so
    the fixtures never leak into the shared ``94-2025-regular`` list other
    tests query. Returns the dedicated session slug."""
    from datetime import datetime, timezone

    from sqlalchemy import select

    from alethical.db.session import get_session_factory

    # current_status string -> expected status_key (bill_status_key_from_summary),
    # file_number, latest_action_at. Chosen so each maps unambiguously and the
    # veto/governor priority (veto wins) is exercised.
    fixtures = [
        (
            "Governor approval; chapter number 45",
            "signed_into_law",
            90001,
            datetime(2025, 3, 1, tzinfo=timezone.utc),
        ),
        (
            "Vetoed by the Governor",
            "vetoed",
            90002,
            datetime(2025, 3, 2, tzinfo=timezone.utc),
        ),
        (
            "Passed the senate on third reading",
            "passed_senate",
            90003,
            datetime(2025, 3, 3, tzinfo=timezone.utc),
        ),
        (
            "Third reading passed",
            "passed_house",
            90004,
            datetime(2025, 3, 4, tzinfo=timezone.utc),
        ),
        (
            "Referred to committee on education",
            "in_committee",
            90005,
            datetime(2025, 1, 10, tzinfo=timezone.utc),
        ),
        (
            "Second reading and referred to committee",
            "in_committee",
            90006,
            datetime(2025, 2, 20, tzinfo=timezone.utc),
        ),
        (
            "Introduction and first reading",
            "proposed",
            90007,
            datetime(2025, 1, 5, tzinfo=timezone.utc),
        ),
    ]
    with get_session_factory()() as db:
        base_session = db.scalar(
            select(schema.LegislativeSession).where(
                schema.LegislativeSession.slug == "94-2025-regular"
            )
        )
        chamber = db.scalar(
            select(schema.Chamber).where(schema.Chamber.slug == "house")
        )
        assert base_session is not None and chamber is not None
        session_row = db.scalar(
            select(schema.LegislativeSession).where(
                schema.LegislativeSession.slug == PROGRESS_SORT_SESSION_SLUG
            )
        )
        if session_row is None:
            session_row = schema.LegislativeSession(
                jurisdiction_id=base_session.jurisdiction_id,
                slug=PROGRESS_SORT_SESSION_SLUG,
                session_number=9999,
                session_type=schema.SessionType.regular,
                year_start=2999,
                year_end=3000,
                name="Progress-sort fixture session",
                is_current=False,
            )
            db.add(session_row)
            db.flush()
        for current_status, _expected_key, file_number, latest_action_at in fixtures:
            bill_key = f"{PROGRESS_SORT_SESSION_SLUG}-HF{file_number}"
            existing = db.scalar(
                select(schema.Bill).where(schema.Bill.bill_key == bill_key)
            )
            if existing is not None:
                continue
            bill = schema.Bill(
                session_id=session_row.id,
                chamber_id=chamber.id,
                bill_key=bill_key,
                file_type="HF",
                file_number=file_number,
                title=f"Progress-sort fixture HF{file_number}",
                description="Progress-sort fixture bill",
                current_status=current_status,
                latest_action_at=latest_action_at,
                official_url=f"https://example.test/hf{file_number}",
                is_omnibus=False,
            )
            db.add(bill)
            db.flush()
            db.add(
                schema.AIEnrichment(
                    bill_id=bill.id,
                    enrichment_type=schema.EnrichmentType.bill_summary,
                    model_name="test-fixture",
                    content_json={"summary": "Fixture summary."},
                    is_current=True,
                )
            )
        db.commit()
    return PROGRESS_SORT_SESSION_SLUG


def test_bills_sort_progress_orders_by_stage_then_recency(client):
    from alethical.db.schema import load_schema

    session_slug = _seed_progress_sort_bills(load_schema())

    response = client.get(
        "/api/v1/bills",
        params={"session": session_slug, "sort": "progress", "limit": 100},
    )
    assert response.status_code == 200
    data = response.json()["data"]
    keys = [item["status_key"] for item in data]
    file_numbers = [item["file_number"] for item in data]

    # Stage rank: signed -> vetoed -> passed_senate -> passed_house ->
    # in_committee -> proposed. Ties broken by latest_action_at DESC.
    assert keys == [
        "signed_into_law",
        "vetoed",
        "passed_senate",
        "passed_house",
        "in_committee",
        "in_committee",
        "proposed",
    ]
    # Within the in_committee band, the more recent action sorts first.
    in_committee_files = [
        fn for fn, k in zip(file_numbers, keys) if k == "in_committee"
    ]
    assert in_committee_files == [90006, 90005]


def test_bills_sort_default_is_latest_action_unchanged(client):
    from alethical.db.schema import load_schema

    session_slug = _seed_progress_sort_bills(load_schema())

    default_response = client.get(
        "/api/v1/bills",
        params={"session": session_slug, "limit": 100},
    )
    latest_response = client.get(
        "/api/v1/bills",
        params={"session": session_slug, "sort": "latest_action", "limit": 100},
    )
    assert default_response.status_code == 200
    assert latest_response.status_code == 200
    default_files = [item["file_number"] for item in default_response.json()["data"]]
    latest_files = [item["file_number"] for item in latest_response.json()["data"]]

    # Default == explicit latest_action, and both order by latest_action_at DESC.
    assert default_files == latest_files
    assert default_files == [90004, 90003, 90002, 90001, 90006, 90005, 90007]


INTRODUCED_SORT_SESSION_SLUG = "test-introduced-sort-fixture"


def _seed_introduced_sort_bills(schema) -> str:
    """Seed listed bills whose introduction-date order is deliberately the
    REVERSE of their file-number order (plus one with no introduced_at) into an
    isolated session, so the sort=introduced assertion proves it orders by the
    real introduction date (#329), not the file-number recency proxy. Returns the
    dedicated session slug."""
    from datetime import datetime, timezone

    from sqlalchemy import select

    from alethical.db.session import get_session_factory

    # (file_number, introduced_at) — highest file number is the OLDEST intro, so
    # a file-number sort would invert the expected introduced-date order.
    fixtures = [
        (80001, datetime(2025, 3, 15, tzinfo=timezone.utc)),  # newest intro
        (80002, datetime(2025, 2, 1, tzinfo=timezone.utc)),
        (80003, datetime(2025, 1, 10, tzinfo=timezone.utc)),  # oldest intro
        (80004, None),  # no introduction date -> sorts last (nullslast)
    ]
    with get_session_factory()() as db:
        base_session = db.scalar(
            select(schema.LegislativeSession).where(
                schema.LegislativeSession.slug == "94-2025-regular"
            )
        )
        chamber = db.scalar(
            select(schema.Chamber).where(schema.Chamber.slug == "house")
        )
        assert base_session is not None and chamber is not None
        session_row = db.scalar(
            select(schema.LegislativeSession).where(
                schema.LegislativeSession.slug == INTRODUCED_SORT_SESSION_SLUG
            )
        )
        if session_row is None:
            session_row = schema.LegislativeSession(
                jurisdiction_id=base_session.jurisdiction_id,
                slug=INTRODUCED_SORT_SESSION_SLUG,
                session_number=9996,
                session_type=schema.SessionType.regular,
                year_start=2993,
                year_end=2994,
                name="Introduced-sort fixture session",
                is_current=False,
            )
            db.add(session_row)
            db.flush()
        for file_number, introduced_at in fixtures:
            bill_key = f"{INTRODUCED_SORT_SESSION_SLUG}-HF{file_number}"
            existing = db.scalar(
                select(schema.Bill).where(schema.Bill.bill_key == bill_key)
            )
            if existing is not None:
                continue
            bill = schema.Bill(
                session_id=session_row.id,
                chamber_id=chamber.id,
                bill_key=bill_key,
                file_type="HF",
                file_number=file_number,
                title=f"Introduced-sort fixture HF{file_number}",
                description="Introduced-sort fixture bill",
                current_status="Introduction and first reading",
                introduced_at=introduced_at,
                official_url=f"https://example.test/intro-hf{file_number}",
                is_omnibus=False,
            )
            db.add(bill)
            db.flush()
            db.add(
                schema.AIEnrichment(
                    bill_id=bill.id,
                    enrichment_type=schema.EnrichmentType.bill_summary,
                    model_name="test-fixture",
                    content_json={"summary": "Fixture summary."},
                    is_current=True,
                )
            )
        db.commit()
    return INTRODUCED_SORT_SESSION_SLUG


def test_bills_sort_introduced_orders_by_introduction_date_desc(client):
    from alethical.db.schema import load_schema

    session_slug = _seed_introduced_sort_bills(load_schema())

    response = client.get(
        "/api/v1/bills",
        params={"session": session_slug, "sort": "introduced", "limit": 100},
    )
    assert response.status_code == 200
    file_numbers = [item["file_number"] for item in response.json()["data"]]

    # introduced_at DESC (newest introduction first); the undated bill sorts last.
    # NOT file-number order (which would be 80004, 80003, 80002, 80001).
    assert file_numbers == [80001, 80002, 80003, 80004]


def test_bills_sort_rejects_unknown_value(client):
    response = client.get(
        "/api/v1/bills",
        params={"session": "94-2025-regular", "sort": "banana"},
    )
    assert response.status_code == 422


def test_bills_policy_area_canonical_filter_under_progress_sort(client):
    """A Search Bills chip sends a canonical issue (issue_taxonomy); the /bills
    filter matches every raw policy area that rolls up to it, returns 200 under
    the default sort=progress (no 502), and card badges render the same
    canonical label — so badges and filters share one vocabulary.

    SF2483's raw policy_areas ["higher education", "funding", "student aid",
    "appropriations"] roll up to Education / Government Finance / Student Aid."""
    response = client.get(
        "/api/v1/bills",
        params={
            "session": "94-2025-regular",
            "policy_area": "Education",
            "sort": "progress",
            "limit": 50,
        },
    )
    assert response.status_code == 200
    bills = response.json()["data"]
    assert bills
    # "higher education" rolls up to Education, so SF2483 matches — and its badge
    # shows the canonical "Education", never the raw "higher education".
    assert any(bill["file_number"] == 2483 for bill in bills)
    assert all("Education" in bill["ai_analysis"]["policy_areas"] for bill in bills)
    assert all(
        "higher education" not in bill["ai_analysis"]["policy_areas"] for bill in bills
    )


STATUS_FILTER_SESSION_SLUG = "test-status-filter-fixture"


def _seed_status_filter_bills(schema):
    """Idempotently seed one bill per displayed status badge — plus the
    dual-keyword bill that caused the reported bug — into a dedicated isolated
    session, so the status-filter isolation assertions never touch the shared
    ``94-2025-regular`` list. Returns ``(session_slug, {file_number: key})``.

    HF90108's ``current_status`` contains BOTH "introduction" (the old buggy
    ``proposed`` substring pattern) and "referred to committee", so its badge is
    ``in_committee``; it must be returned only by the ``in_committee`` filter,
    never by ``proposed`` ("Introduced") — the exact reported regression.
    """
    from datetime import datetime, timezone

    from sqlalchemy import select

    from alethical.db.session import get_session_factory

    fixtures = [
        ("Governor approval; chapter number 12", "signed_into_law", 90101),
        ("Vetoed by the Governor", "vetoed", 90102),
        ("Passed the senate on third reading", "passed_senate", 90103),
        ("Third reading passed", "passed_house", 90104),
        ("Referred to committee on education", "in_committee", 90105),
        ("Introduction and first reading", "proposed", 90107),
        (
            "Introduction and first reading, referred to committee on education",
            "in_committee",
            90108,
        ),
    ]
    with get_session_factory()() as db:
        base_session = db.scalar(
            select(schema.LegislativeSession).where(
                schema.LegislativeSession.slug == "94-2025-regular"
            )
        )
        chamber = db.scalar(
            select(schema.Chamber).where(schema.Chamber.slug == "house")
        )
        assert base_session is not None and chamber is not None
        session_row = db.scalar(
            select(schema.LegislativeSession).where(
                schema.LegislativeSession.slug == STATUS_FILTER_SESSION_SLUG
            )
        )
        if session_row is None:
            session_row = schema.LegislativeSession(
                jurisdiction_id=base_session.jurisdiction_id,
                slug=STATUS_FILTER_SESSION_SLUG,
                session_number=9998,
                session_type=schema.SessionType.regular,
                year_start=2997,
                year_end=2998,
                name="Status-filter fixture session",
                is_current=False,
            )
            db.add(session_row)
            db.flush()
        for current_status, _expected_key, file_number in fixtures:
            bill_key = f"{STATUS_FILTER_SESSION_SLUG}-HF{file_number}"
            existing = db.scalar(
                select(schema.Bill).where(schema.Bill.bill_key == bill_key)
            )
            if existing is not None:
                continue
            bill = schema.Bill(
                session_id=session_row.id,
                chamber_id=chamber.id,
                bill_key=bill_key,
                file_type="HF",
                file_number=file_number,
                title=f"Status-filter fixture HF{file_number}",
                description="Status-filter fixture bill",
                current_status=current_status,
                latest_action_at=datetime(2025, 1, 5, tzinfo=timezone.utc),
                official_url=f"https://example.test/status-hf{file_number}",
                is_omnibus=False,
            )
            db.add(bill)
            db.flush()
            # bill_list_stmt only surfaces bills with a current bill_summary
            # enrichment, so each fixture needs one to appear in the list.
            db.add(
                schema.AIEnrichment(
                    bill_id=bill.id,
                    enrichment_type=schema.EnrichmentType.bill_summary,
                    model_name="test-fixture",
                    content_json={"summary": "Fixture summary."},
                    is_current=True,
                )
            )
        db.commit()
    return STATUS_FILTER_SESSION_SLUG, {fn: key for _, key, fn in fixtures}


def test_bills_status_filter_isolates_results_to_selected_status(client):
    """Selecting a status returns only bills whose card badge equals that status,
    with mutually exclusive, exhaustive counts.

    Regression for the reported bug: the "Introduced" (value ``proposed``) filter
    returned bills badged "In Committee" because the filter and the badge used
    different classifications. Both now derive from ``bill_status_key_expr``, so
    each bill maps to exactly one status.
    """
    from alethical.db.schema import load_schema

    slug, expected_by_file = _seed_status_filter_bills(load_schema())

    status_values = [
        "proposed",
        "in_committee",
        "passed_house",
        "passed_senate",
        "signed_into_law",
        "vetoed",
    ]
    seen: dict[int, list[str]] = {}
    for status in status_values:
        response = client.get(
            "/api/v1/bills",
            params={"session": slug, "status": status, "limit": 100},
        )
        assert response.status_code == 200
        payload = response.json()
        returned = payload["data"]
        # Every returned bill's displayed badge equals the selected status.
        for bill in returned:
            assert bill["status_key"] == status, (
                status,
                bill["file_number"],
                bill["status_key"],
            )
        # The count equals exactly the fixtures with that badge — isolated,
        # not the old overlapping OR-substring total.
        expected_files = sorted(
            fn for fn, key in expected_by_file.items() if key == status
        )
        assert sorted(bill["file_number"] for bill in returned) == expected_files
        assert payload["page"]["total"] == len(expected_files)
        for bill in returned:
            seen.setdefault(bill["file_number"], []).append(status)

    # Mutual exclusivity: no seeded bill is returned under two statuses.
    for file_number in expected_by_file:
        assert seen.get(file_number, []) == [expected_by_file[file_number]], (
            file_number,
            seen.get(file_number),
        )

    # Reported regression, pinned: the dual-keyword bill appears only under
    # in_committee, never under proposed ("Introduced").
    assert seen[90108] == ["in_committee"]

    # Exhaustive: the six filters together return every seeded bill exactly once,
    # matching "All statuses" — no bill falls through every filter.
    all_response = client.get("/api/v1/bills", params={"session": slug, "limit": 100})
    all_files = {bill["file_number"] for bill in all_response.json()["data"]}
    assert all_files == set(seen) == set(expected_by_file)


ISSUE_TAXONOMY_SESSION_SLUG = "test-issue-taxonomy-fixture"


def _seed_mixed_case_policy_bills(schema):
    """Seed two bills whose policy areas collide only by case ("Taxation" vs
    "taxation") into a dedicated session, so the case-folding assertions never
    touch the shared list. Returns the session slug."""
    from datetime import datetime, timezone

    from sqlalchemy import select

    from alethical.db.session import get_session_factory

    # file_number -> raw policy_areas. Deliberately mixes synonyms and casing:
    # "Healthcare"/"public health"/"health care" all roll up to Health.
    fixtures = {
        90211: ["Healthcare", "public health", "Taxation"],
        90212: ["health care"],
    }
    with get_session_factory()() as db:
        base_session = db.scalar(
            select(schema.LegislativeSession).where(
                schema.LegislativeSession.slug == "94-2025-regular"
            )
        )
        chamber = db.scalar(
            select(schema.Chamber).where(schema.Chamber.slug == "house")
        )
        assert base_session is not None and chamber is not None
        session_row = db.scalar(
            select(schema.LegislativeSession).where(
                schema.LegislativeSession.slug == ISSUE_TAXONOMY_SESSION_SLUG
            )
        )
        if session_row is None:
            session_row = schema.LegislativeSession(
                jurisdiction_id=base_session.jurisdiction_id,
                slug=ISSUE_TAXONOMY_SESSION_SLUG,
                session_number=9990,
                session_type=schema.SessionType.regular,
                year_start=2995,
                year_end=2996,
                name="Issue-taxonomy fixture session",
                is_current=False,
            )
            db.add(session_row)
            db.flush()
        for file_number, policy_areas in fixtures.items():
            bill_key = f"{ISSUE_TAXONOMY_SESSION_SLUG}-HF{file_number}"
            if db.scalar(select(schema.Bill).where(schema.Bill.bill_key == bill_key)):
                continue
            bill = schema.Bill(
                session_id=session_row.id,
                chamber_id=chamber.id,
                bill_key=bill_key,
                file_type="HF",
                file_number=file_number,
                title=f"Issue-case fixture HF{file_number}",
                description="Issue-case fixture bill",
                current_status="Introduction and first reading",
                latest_action_at=datetime(2025, 1, 5, tzinfo=timezone.utc),
                official_url=f"https://example.test/issue-hf{file_number}",
                is_omnibus=False,
            )
            db.add(bill)
            db.flush()
            db.add(
                schema.AIEnrichment(
                    bill_id=bill.id,
                    enrichment_type=schema.EnrichmentType.bill_summary,
                    model_name="test-fixture",
                    content_json={
                        "summary": "Fixture summary.",
                        "policy_areas": policy_areas,
                    },
                    is_current=True,
                )
            )
        db.commit()
    return ISSUE_TAXONOMY_SESSION_SLUG


def test_policy_areas_roll_up_synonyms_to_canonical_issues(client):
    """Regression (Phase 2, #325): /policy-areas rolls synonymous/mixed-case raw
    values up to one canonical issue with a merged distinct-bill count; the
    /bills filter matches every raw value under that canonical; and card badges
    render the canonical label — so the chip count, the filtered total, and the
    badge all agree.

    "Healthcare" + "public health" (HF90211) and "health care" (HF90212) all
    roll up to Health, counting both bills; HF90211 also has Taxation.
    """
    from alethical.db.schema import load_schema

    slug = _seed_mixed_case_policy_bills(load_schema())

    areas = client.get("/api/v1/policy-areas", params={"session": slug})
    assert areas.status_code == 200
    by_name = {row["name"]: row["bill_count"] for row in areas.json()["data"]}
    # The three health synonyms collapse to one "Health" counting both bills;
    # no raw variant survives as its own issue.
    assert by_name.get("Health") == 2
    assert by_name.get("Taxation") == 1
    assert not (set(by_name) & {"healthcare", "health care", "public health"})

    # Filtering by the canonical issue (any casing) returns every rolled-up bill,
    # and the total equals the chip count — count and filter can't diverge.
    for value in ("Health", "health", "HEALTH"):
        resp = client.get(
            "/api/v1/bills",
            params={
                "session": slug,
                "policy_area": value,
                "sort": "progress",
                "limit": 50,
            },
        )
        assert resp.status_code == 200
        payload = resp.json()
        assert payload["page"]["total"] == 2
        assert {b["file_number"] for b in payload["data"]} == {90211, 90212}

    # Badges show the canonical label, deduped — HF90211's two health synonyms
    # become a single "Health" tag alongside "Taxation".
    hf90211 = next(b for b in payload["data"] if b["file_number"] == 90211)
    assert hf90211["ai_analysis"]["policy_areas"] == ["Health", "Taxation"]

    # A distinct canonical issue still isolates correctly.
    taxation = client.get(
        "/api/v1/bills",
        params={"session": slug, "policy_area": "Taxation", "limit": 50},
    )
    assert {b["file_number"] for b in taxation.json()["data"]} == {90211}


def test_bills_list_reports_co_author_count_by_role(client):
    """The /bills list item exposes co_author_count — a count of co_author-role
    sponsorships only, excluding the chief author and the distinct 'sponsor'
    role (grounded-answers rule 3). Feeds the Search Bills card's
    "+N co-authors" line (#295)."""
    from sqlalchemy import select

    from alethical.db.schema import load_schema
    from alethical.db.session import get_session_factory

    schema = load_schema()
    slug = "test-coauthor-count-fixture"
    bill_key = f"{slug}-HF7001"
    with get_session_factory()() as db:
        base = db.scalar(
            select(schema.LegislativeSession).where(
                schema.LegislativeSession.slug == "94-2025-regular"
            )
        )
        chamber = db.scalar(
            select(schema.Chamber).where(schema.Chamber.slug == "house")
        )
        assert base is not None and chamber is not None
        session_row = db.scalar(
            select(schema.LegislativeSession).where(
                schema.LegislativeSession.slug == slug
            )
        )
        if session_row is None:
            session_row = schema.LegislativeSession(
                jurisdiction_id=base.jurisdiction_id,
                slug=slug,
                session_number=9998,
                session_type=schema.SessionType.regular,
                year_start=2998,
                year_end=2999,
                name="Co-author count fixture session",
                is_current=False,
            )
            db.add(session_row)
            db.flush()
        if (
            db.scalar(select(schema.Bill).where(schema.Bill.bill_key == bill_key))
            is None
        ):
            bill = schema.Bill(
                session_id=session_row.id,
                chamber_id=chamber.id,
                bill_key=bill_key,
                file_type="HF",
                file_number=7001,
                title="Co-author count fixture",
                description="fixture",
                current_status="Introduction and first reading",
                official_url="https://example.test/hf7001",
                is_omnibus=False,
            )
            db.add(bill)
            db.flush()
            db.add(
                schema.AIEnrichment(
                    bill_id=bill.id,
                    enrichment_type=schema.EnrichmentType.bill_summary,
                    model_name="test-fixture",
                    content_json={"summary": "Fixture."},
                    is_current=True,
                )
            )
            roles = (
                [schema.SponsorshipRole.chief_author]
                + [schema.SponsorshipRole.co_author] * 3
                + [schema.SponsorshipRole.sponsor]
            )
            # A sponsorship needs a legislator or committee target
            # (ck_sponsorship_has_target); reuse existing roster legislators.
            legislators = db.scalars(select(schema.Legislator).limit(len(roles))).all()
            assert len(legislators) >= len(roles)
            for order, (role, legislator) in enumerate(zip(roles, legislators)):
                db.add(
                    schema.Sponsorship(
                        bill_id=bill.id,
                        legislator_id=legislator.id,
                        role=role,
                        source_order=order,
                    )
                )
            db.commit()

    response = client.get("/api/v1/bills", params={"session": slug, "limit": 100})
    assert response.status_code == 200
    items = {item["id"]: item for item in response.json()["data"]}
    assert bill_key in items
    assert items[bill_key]["co_author_count"] == 3
