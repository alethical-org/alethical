"""Reviewed sources stay authenticated and historical after withdrawal."""
# ruff: noqa: F811, F401

import pytest

from alethical.api.services import election_comparison_reads as reads
from alethical.api.routers import election_comparison as router
from alethical.pipeline import election_outcomes as outcomes
from alethical.pipeline import election_comparison as storage
from alethical.tests.finance_fixtures import finance_api, finance_db
from alethical.tests.test_election_outcomes import context, prepared, source_set


@pytest.mark.parametrize(
    ("media_type", "extension"),
    [
        ("application/pdf", "pdf"),
        ("text/html", "html"),
        ("application/json", "json"),
        ("text/plain", "txt"),
        ("untrusted/filename", "txt"),
    ],
)
def test_original_download_preserves_format_without_inline_execution(
    monkeypatch, media_type, extension
):
    monkeypatch.setattr(
        reads, "source_body", lambda *a, **k: (b"original", {"media_type": media_type})
    )
    response = router.source_download(
        election_key="election", source_hash="a" * 64, snapshot_id="b" * 64, db=None
    )
    assert response.body == b"original"
    assert response.headers["content-disposition"].endswith(f'.{extension}"')
    assert response.headers["content-disposition"].startswith("attachment;")
    assert response.headers["content-type"] == "application/octet-stream"
    assert response.headers["x-content-type-options"] == "nosniff"


@pytest.fixture
def api_context(finance_db, prepared, monkeypatch):
    value = context.__wrapped__(finance_db, prepared, monkeypatch)
    storage.publish_generation(finance_db, value[0].id, expected_previous=None)
    monkeypatch.setattr(reads, "raw_file_store_from_env", lambda: value[3])
    return value


def test_review_overlay_and_original_source_have_same_scope(
    finance_api, finance_db, api_context
):
    snapshot, race, candidate, store, request, evidence = api_context
    outcomes.record_decision(finance_db, **request)
    base = f"/api/v1/finance/elections/{snapshot.election_key}"
    response = finance_api.get(f"{base}/races/{race.id}").json()["data"]
    assert response["race"]["result_status"] == "certified"
    assert "Private" not in str(response)
    claim = next(
        c
        for c in response["race"]["candidates"]
        if c["candidate_id"] == candidate["candidate_id"]
    )
    assert claim["outcome"] == "elected"
    fingerprint = request["evidence"][0]["sha256"]
    url = f"{base}/sources/{fingerprint}"
    assert finance_api.get(url, params={"snapshot_id": snapshot.id}).status_code == 200
    lines = finance_api.get(
        url + "/lines", params={"snapshot_id": snapshot.id, "start": 3, "limit": 1}
    ).json()["data"]
    assert candidate["name"] in lines["lines"][0]["text"]
    finance_api.headers.pop("Authorization")
    assert finance_api.get(url, params={"snapshot_id": snapshot.id}).status_code in {
        401,
        403,
    }


def test_capture_alone_is_not_visible_and_withdrawn_source_stays_reachable(
    finance_api, finance_db, api_context
):
    snapshot, race, _, _, request, evidence = api_context
    url = f"/api/v1/finance/elections/{snapshot.election_key}/sources/{request['evidence'][0]['sha256']}"
    assert finance_api.get(url, params={"snapshot_id": snapshot.id}).status_code == 404
    first = outcomes.record_decision(finance_db, **request)
    request.update(
        decision="withdrawn",
        result_status="pending",
        candidate_outcomes=[],
        expected_previous_id=first.id,
        evidence=[evidence("withdrawal", 6)],
    )
    outcomes.record_decision(finance_db, **request)
    assert finance_api.get(url, params={"snapshot_id": snapshot.id}).status_code == 200
    assert finance_api.get(url, params={"snapshot_id": "f" * 64}).status_code == 404


def test_superseded_source_availability_changes_version_without_erasing_new_claim(
    finance_api, finance_db, api_context, monkeypatch
):
    snapshot, race, _, store, request, _ = api_context
    first = outcomes.record_decision(finance_db, **request)
    old_hash = request["evidence"][0]["sha256"]
    old_original = finance_db.get(outcomes.m.ElectionResultSource, old_hash)
    original_body = storage.read_source(store, old_original)
    source_url = request["evidence"][0]["url"]
    publisher_url = request["evidence"][0]["publisher_url"]
    publisher_body = storage.read_source(
        store,
        finance_db.get(
            outcomes.m.ElectionResultSource, request["evidence"][0]["publisher_sha256"]
        ),
    )
    monkeypatch.setattr(
        outcomes,
        "_download",
        lambda link, hosts: (
            original_body + b"A correction note\n"
            if link == source_url
            else publisher_body,
            link,
            "text/plain" if link == source_url else "text/html",
        ),
    )
    capture = outcomes.capture_source(
        finance_db,
        url=source_url,
        publisher_url=publisher_url,
        publisher_hosts=["www.sos.mn.gov"],
        authority=request["evidence"][0]["authority"],
        store=store,
    )
    from copy import deepcopy

    corrected = deepcopy(request)
    corrected["expected_previous_id"] = first.id
    for evidence in corrected["evidence"]:
        evidence.update(outcomes.capture_metadata(capture))
    outcomes.record_decision(finance_db, **corrected)
    before = outcomes.applicable_outcomes(finance_db, snapshot_id=snapshot.id)[race.id]
    url = f"/api/v1/finance/elections/{snapshot.election_key}/sources/{old_hash}"
    assert (
        finance_api.get(url, params={"snapshot_id": snapshot.id}).content
        == original_body
    )
    store.objects.pop(old_original.object_key)
    after = outcomes.applicable_outcomes(finance_db, snapshot_id=snapshot.id)[race.id]
    assert before["outcome_review"]["version"] != after["outcome_review"]["version"]
    assert after["result_status"] == "certified"
    assert after["outcome_review"]["state"] == "checked"
    assert before["candidates"] == after["candidates"]
