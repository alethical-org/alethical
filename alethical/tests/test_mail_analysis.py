"""Private extraction never turns OCR or matching names into facts."""

import pytest

from alethical.api.services.mail_analysis import disclosures
from alethical.api.services.mail_payer_sources import corroborate, related_records
from alethical.api.services import mail_analysis
from alethical.tests.test_mail_upload import session, draft, upload, storage as storage


def test_disclosure_preserves_source_and_flags_cropped_edge():
    line = {
        "text": "Paid for by Restore Sanity. Not authorized by a candidate",
        "confidence": 89,
        "box": [2, 90, 500, 110],
    }
    result = disclosures([line], 600, 200)
    assert result[0]["quote"] == line["text"]
    assert result[0]["payer_text"] == "Restore Sanity"
    assert result[0]["quality"] == "machine_read"
    assert result[0]["edge_warning"] is True


def test_missing_disclosure_is_never_reconstructed():
    assert (
        disclosures(
            [
                {
                    "text": "id for by Our America",
                    "confidence": 91,
                    "box": [0, 10, 250, 30],
                }
            ],
            600,
            200,
        )
        == []
    )


def test_multiple_disclosures_remain_separate():
    lines = [
        {"text": f"Paid for by {name}", "confidence": 90, "box": [20, 20, 300, 40]}
        for name in ("Our America", "Restore Sanity")
    ]
    assert [r["payer_text"] for r in disclosures(lines, 600, 200)] == [
        "Our America",
        "Restore Sanity",
    ]


@pytest.mark.usefixtures("storage")
def test_owned_results_queue_and_retry(client, monkeypatch):
    headers, _, _ = session(client)
    path = draft(client, headers)
    assert client.get(path + "/analysis", headers=headers).status_code == 409
    upload(client, path, headers, "front")
    upload(client, path, headers, "back")
    assert (
        client.post(
            path + "/submit", headers=headers, json={"likes_ad": False}
        ).status_code
        == 200
    )
    assert (
        client.get(path + "/analysis", headers=headers).json()["data"]["status"]
        == "pending"
    )
    other, _, _ = session(client)
    assert client.get(path + "/analysis", headers=other).status_code == 404
    assert client.post(path + "/analysis/retry", headers=other).status_code == 404
    monkeypatch.setattr(
        mail_analysis,
        "read_image",
        lambda _: {
            "status": "read",
            "text": "Paid for by Example",
            "disclosures": [],
            "complete": False,
        },
    )
    mail_analysis.drain_once()
    response = client.get(path + "/analysis", headers=headers)
    assert response.headers["cache-control"] == "private, no-store"
    result = response.json()["data"]
    assert result["status"] == "ready"
    assert len(result["sides"]) == 2
    assert result["payer_status"] == "not_found"
    assert result["matching_mailers"] == {"count": None, "basis": None}
    assert result["confirmed_entity_id"] is None
    assert "object_key" not in response.text
    # Completed analyses are never silently run again.
    monkeypatch.setattr(
        mail_analysis, "read_image", lambda _: (_ for _ in ()).throw(AssertionError())
    )
    mail_analysis.drain_once()
    assert client.get(path + "/analysis", headers=headers).json()["data"] == result


def test_official_match_requires_name_and_payer_address_not_name_alone():
    name = "the Republican Party of Minnesota"
    quote = "Paid for by the Republican Party of Minnesota. 7400 Metro Blvd Ste424 Edina MN55439"
    assert corroborate(name, quote, edge_warning=False, confidence=90) is None
    quote = "Paid for by the Republican Party of Minnesota. 7400 Metro Blvd Ste 424 Edina MN 55439"
    match = corroborate(name, quote, edge_warning=False, confidence=90)
    assert match["scope"] == "organization"
    assert match["basis"] == "printed_name_and_address"
    assert corroborate(name, name, edge_warning=False, confidence=95) is None
    assert corroborate(name, quote, edge_warning=True, confidence=95) is None
    assert corroborate(name, quote, edge_warning=False, confidence=70) is None


