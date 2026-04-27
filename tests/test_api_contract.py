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
    tracked_bill = authed_response.json()["data"][0]
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


def test_signed_in_bill_tracking_and_notification_preferences(client, auth_headers):
    me_response = client.get("/api/v1/me", headers=auth_headers)
    assert me_response.status_code == 200
    assert me_response.json()["data"]["primary_email"] == "ada@example.com"

    tracked_response = client.get("/api/v1/me/tracked-bills", headers=auth_headers)
    assert tracked_response.status_code == 200
    tracked_payload = tracked_response.json()["data"]
    assert len(tracked_payload) >= 2

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
