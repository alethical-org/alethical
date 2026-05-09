from __future__ import annotations


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


def test_bill_list_and_bill_detail_support_public_and_signed_in_views(client, auth_headers):
    public_response = client.get("/api/v1/bills", params={"session": "94-2025-regular"})
    assert public_response.status_code == 200
    public_payload = public_response.json()
    assert len(public_payload["data"]) >= 2
    first_bill = public_payload["data"][0]
    assert first_bill["id"].startswith("94-2025-")
    assert "tracked" not in first_bill
    assert "chief_sponsors" in first_bill

    authed_response = client.get(
        "/api/v1/bills",
        params={"session": "94-2025-regular", "include": "tracking"},
        headers=auth_headers,
    )
    assert authed_response.status_code == 200
    tracked_bill = next(item for item in authed_response.json()["data"] if item["tracked"]["is_tracked"])
    assert tracked_bill["tracked"]["is_tracked"] is True

    detail_response = client.get(
        "/api/v1/bills/94-2025-SF1832",
        params={"include": "all_sponsors,actions,versions,tracking,ai_summary"},
        headers=auth_headers,
    )
    assert detail_response.status_code == 200
    detail_payload = detail_response.json()["data"]
    assert detail_payload["id"] == "94-2025-SF1832"
    assert detail_payload["tracking"]["is_tracked"] is True
    assert isinstance(detail_payload["actions"], list)
    assert isinstance(detail_payload["versions"], list)
    assert isinstance(detail_payload["all_sponsors"], list)


def test_bill_detail_and_action_endpoints_expose_live_action_dates(client):
    detail_response = client.get(
        "/api/v1/bills/94-2025-SF1832",
        params={"include": "actions,versions,topics,ai_summary"},
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


def test_legislator_directory_profile_search_and_lookup_cover_user_story(client):
    directory_response = client.get("/api/v1/legislators", params={"session": "94-2025-regular"})
    assert directory_response.status_code == 200
    directory_payload = directory_response.json()
    assert len(directory_payload["data"]) >= 2
    first_legislator = directory_payload["data"][0]
    assert first_legislator["id"]
    assert first_legislator["current_service"]["district"]["code"]

    legislator_id = first_legislator["id"]
    profile_response = client.get(
        f"/api/v1/legislators/{legislator_id}",
        params={"session": "94-2025-regular", "include": "current_service,committees,stats"},
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

    search_response = client.get("/api/v1/search", params={"q": "jobs", "types": "bills,legislators"})
    assert search_response.status_code == 200
    search_payload = search_response.json()["data"]
    assert "bills" in search_payload
    assert "legislators" in search_payload

    lookup_response = client.post(
        "/api/v1/representative-lookups",
        json={"address_text": "75 Rev Dr Martin Luther King Jr Blvd, Saint Paul, MN"},
    )
    assert lookup_response.status_code == 200
    lookup_payload = lookup_response.json()["data"]
    assert lookup_payload["resolved_place"]["state_code"] == "MN"
    assert lookup_payload["house_legislator"] is not None
    assert lookup_payload["senate_legislator"] is not None


def test_legislator_directory_limit_search_no_results_and_missing_profile(client):
    limited_response = client.get("/api/v1/legislators", params={"session": "94-2025-regular", "limit": 1})
    assert limited_response.status_code == 200
    limited_payload = limited_response.json()
    assert len(limited_payload["data"]) == 1
    assert limited_payload["page"]["limit"] == 1

    matching_response = client.get("/api/v1/legislators", params={"q": "Howard", "limit": 10})
    assert matching_response.status_code == 200
    matching_names = [item["full_name"] for item in matching_response.json()["data"]]
    assert any("Howard" in name for name in matching_names)

    no_results_response = client.get("/api/v1/legislators", params={"q": "definitely-not-a-real-legislator"})
    assert no_results_response.status_code == 200
    assert no_results_response.json()["data"] == []

    missing_response = client.get("/api/v1/legislators/not-a-real-id")
    assert missing_response.status_code == 404
    missing_problem = missing_response.json()
    assert missing_problem["title"] == "Not Found"
    assert missing_problem["status"] == 404


def test_legislator_sponsored_bills_cover_empty_and_card_payload_shapes(client):
    empty_legislator_response = client.get("/api/v1/legislators", params={"q": "Howard", "limit": 1})
    assert empty_legislator_response.status_code == 200
    empty_legislator = empty_legislator_response.json()["data"][0]

    empty_bills_response = client.get(f"/api/v1/legislators/{empty_legislator['id']}/bills")
    assert empty_bills_response.status_code == 200
    assert empty_bills_response.json()["data"] == []

    sponsored_legislator_response = client.get("/api/v1/legislators", params={"q": "Fateh", "limit": 1})
    assert sponsored_legislator_response.status_code == 200
    sponsored_legislator = sponsored_legislator_response.json()["data"][0]

    sponsored_bills_response = client.get(f"/api/v1/legislators/{sponsored_legislator['id']}/bills")
    assert sponsored_bills_response.status_code == 200
    sponsored_bills = sponsored_bills_response.json()["data"]
    assert sponsored_bills
    first_bill = sponsored_bills[0]
    assert first_bill["id"].startswith("94-2025-")
    assert "chief_sponsors" in first_bill
    assert "stats" in first_bill


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

    delete_response = client.delete("/api/v1/me/tracked-bills/94-2025-SF2483", headers=auth_headers)
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

    prefs_response = client.get("/api/v1/me/notification-preferences", headers=auth_headers)
    assert prefs_response.status_code == 200
    assert len(prefs_response.json()["data"]) >= 1

    update_pref_response = client.put(
        "/api/v1/me/notification-preferences/email",
        json={"frequency": "daily_digest", "is_enabled": True},
        headers=auth_headers,
    )
    assert update_pref_response.status_code == 200
    assert update_pref_response.json()["data"]["channel"] == "email"


def test_signed_in_chat_session_and_message_flow(client, auth_headers):
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

    send_message_response = client.post(
        f"/api/v1/me/chat-sessions/{session_id}/messages",
        json={"content": "What does this bill do?", "stream": False},
        headers=auth_headers,
    )
    assert send_message_response.status_code == 201
    message_payload = send_message_response.json()["data"]
    assert message_payload["assistant_message"]["role"] == "assistant"
    assert len(message_payload["assistant_message"]["citations"]) >= 1

    transcript_response = client.get(
        f"/api/v1/me/chat-sessions/{session_id}/messages",
        headers=auth_headers,
    )
    assert transcript_response.status_code == 200
    transcript_payload = transcript_response.json()["data"]
    assert len(transcript_payload) >= 2


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
        json={"label": "Capitol", "address_text": "Saint Paul, MN", "is_default": False},
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

    delete_place_response = client.delete(f"/api/v1/me/saved-places/{place_id}", headers=auth_headers)
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

    ingestion_runs_response = client.get("/internal/v1/ingestion-runs", headers=internal_headers)
    assert ingestion_runs_response.status_code == 200
    assert isinstance(ingestion_runs_response.json()["data"], list)
