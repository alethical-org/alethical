from __future__ import annotations

import requests

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
    assert omnibus_bills_response.json()["data"]

    committee_bills_response = client.get(
        "/api/v1/bills",
        params={"session": "94-2025-regular", "status": "in_committee", "limit": 20},
    )
    assert committee_bills_response.status_code == 200
    assert isinstance(committee_bills_response.json()["data"], list)

    economy_bills_response = client.get(
        "/api/v1/bills",
        params={"session": "94-2025-regular", "policy_area": "economic", "limit": 20},
    )
    assert economy_bills_response.status_code == 200
    economy_bills = economy_bills_response.json()["data"]
    assert economy_bills
    assert all(
        any("economic" in area for area in bill["ai_analysis"]["policy_areas"])
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
        "policy_areas": [
            "workforce development",
            "economic development",
            "labor policy",
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