@pytest.mark.usefixtures("storage")
def test_failed_worker_recovers_without_unbounded_retries(client, monkeypatch):
    import uuid
    from datetime import datetime, timedelta, timezone
    from alethical.db.models import MailUploadAnalysis
    from alethical.db.session import get_session_factory

    headers, _, _ = session(client)
    path = draft(client, headers)
    upload(client, path, headers, "front")
    upload(client, path, headers, "back")
    client.post(path + "/submit", headers=headers, json={"likes_ad": True})
    submission_id = uuid.UUID(path.rsplit("/", 1)[1])
    with get_session_factory()() as db:
        db.add(
            MailUploadAnalysis(
                submission_id=submission_id,
                status="processing",
                attempts=3,
                started_at=datetime.now(timezone.utc) - timedelta(hours=1),
                result={},
            )
        )
        db.commit()
    monkeypatch.setattr(
        mail_analysis,
        "analyze",
        lambda *_: (_ for _ in ()).throw(AssertionError("must not retry")),
    )
    mail_analysis.drain_once()
    result = client.get(path + "/analysis", headers=headers).json()["data"]
    assert result["status"] == "failed"
    assert result["can_retry"] is False
    assert (
        client.post(path + "/analysis/retry", headers=headers).json()["data"]["status"]
        == "failed"
    )


def test_related_website_record_does_not_claim_the_funding_account():
    records = related_records("Paid for by Our America https://joinouramerica.org")
    assert records[0]["scope"] == "related_record"
    assert records[0]["registration_number"] == "30807"
    assert related_records("https://joinouramerica.org.attacker.example") == []
    assert related_records("https://notjoinouramerica.org") == []


@pytest.mark.usefixtures("storage")
def test_partial_retry_preserves_successful_side(client, monkeypatch):
    headers, _, _ = session(client)
    path = draft(client, headers)
    upload(client, path, headers, "front")
    upload(client, path, headers, "back")
    client.post(path + "/submit", headers=headers, json={"likes_ad": True})
    calls = []

    def first_read(path):
        calls.append(path.name)
        if path.name == "back":
            raise ValueError("unreadable")
        return {
            "status": "read",
            "text": "front text",
            "disclosures": [],
            "complete": False,
        }

    monkeypatch.setattr(mail_analysis, "read_image", first_read)
    mail_analysis.drain_once()
    assert calls == ["front", "back"]
    assert (
        client.get(path + "/analysis", headers=headers).json()["data"]["status"]
        == "partial"
    )
    client.post(path + "/analysis/retry", headers=headers)
    calls.clear()

    def recovered(path):
        calls.append(path.name)
        return {
            "status": "read",
            "text": "back text",
            "disclosures": [],
            "complete": False,
        }

    monkeypatch.setattr(mail_analysis, "read_image", recovered)
    mail_analysis.drain_once()
    assert calls == ["back"]
    result = client.get(path + "/analysis", headers=headers).json()["data"]
    assert result["status"] == "ready"
    assert result["sides"][0]["text"] == "front text"


@pytest.mark.usefixtures("storage")
def test_analysis_admin_route_keeps_existing_auth_boundary(client):
    import uuid

    assert (
        client.get(
            f"/api/v1/admin/mail-upload/submissions/{uuid.uuid4()}/analysis"
        ).status_code
        == 401
    )


