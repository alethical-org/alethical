"""Private extraction never turns OCR or matching names into facts."""

import pytest

from alethical.api.services.mail_analysis import disclosures
from alethical.api.services.mail_payer_sources import corroborate, related_records
from alethical.api.services import mail_analysis
from alethical.tests.test_mail_upload import session, draft, upload, storage as storage


@pytest.fixture(autouse=True)
def isolate_mail_queue(seed_database):
    """Each test owns its disposable database's mail queue, never a live store."""
    from sqlalchemy import delete
    from alethical.db import models as m
    from alethical.db.session import get_session_factory

    with get_session_factory()() as db:
        for model in (
            m.MailUploadAnalysis,
            m.MailUploadImage,
            m.MailUploadSubmission,
            m.MailUploadSession,
            m.MailUploadInvitation,
            m.MailUploadQuota,
        ):
            db.execute(delete(model))
        db.commit()


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
            ids[0],
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
    with get_session_factory()() as db:
        mail_analysis.assign_creative(
            db,
            ids[1],
            matching_submission_id=ids[0],
            excluded=False,
            evidence="Same payer and substantive content on both sides",
        )
        db.commit()
    assert (
        client.get(paths[0] + "/analysis", headers=headers).json()["data"][
            "matching_mailers"
        ]["count"]
        == 2
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
    assert (
        related_records("Paid for by Our America joinouramerica.org.")[0]["scope"]
        == "related_record"
    )
    assert related_records("joinouramerica.org.evil.example") == []


@pytest.mark.usefixtures("storage")
def test_failed_partial_retry_preserves_useful_text(client, monkeypatch):
    headers, _, _ = session(client)
    path = draft(client, headers)
    upload(client, path, headers, "front")
    upload(client, path, headers, "back")
    client.post(path + "/submit", headers=headers, json={"likes_ad": False})
    monkeypatch.setattr(
        mail_analysis,
        "read_image",
        lambda _: {
            "status": "partial",
            "text": "Previously readable partial text",
            "disclosures": [],
            "complete": False,
            "partial_reasons": ["reading_stopped"],
        },
    )
    mail_analysis.drain_once()
    client.post(path + "/analysis/retry", headers=headers)
    monkeypatch.setattr(
        mail_analysis, "read_image", lambda _: (_ for _ in ()).throw(TimeoutError())
    )
    mail_analysis.drain_once()
    result = client.get(path + "/analysis", headers=headers).json()["data"]
    assert result["status"] == "partial"
    assert all(
        side["text"] == "Previously readable partial text" for side in result["sides"]
    )
    assert all("retry_failed" in side["partial_reasons"] for side in result["sides"])


def test_later_crop_timeout_retains_successful_payer_read(tmp_path, monkeypatch):
    import subprocess
    import time
    from types import SimpleNamespace
    from PIL import Image

    image = Image.new("RGB", (600, 200), "white")
    quote = {
        "text": "Paid for by Our",
        "quote": "Paid for by Our",
        "payer_text": "Our",
        "confidence": 88,
        "box": [30, 30, 300, 50],
        "edge_warning": False,
    }
    raw = b"block_num\tpar_num\tline_num\tleft\ttop\twidth\theight\tconf\ttext\n1\t1\t1\t20\t20\t200\t10\t90\tPaid for by Our America.\n"
    calls = 0

    def run(*args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 1:
            return SimpleNamespace(stdout=raw)
        raise subprocess.TimeoutExpired("tesseract", 10)

    monkeypatch.setattr(mail_analysis.subprocess, "run", run)
    result = mail_analysis.refine_disclosure(
        image, quote, tmp_path, time.monotonic() + 90
    )
    assert result["payer_text"] == "Our America"
    assert result["crop"]["source_box"]
    assert result["refinement_incomplete"] is True


@pytest.mark.usefixtures("storage")
def test_transient_public_records_failure_can_recover_without_rereading_photos(
    client, monkeypatch
):
    headers, _, _ = session(client)
    path = draft(client, headers)
    upload(client, path, headers, "front")
    upload(client, path, headers, "back")
    client.post(path + "/submit", headers=headers, json={"likes_ad": False})
    monkeypatch.setattr(
        mail_analysis,
        "candidate_records",
        lambda *args: [{"registration_number": "41412", "scope": "candidate_record"}],
    )
    quote = {
        "quote": "Paid for by Restore Sanity",
        "payer_text": "Restore Sanity",
        "quality": "machine_read",
        "edge_warning": False,
        "box": [20, 20, 200, 50],
        "confidence": 90,
    }
    monkeypatch.setattr(
        mail_analysis,
        "read_image",
        lambda _: {
            "status": "read",
            "text": "Paid for by Restore Sanity",
            "disclosures": [quote],
            "complete": False,
        },
    )
    monkeypatch.setattr(
        mail_analysis,
        "public_records",
        lambda *args: (_ for _ in ()).throw(TimeoutError()),
    )
    mail_analysis.drain_once()
    result = client.get(path + "/analysis", headers=headers).json()["data"]
    assert result["status"] == "partial"
    assert result["can_retry"] is True
    client.post(path + "/analysis/retry", headers=headers)
    monkeypatch.setattr(
        mail_analysis,
        "read_image",
        lambda _: (_ for _ in ()).throw(AssertionError("must retain successful OCR")),
    )
    monkeypatch.setattr(
        mail_analysis,
        "public_records",
        lambda *args: {"state": "available", "registration_number": "41412"},
    )
    mail_analysis.drain_once()
    result = client.get(path + "/analysis", headers=headers).json()["data"]
    assert result["status"] == "ready"
    assert result["payers"][0]["candidates"][0]["records"]["state"] == "available"


@pytest.mark.usefixtures("storage")
def test_failed_record_refresh_retains_same_candidate_evidence(client, monkeypatch):
    headers, _, _ = session(client)
    path = draft(client, headers)
    upload(client, path, headers, "front")
    upload(client, path, headers, "back")
    client.post(path + "/submit", headers=headers, json={"likes_ad": False})
    candidate = {
        "registration_number": "41412",
        "scope": "candidate_record",
        "source_url": "https://example.org/41412",
    }
    monkeypatch.setattr(
        mail_analysis, "candidate_records", lambda *args: [dict(candidate)]
    )
    quote = {
        "quote": "Paid for by Restore Sanity",
        "payer_text": "Restore Sanity",
        "edge_warning": False,
        "confidence": 90,
    }
    monkeypatch.setattr(
        mail_analysis,
        "read_image",
        lambda _: {
            "status": "partial",
            "text": quote["quote"],
            "disclosures": [quote],
            "complete": False,
        },
    )
    from datetime import datetime, timezone

    record = {
        "state": "available",
        "registration_number": "41412",
        "year": datetime.now(timezone.utc).year,
        "fetched_at": "2026-11-09T00:00:00Z",
        "release_id": "original-snapshot",
    }
    monkeypatch.setattr(mail_analysis, "public_records", lambda *args: dict(record))
    mail_analysis.drain_once()
    client.post(path + "/analysis/retry", headers=headers)
    monkeypatch.setattr(
        mail_analysis,
        "public_records",
        lambda *args: (_ for _ in ()).throw(TimeoutError()),
    )
    mail_analysis.drain_once()
    result = client.get(path + "/analysis", headers=headers).json()["data"]
    assert result["status"] == "partial"
    assert result["records_retry_needed"] is True
    assert result["payers"][0]["candidates"][0]["records"] == {
        **record,
        "refresh_failed": True,
    }
    # A different registration must not inherit the previous candidate's records.
    candidate["registration_number"] = "99999"
    client.post(path + "/analysis/retry", headers=headers)
    mail_analysis.drain_once()
    result = client.get(path + "/analysis", headers=headers).json()["data"]
    assert result["payers"][0]["candidates"][0]["records"]["state"] == "unavailable"


@pytest.mark.parametrize(
    "url",
    [
        "https://joinouramerica.org@evil.example",
        "https://evil.example/path/joinouramerica.org",
        "info@joinouramerica.org",
    ],
)
def test_related_website_uses_hostname_not_embedded_text(url):
    assert related_records("Paid for by Our America " + url, "Our America") == []


def test_neighbor_website_is_not_attributed_to_disclosure_payer():
    assert (
        related_records(
            "Paid for by Restore Sanity.\nVisit joinouramerica.org", "Restore Sanity"
        )
        == []
    )
    assert (
        related_records(
            "Paid for by Our America.\nUnrelated campaign: https://joinouramerica.org",
            "Our America",
        )
        == []
    )
    result = related_records(
        "This is an independent expenditure prepared and paid for by Our\nAmerica, https://joinouramerica.org, It is not coordinated",
        "Our America",
    )
    assert result[0]["registration_number"] == "30807"


@pytest.mark.usefixtures("storage")
def test_reviewed_original_copies_inherit_but_similarity_never_assigns(client):
    import uuid
    from alethical.db import models as m
    from alethical.db.session import get_session_factory

    headers, _, _ = session(client)
    paths = []
    for _ in range(4):
        path = draft(client, headers)
        upload(client, path, headers, "front")
        upload(client, path, headers, "back")
        client.post(path + "/submit", headers=headers, json={"likes_ad": False})
        paths.append(path)
    ids = [uuid.UUID(path.rsplit("/", 1)[1]) for path in paths]

    def result(prefix):
        return {
            "sides": [
                {
                    "side": side,
                    "sha256": prefix + side,
                    "image_fingerprint": "0000000000000000",
                    "status": "read",
                }
                for side in ("front", "back")
            ]
        }

    with get_session_factory()() as db:
        root = mail_analysis.assign_creative(
            db,
            ids[0],
            matching_submission_id=None,
            excluded=False,
            evidence="Both sides and payer reviewed as creative A",
        )
        root.result = result("same-")
        copy = m.MailUploadAnalysis(submission_id=ids[1], result=result("same-"))
        near = m.MailUploadAnalysis(submission_id=ids[2], result=result("different-"))
        db.add_all([copy, near])
        db.flush()
        mail_analysis.inherit_reviewed_creative(db, copy)
        assert copy.creative_id == root.creative_id
        assert copy.creative_evidence["method"] == "reviewed_creative_same_originals"
        mail_analysis.inherit_reviewed_creative(db, near)
        assert near.creative_id is None
        assert near.creative_evidence["similarity_candidates"]
        target = mail_analysis.assign_creative(
            db,
            ids[3],
            matching_submission_id=None,
            excluded=False,
            evidence="Both sides and payer reviewed as creative B",
        )
        target.result = result("target-")
        mail_analysis.assign_creative(
            db,
            ids[0],
            matching_submission_id=ids[3],
            excluded=False,
            evidence="Reviewed reference belongs to existing creative B",
        )
        db.flush()
        db.refresh(copy)
        assert copy.creative_id == target.creative_id
        mail_analysis.assign_creative(
            db,
            ids[0],
            matching_submission_id=ids[3],
            excluded=True,
            evidence="This reviewed reference is synthetic and excluded",
        )
        db.refresh(copy)
        assert copy.creative_id is None
        mail_analysis.assign_creative(
            db,
            ids[0],
            matching_submission_id=ids[3],
            excluded=False,
            evidence="Confirmed real reference; restore comparison evidence",
        )
        db.refresh(copy)
        assert copy.creative_id == target.creative_id
        near.result = result("same-")
        db.flush()
        mail_analysis.assign_creative(
            db,
            ids[2],
            matching_submission_id=None,
            excluded=False,
            evidence="Conflicting reviewed version must suspend derived matches",
        )
        db.refresh(copy)
        assert copy.creative_id is None
        assert copy.creative_evidence["conflicting_exact_references"] is True
        assert copy.creative_evidence["assignment_history"]
        db.commit()
    public = client.get(paths[1] + "/analysis", headers=headers).json()["data"]
    assert public["matching_mailers"]["count"] is None
    assert "creative_evidence" not in public
    assert str(ids[0]) not in str(public)


@pytest.mark.usefixtures("storage")
@pytest.mark.parametrize("review_before_ocr", [False, True])
def test_creative_assignment_does_not_depend_on_read_order(client, review_before_ocr):
    import uuid
    from alethical.db import models as m
    from alethical.db.session import get_session_factory

    headers, _, _ = session(client)
    ids = []
    for _ in range(2):
        path = draft(client, headers)
        upload(client, path, headers, "front")
        upload(client, path, headers, "back")
        client.post(path + "/submit", headers=headers, json={"likes_ad": False})
        ids.append(uuid.UUID(path.rsplit("/", 1)[1]))
    pair = {
        "sides": [
            {"side": side, "sha256": "same-" + side, "status": "read"}
            for side in ("front", "back")
        ]
    }
    with get_session_factory()() as db:
        copy = m.MailUploadAnalysis(submission_id=ids[1], result=pair)
        db.add(copy)
        db.flush()
        mail_analysis.inherit_reviewed_creative(db, copy)
        assert copy.creative_id is None
        assert copy.creative_evidence["automatic"] is True
        if review_before_ocr:
            root = mail_analysis.assign_creative(
                db,
                ids[0],
                matching_submission_id=None,
                excluded=False,
                evidence="Both original sides reviewed as a distinct creative",
            )
            root.result = pair
            db.flush()
            mail_analysis.inherit_reviewed_creative(db, root)
        else:
            root = m.MailUploadAnalysis(submission_id=ids[0], result=pair)
            db.add(root)
            db.flush()
            mail_analysis.assign_creative(
                db,
                ids[0],
                matching_submission_id=None,
                excluded=False,
                evidence="Both original sides reviewed as a distinct creative",
            )
        assert copy.creative_id == root.creative_id


@pytest.mark.usefixtures("storage")
def test_review_manifest_checks_hashes_and_does_not_mutate_originals(client):
    import uuid
    from alethical.db import models as m
    from alethical.db.session import get_session_factory
    from alethical.api.services import mail_upload
    from scripts.mail_analysis import Review, apply_reviews

    headers, _, _ = session(client)
    path = draft(client, headers)
    upload(client, path, headers, "front")
    upload(client, path, headers, "back")
    client.post(path + "/submit", headers=headers, json={"likes_ad": False})
    sid = uuid.UUID(path.rsplit("/", 1)[1])
    with get_session_factory()() as db:
        submission = db.get(m.MailUploadSubmission, sid)
        images = mail_upload.selected_images(db, submission)
        before = {
            side: (row.object_key, row.byte_count, row.sha256)
            for side, row in images.items()
        }
        review = Review(
            submission_id=sid,
            front_sha256=images["front"].sha256,
            back_sha256=images["back"].sha256,
            excluded_from_counts=False,
            evidence="Both sides compared against original hashes; distinct design",
        )
        bad = review.model_copy(update={"front_sha256": "0" * 64})
        with pytest.raises(ValueError, match="does not match"):
            apply_reviews(db, [bad], apply=True)
        assert db.get(m.MailUploadAnalysis, sid) is None
        assert apply_reviews(db, [review], apply=False)["applied"] is False
        assert db.get(m.MailUploadAnalysis, sid) is None
        assert apply_reviews(db, [review], apply=True)["reviewed"] == 1
        after = {
            side: (row.object_key, row.byte_count, row.sha256)
            for side, row in mail_upload.selected_images(db, submission).items()
        }
        assert after == before


def test_production_runtime_installs_local_ocr():
    import json
    from pathlib import Path

    root = Path(__file__).resolve().parents[2]
    config = json.loads((root / "railpack.json").read_text())
    assert {"tesseract-ocr", "tesseract-ocr-eng"} <= set(
        config["deploy"]["aptPackages"]
    )


def test_missing_ocr_runtime_leaves_queue_unclaimed(monkeypatch):
    import asyncio
    from types import SimpleNamespace

    monkeypatch.setenv("ALETHICAL_MAIL_ANALYSIS_ENABLED", "true")
    monkeypatch.setattr(
        mail_analysis,
        "require_ocr_runtime",
        lambda: (_ for _ in ()).throw(RuntimeError("missing OCR")),
        raising=False,
    )
    calls = []
    monkeypatch.setattr(mail_analysis, "drain_once", lambda: calls.append(True))

    async def run():
        async with mail_analysis.mail_analysis_lifespan(
            SimpleNamespace(state=SimpleNamespace())
        ):
            await asyncio.sleep(0.02)

    asyncio.run(run())
    assert calls == []


@pytest.mark.parametrize(
    "languages",
    [
        "List of available languages (1):\neng\n",
        "List of available languages (1):\nfra\n",
    ],
)
def test_runtime_requires_english_data(monkeypatch, languages):
    from types import SimpleNamespace

    monkeypatch.setattr(mail_analysis.shutil, "which", lambda name: "/usr/bin/" + name)
    monkeypatch.setattr(
        mail_analysis.subprocess,
        "run",
        lambda *args, **kwargs: SimpleNamespace(stdout=languages),
    )
    if "eng" in languages.splitlines():
        mail_analysis.require_ocr_runtime()
    else:
        with pytest.raises(RuntimeError, match="English"):
            mail_analysis.require_ocr_runtime()


def test_sparse_disclosure_keeps_joint_payer_and_excludes_neighbor_column():
    lines = [
        {
            "text": "Paid for by Republican Party of",
            "box": [100, 100, 700, 130],
            "confidence": 95,
        },
        {"text": "POSTAGE PAID", "box": [900, 100, 1100, 130], "confidence": 99},
        {
            "text": "Minnesota and Senate Victory Fund.",
            "box": [102, 140, 750, 170],
            "confidence": 96,
        },
        {
            "text": "Not coordinated with any candidate",
            "box": [101, 180, 760, 210],
            "confidence": 94,
        },
    ]
    result = mail_analysis.disclosure_column(lines, 0)
    assert [line["text"] for line in result] == [
        lines[0]["text"],
        lines[2]["text"],
        lines[3]["text"],
    ]


def test_angled_disclosure_region_keeps_vertical_context():
    region = mail_analysis.angled_disclosure_region(
        (4000, 3000), [2573, 1695, 2962, 1771]
    )
    assert region[0] < 2000
    assert region[1] < 1450
    assert region[2] > 3200
    assert region[3] > 1950


def test_sparse_fallback_recovers_joint_quote_without_confirming_single_payer(
    tmp_path, monkeypatch
):
    import time
    from types import SimpleNamespace
    from PIL import Image

    header = "block_num\tpar_num\tline_num\tleft\ttop\twidth\theight\tconf\ttext\n"
    raw = (
        header
        + "1\t1\t1\t100\t100\t600\t30\t95\tPaid for by Republican Party of\n"
        + "2\t1\t1\t900\t100\t200\t30\t99\tPOSTAGE PAID\n"
        + "3\t1\t1\t102\t140\t650\t30\t96\tMinnesota and Senate Victory Fund.\n"
        + "4\t1\t1\t100\t180\t650\t30\t95\twww.mngop.org www.senatevictoryfund.com\n"
    ).encode()
    modes = []

    def run(command, **kwargs):
        mode = command[command.index("--psm") + 1]
        modes.append(mode)
        assert kwargs["timeout"] <= 10
        return SimpleNamespace(stdout=raw if mode == "11" else header.encode())

    monkeypatch.setattr(mail_analysis.subprocess, "run", run)
    result = mail_analysis.refine_disclosure(
        Image.new("RGB", (1600, 1000), "white"),
        {
            "quote": "Or by Republican Party of",
            "payer_text": None,
            "confidence": 70,
            "box": [600, 400, 1000, 430],
            "edge_warning": False,
        },
        tmp_path,
        time.monotonic() + 20,
    )
    assert modes.count("11") == 1
    assert (
        result["payer_text"] == "Republican Party of Minnesota and Senate Victory Fund"
    )
    assert "POSTAGE" not in result["quote"]
    assert "www.mngop.org www.senatevictoryfund.com" in result["quote"]
    assert result["crop"]["segmentation"] == "sparse_column"
    assert result["confidence"] == 95.5
    assert (
        corroborate(
            result["payer_text"], result["quote"], edge_warning=False, confidence=95.5
        )
        is None
    )


def test_sparse_fallback_does_not_turn_fragment_into_payer(tmp_path, monkeypatch):
    import time
    from types import SimpleNamespace
    from PIL import Image

    raw = b"block_num\tpar_num\tline_num\tleft\ttop\twidth\theight\tconf\ttext\n1\t1\t1\t20\t20\t300\t30\t95\tOr by Example Organization\n"
    monkeypatch.setattr(
        mail_analysis.subprocess,
        "run",
        lambda *args, **kwargs: SimpleNamespace(stdout=raw),
    )
    quote = {
        "quote": "Or by Example Organization",
        "payer_text": None,
        "confidence": 95,
        "box": [100, 100, 400, 130],
        "edge_warning": False,
    }
    result = mail_analysis.refine_disclosure(
        Image.new("RGB", (800, 500), "white"), quote, tmp_path, time.monotonic() + 20
    )
    assert result["payer_text"] is None