@pytest.mark.usefixtures("storage")
def test_creative_count_keeps_submissions_retries_and_tests_distinct(client):
    import uuid
    from alethical.db.session import get_session_factory

    headers, _, _ = session(client)
    paths = []
    for _ in range(3):
        path = draft(client, headers)
        upload(client, path, headers, "front")
        upload(client, path, headers, "back")
        for _ in range(2):
            assert (
                client.post(
                    path + "/submit", headers=headers, json={"likes_ad": False}
                ).status_code
                == 200
            )
        paths.append(path)
    ids = [uuid.UUID(path.rsplit("/", 1)[1]) for path in paths]
    with get_session_factory()() as db:
        first = mail_analysis.assign_creative(
            db,
            ids[0],
            matching_submission_id=None,
            excluded=False,
            evidence="Both sides compared; this is a distinct creative version",
        )
        group = first.creative_id
        mail_analysis.assign_creative(
            db,
            ids[0],
            matching_submission_id=None,
            excluded=False,
            evidence="Both sides compared; this is a distinct creative version",
        )
        assert first.creative_id == group
        mail_analysis.assign_creative(
            db,
            ids[1],
            matching_submission_id=ids[0],
            excluded=False,
            evidence="Same payer and substantive content on both sides",
        )
        mail_analysis.assign_creative(
            db,
            ids[2],
            matching_submission_id=ids[0],
            excluded=True,
            evidence="Explicit synthetic verification submission",
        )
        db.commit()
    result = client.get(paths[0] + "/analysis", headers=headers).json()["data"]
    assert result["matching_mailers"] == {"count": 2, "basis": "reviewed_creative"}
    assert "history" not in result
    with get_session_factory()() as db:
        mail_analysis.assign_creative(
            db,
            ids[1],
            matching_submission_id=None,
            excluded=False,
            evidence="Changed substantive content; split into a distinct version",
        )
        db.commit()
    assert (
        client.get(paths[0] + "/analysis", headers=headers).json()["data"][
            "matching_mailers"
        ]["count"]
        == 1
    )
    assert (
        client.put(
            f"/api/v1/admin/mail-upload/submissions/{ids[0]}/analysis/creative",
            json={"evidence": "Unauthorized attempt to group private mail"},
        ).status_code
        == 401
    )


def test_later_rotation_timeout_retains_useful_first_read(tmp_path, monkeypatch):
    import subprocess
    from types import SimpleNamespace
    from PIL import Image

    path = tmp_path / "photo.png"
    Image.new("RGB", (100, 100), "white").save(path)
    raw = b"block_num\tpar_num\tline_num\tleft\ttop\twidth\theight\tconf\ttext\n1\t1\t1\t20\t20\t50\t10\t90\tUseful text\n"
    calls = 0

    def run(*args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 1:
            return SimpleNamespace(stdout=raw)
        raise subprocess.TimeoutExpired("tesseract", 25)

    monkeypatch.setattr(mail_analysis.subprocess, "run", run)
    result = mail_analysis.read_image(path)
    assert result["text"] == "Useful text"
    assert result["status"] == "partial"
    assert result["partial_reasons"] == ["reading_stopped"]
    assert result["complete"] is False


def test_public_record_encoding_preserves_amount_and_missing_values():
    from datetime import date
    from decimal import Decimal
    from alethical.api.services.mail_public_records import serializable

    encoded = serializable(
        {
            "amount": Decimal("9007199254740993.01"),
            "missing": None,
            "paid_on": date(2026, 10, 1),
        }
    )
    assert encoded == {
        "amount": "9007199254740993.01",
        "missing": None,
        "paid_on": "2026-10-01",
    }


def test_curated_candidates_remain_unconfirmed_and_keep_source_scope():
    from alethical.api.services.mail_payer_sources import sourced_candidates

    candidate = sourced_candidates("HEINTZEMAN FOR SENATE")[0]
    assert candidate["scope"] == "candidate_record"
    assert candidate["registration_number"] == "19205"
    assert (
        corroborate(
            "HEINTZEMAN FOR SENATE",
            "Paid for by HEINTZEMAN FOR SENATE",
            edge_warning=False,
            confidence=99,
        )
        is None
    )
    assert related_records("joinouramerica.org.")[0]["scope"] == "related_record"
    assert related_records("joinouramerica.org.evil.example") == []
