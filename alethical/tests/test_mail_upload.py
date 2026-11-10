from __future__ import annotations

import io
import secrets
import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from pathlib import Path

import pytest
from PIL import Image
from sqlalchemy import delete, select, text

from alethical.api.services import mail_upload as service
from alethical.db.models import (
    MailUploadAnalysis,
    MailUploadImage,
    MailUploadInvitation,
    MailUploadQuota,
    MailUploadSession,
    MailUploadSubmission,
)
from alethical.db.session import get_session_factory

BASE = "/api/v1/mail-upload"


class Store:
    def __init__(self):
        self.objects = {}
        self.failed = False

    def put_and_verify(self, key, path, expected_sha256):
        if self.failed:
            raise RuntimeError("private provider error must not escape")
        data = Path(path).read_bytes()
        import hashlib

        assert hashlib.sha256(data).hexdigest() == expected_sha256
        self.objects.setdefault(key, data)
        if self.objects[key] != data:
            raise service.StorageIntegrityError("private stored bytes differ")

    def get(self, key, destination, *, max_bytes):
        assert len(self.objects[key]) <= max_bytes
        Path(destination).write_bytes(self.objects[key])


@pytest.fixture()
def storage(monkeypatch, seed_database):
    monkeypatch.setenv("ALETHICAL_MAIL_UPLOAD_ENABLED", "true")
    primary, mirror = Store(), Store()
    monkeypatch.setattr(service, "stores", lambda: (primary, mirror))
    with get_session_factory()() as db:
        # File matching spans submissions and invitations, just like production.
        # Each fake bucket starts empty, so its database references must too.
        for model in (
            MailUploadAnalysis,
            MailUploadImage,
            MailUploadSubmission,
            MailUploadSession,
            MailUploadInvitation,
        ):
            db.execute(delete(model))
        quota = db.get(MailUploadQuota, 1)
        if quota is None:
            db.add(MailUploadQuota(id=1))
        else:
            quota.reserved_bytes = quota.storage_attempts = 0
        db.commit()
    return primary, mirror


def photo(color="red", fmt="PNG"):
    out = io.BytesIO()
    Image.new("RGB", (32, 24), color).save(out, format=fmt)
    return out.getvalue()


def session(client):
    with get_session_factory()() as db:
        invitation, token = service.create_invitation(db)
        invitation_id = invitation.id
    body = {
        "invitation_token": token,
        "client_id": str(uuid.uuid4()),
        "client_secret": secrets.token_hex(32),
    }
    result = client.post(BASE + "/sessions", json=body)
    assert result.status_code == 200, result.text
    return (
        {"Authorization": "Bearer " + result.json()["data"]["token"]},
        body,
        invitation_id,
    )


def draft(client, headers):
    path = BASE + "/submissions/" + str(uuid.uuid4())
    result = client.put(path, headers=headers, json={})
    assert result.status_code == 200, result.text
    return path


def upload(client, path, headers, side="front", body=None):
    return client.put(
        path + "/images/" + side,
        headers={**headers, "Content-Type": "image/png"},
        content=photo() if body is None else body,
    )


def test_plain_url_sessions_are_private_retryable_and_bounded(
    client, storage, monkeypatch
):
    monkeypatch.setattr(service, "OPEN_SESSION_LIMIT", 2)

    def proof():
        return {"client_id": str(uuid.uuid4()), "client_secret": secrets.token_hex(32)}

    def exchange(body):
        return client.post(BASE + "/sessions", json=body)

    first = proof()
    opened = exchange(first)
    assert opened.status_code == 200, opened.text
    assert opened.headers["cache-control"] == "private, no-store"
    headers = {"Authorization": "Bearer " + opened.json()["data"]["token"]}
    path = draft(client, headers)
    assert upload(client, path, headers).status_code == 200

    second = exchange(proof())
    assert second.status_code == 200, second.text
    other = {"Authorization": "Bearer " + second.json()["data"]["token"]}
    assert client.get(path, headers=other).status_code == 404
    assert upload(client, path, other, "back").status_code == 404
    assert (
        exchange({**first, "client_secret": secrets.token_hex(32)}).status_code == 401
    )
    assert exchange({**first, "invitation_token": "x" * 43}).status_code == 401
    assert exchange(proof()).status_code == 429
    assert exchange(first).json() == opened.json()
    assert upload(client, path, headers, "back").status_code == 200
    saved = client.post(path + "/submit", headers=headers, json={"likes_ad": True})
    assert saved.status_code == 200 and saved.json()["data"]["status"] == "saved"


def test_complete_retry_and_private_bytes(client, storage):
    headers, request, _ = session(client)
    again = client.post(BASE + "/sessions", json=request)
    assert "Bearer " + again.json()["data"]["token"] == headers["Authorization"]
    path = draft(client, headers)
    assert upload(client, path, headers).status_code == 200
    assert upload(client, path, headers, "back").status_code == 200
    result = client.post(
        path + "/submit",
        headers=headers,
        json={"likes_ad": False, "comment": " No thanks "},
    )
    assert result.status_code == 200, result.text
    assert result.json()["data"]["status"] == "saved"
    assert result.json()["data"]["comment"] == "No thanks"
    assert (
        client.post(
            path + "/submit",
            headers=headers,
            json={"likes_ad": False, "comment": "No thanks"},
        ).json()
        == result.json()
    )
    assert (
        client.post(
            path + "/submit", headers=headers, json={"likes_ad": True}
        ).status_code
        == 409
    )
    assert upload(client, path, headers).status_code == 409
    assert storage[0].objects == storage[1].objects
    assert len(storage[0].objects) == 1
    assert all(body == photo() for body in storage[0].objects.values())
    assert "object_key" not in result.text and "url" not in result.text
    assert result.headers["cache-control"] == "private, no-store"


def test_identical_files_keep_separate_feedback_and_private_access(client, storage):
    submissions = []
    for likes_ad, comment in (
        (True, "First private comment"),
        (False, "Other comment"),
    ):
        headers, _, _ = session(client)
        path = draft(client, headers)
        for side in ("front", "back"):
            assert upload(client, path, headers, side).status_code == 200
        saved = client.post(
            path + "/submit",
            headers=headers,
            json={"likes_ad": likes_ad, "comment": comment},
        )
        assert saved.status_code == 200, saved.text
        assert saved.json()["data"]["likes_ad"] is likes_ad
        assert saved.json()["data"]["comment"] == comment
        assert "object_key" not in saved.text
        submissions.append((path, headers, saved.json()))
    assert submissions[0][2]["data"]["id"] != submissions[1][2]["data"]["id"]
    for index, (path, headers, saved) in enumerate(submissions):
        assert client.get(path, headers=headers).json() == saved
        assert client.get(path, headers=submissions[1 - index][1]).status_code == 404
        assert (
            client.get(
                path + "/analysis", headers=submissions[1 - index][1]
            ).status_code
            == 404
        )
    assert len(storage[0].objects) == len(storage[1].objects) == 1


def test_isolation_secret_and_revocation(client, storage):
    headers, request, invitation_id = session(client)
    path = draft(client, headers)
    wrong_secret = {**request, "client_secret": secrets.token_hex(32)}
    assert client.post(BASE + "/sessions", json=wrong_secret).status_code == 401
    other, _, _ = session(client)
    assert client.get(path, headers=other).status_code == 404
    assert client.put(path, headers=other, json={}).status_code == 404
    assert upload(client, path, other).status_code == 404
    assert client.get(path).status_code == 401
    with get_session_factory()() as db:
        db.get(MailUploadInvitation, invitation_id).revoked_at = service.now()
        db.commit()
    assert client.get(path, headers=headers).status_code == 401
    assert client.post(BASE + "/sessions", json=request).status_code == 401


@pytest.mark.parametrize("held_store", [0, 1])
def test_storage_copies_overlap_and_both_finish_before_selection(
    client, storage, monkeypatch, held_store
):
    headers, _, _ = session(client)
    path = draft(client, headers)
    previous = upload(client, path, headers).json()
    entered = [Event(), Event()]
    completed = [Event(), Event()]
    release = Event()

    def controlled_put(index, original):
        def put(key, file_path, expected_sha256):
            entered[index].set()
            if index == held_store:
                assert release.wait(10), "test did not release the held store"
            original(key, file_path, expected_sha256)
            completed[index].set()

        return put

    for index, store in enumerate(storage):
        monkeypatch.setattr(
            store, "put_and_verify", controlled_put(index, store.put_and_verify)
        )
    with ThreadPoolExecutor(max_workers=1) as requests:
        pending = requests.submit(upload, client, path, headers, body=photo("blue"))
        try:
            assert all(event.wait(5) for event in entered), "copies ran sequentially"
            assert completed[1 - held_store].wait(5)
            assert not pending.done(), "response returned before both copies verified"
            assert client.get(path, headers=headers).json() == previous
        finally:
            release.set()
        result = pending.result(timeout=10)
    assert result.status_code == 200, result.text
    assert result.json()["data"]["front"] != previous["data"]["front"]
    assert all(event.is_set() for event in completed)
    assert storage[0].objects == storage[1].objects


@pytest.mark.parametrize("failed_store", [0, 1])
def test_failed_copy_keeps_file_and_gate_until_other_copy_finishes(
    client, storage, monkeypatch, failed_store
):
    headers, _, _ = session(client)
    path = draft(client, headers)
    previous = upload(client, path, headers).json()
    failed = Event()
    held = Event()
    copied = Event()
    release = Event()

    def fail(*args):
        failed.set()
        raise RuntimeError("private provider failure")

    original = storage[1 - failed_store].put_and_verify

    def slow_copy(key, file_path, expected_sha256):
        held.set()
        assert release.wait(10), "test did not release the other copy"
        # The temporary source must still exist, even after the other copy failed.
        original(key, file_path, expected_sha256)
        copied.set()

    monkeypatch.setattr(storage[failed_store], "put_and_verify", fail)
    monkeypatch.setattr(storage[1 - failed_store], "put_and_verify", slow_copy)
    with ThreadPoolExecutor(max_workers=1) as requests:
        pending = requests.submit(upload, client, path, headers, body=photo("blue"))
        try:
            assert held.wait(5) and failed.wait(5)
            assert not pending.done()
            assert upload(client, path, headers, "back").status_code == 429
            assert client.get(path, headers=headers).json() == previous
        finally:
            release.set()
        result = pending.result(timeout=10)
    assert result.status_code == 503
    assert copied.is_set(), "temporary file was removed before the other copy finished"
    assert "provider" not in result.text
    assert client.get(path, headers=headers).json() == previous


@pytest.mark.parametrize("failed_store", [0, 1])
def test_failed_replacement_keeps_side_and_retry_repairs_backup(
    client, storage, failed_store
):
    headers, _, _ = session(client)
    path = draft(client, headers)
    first = upload(client, path, headers).json()
    storage[failed_store].failed = True
    failed = upload(client, path, headers, body=photo("blue"))
    assert failed.status_code == 503 and "provider" not in failed.text
    assert client.get(path, headers=headers).json() == first
    storage[failed_store].failed = False
    success = upload(client, path, headers, body=photo("blue"))
    assert success.status_code == 200
    assert success.json()["data"]["front"] != first["data"]["front"]
    assert storage[0].objects == storage[1].objects
    with get_session_factory()() as db:
        before = db.get(MailUploadQuota, 1).reserved_bytes
    assert upload(client, path, headers, body=photo("blue")).status_code == 200
    with get_session_factory()() as db:
        assert db.get(MailUploadQuota, 1).reserved_bytes == before


def test_validation_and_transport_bounds(client, storage):
    headers, _, _ = session(client)
    path = draft(client, headers)
    assert (
        client.post(
            path + "/submit", headers=headers, json={"likes_ad": True}
        ).status_code
        == 422
    )
    assert (
        client.post(
            path + "/submit", headers=headers, json={"likes_ad": "yes"}
        ).status_code
        == 422
    )
    assert (
        client.post(
            path + "/submit",
            headers=headers,
            json={"likes_ad": True, "comment": "a" * 4001},
        ).status_code
        == 422
    )
    assert client.post(BASE + "/sessions", content=b"x" * 65537).status_code == 413
    for data in (b"not an image", photo()[:30]):
        assert upload(client, path, headers, body=data).status_code == 422
    assert (
        upload(
            client, path, headers, body=b"x" * (service.MAX_IMAGE_BYTES + 1)
        ).status_code
        == 413
    )
    assert (
        client.put(
            path + "/images/front",
            headers={**headers, "Content-Type": "image/jpeg"},
            content=photo(),
        ).status_code
        == 422
    )
    assert storage[0].objects == {}


def test_quotas_are_database_backed(client, storage):
    headers, _, invitation_id = session(client)
    path = draft(client, headers)
    with get_session_factory()() as db:
        db.get(MailUploadInvitation, invitation_id).max_bytes = 1
        db.commit()
    assert upload(client, path, headers).status_code == 429
    with get_session_factory()() as db:
        db.get(MailUploadInvitation, invitation_id).max_bytes = 100000
        db.get(MailUploadQuota, 1).storage_attempts = service.GLOBAL_ATTEMPT_LIMIT
        db.commit()
    assert upload(client, path, headers).status_code == 429
    assert storage[0].objects == {}


def test_heic_and_pixel_limit(monkeypatch):
    body = photo(fmt="HEIF")
    assert service.validate_image(body, "image/heic") == ("image/heic", 32, 24)
    monkeypatch.setattr(service, "MAX_PIXELS", 20)
    with pytest.raises(Exception) as exc:
        service.validate_image(photo(), "image/png")
    assert exc.value.status_code == 422


@pytest.mark.parametrize("size", [(8160, 6120), (8192, 6144)])
def test_50_megapixel_camera_photo_upload(client, storage, size):
    out = io.BytesIO()
    with Image.new("RGB", size, "white") as image:
        image.save(out, format="JPEG")
    body = out.getvalue()
    headers, _, _ = session(client)
    path = draft(client, headers)
    result = client.put(
        path + "/images/front",
        headers={**headers, "Content-Type": "image/jpeg"},
        content=body,
    )
    assert result.status_code == 200, result.text
    assert result.json()["data"]["front"]["bytes"] == len(body)
    assert list(storage[0].objects.values()) == [body]
    assert list(storage[1].objects.values()) == [body]


def test_photo_above_51_megapixels_is_rejected():
    out = io.BytesIO()
    with Image.new("RGB", (8256, 6192), "white") as image:
        image.save(out, format="JPEG")
    with pytest.raises(Exception) as exc:
        service.validate_image(out.getvalue(), "image/jpeg")
    assert exc.value.status_code == 422


def test_admin_is_protected_and_tables_have_rls(client, storage):
    assert client.get("/api/v1/admin/mail-upload/submissions").status_code == 401
    with get_session_factory()() as db:
        rows = db.execute(
            text(
                "SELECT relname, relrowsecurity FROM pg_class WHERE relname LIKE 'mail_upload_%' AND relkind = 'r'"
            )
        ).all()
        assert len(rows) == 6 and all(row[1] for row in rows)
    from alethical.api.routers.admin import require_admin

    client.app.dependency_overrides[require_admin] = lambda: None
    headers, _, _ = session(client)
    path = draft(client, headers)
    upload(client, path, headers)
    admin_path = path.replace("/mail-upload/", "/admin/mail-upload/") + "/images/front"
    result = client.get(admin_path)
    assert result.status_code == 200 and result.content == photo()
    assert result.headers["cache-control"] == "private, no-store"
    assert result.headers["content-disposition"].startswith("attachment")


def test_save_during_replacement_never_changes_saved_images(client, storage):
    headers, _, _ = session(client)
    path = draft(client, headers)
    upload(client, path, headers)
    upload(client, path, headers, "back")
    submission_id = uuid.UUID(path.rsplit("/", 1)[1])
    old_front = client.get(path, headers=headers).json()["data"]["front"]
    original_put = storage[1].put_and_verify

    def save_while_copying(key, file_path, sha):
        original_put(key, file_path, sha)
        with get_session_factory()() as db:
            service.submit(
                db,
                service.authorize(db, headers["Authorization"][7:]),
                submission_id,
                True,
                None,
            )

    storage[1].put_and_verify = save_while_copying
    result = upload(client, path, headers, body=photo("blue"))
    assert result.status_code == 409
    saved = client.get(path, headers=headers).json()["data"]
    assert saved["status"] == "saved" and saved["front"] == old_front


def test_expiry_and_invalid_secret_are_private(client, storage):
    headers, body, invitation_id = session(client)
    with get_session_factory()() as db:
        from datetime import timedelta

        db.get(MailUploadInvitation, invitation_id).expires_at = (
            service.now() - timedelta(seconds=1)
        )
        db.commit()
    assert client.post(BASE + "/sessions", json=body).status_code == 401
    bad = client.post(
        BASE + "/sessions", json={**body, "client_secret": "private-value"}
    )
    assert bad.status_code == 422 and "private-value" not in bad.text
    assert bad.headers["cache-control"] == "private, no-store"


def test_feature_is_off_by_default(client, monkeypatch):
    monkeypatch.delenv("ALETHICAL_MAIL_UPLOAD_ENABLED", raising=False)
    body = {
        "invitation_token": "a" * 43,
        "client_id": str(uuid.uuid4()),
        "client_secret": secrets.token_hex(32),
    }
    assert client.post(BASE + "/sessions", json=body).status_code == 503


def test_unexpected_private_failure_never_rethrows_sensitive_values(
    client, storage, monkeypatch, caplog
):
    headers, _, _ = session(client)

    def broken(*args, **kwargs):
        raise RuntimeError("recipient-address-and-secret")

    monkeypatch.setattr(service, "create_submission", broken)
    result = client.put(
        BASE + "/submissions/" + str(uuid.uuid4()), headers=headers, json={}
    )
    # TestClient raises unhandled ASGI exceptions even if a 500 handler responded.
    assert result.status_code == 503 and "recipient-address" not in result.text
    assert "recipient-address-and-secret" not in caplog.text
    assert result.headers["cache-control"] == "private, no-store"


def test_nul_comment_is_rejected_before_database(client, storage):
    headers, _, _ = session(client)
    path = draft(client, headers)
    result = client.post(
        path + "/submit",
        headers=headers,
        json={"likes_ad": True, "comment": "bad\x00value"},
    )
    assert result.status_code == 422
    assert result.json()["errors"][0]["field"] == "body.comment"


@pytest.mark.parametrize("same_bytes", [True, False])
def test_simultaneous_writers_share_global_byte_reservation(
    client, storage, same_bytes
):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    from fastapi import HTTPException

    participants = []
    for index in range(2):
        headers, _, _ = session(client)
        path = draft(client, headers)
        participants.append(
            (
                headers["Authorization"][7:],
                uuid.UUID(path.rsplit("/", 1)[1]),
                photo() if same_bytes or index == 0 else photo("blue"),
            )
        )
    data = photo()
    with get_session_factory()() as db:
        db.get(MailUploadQuota, 1).reserved_bytes = service.GLOBAL_BYTE_LIMIT - len(
            data
        )
        db.commit()
    barrier = Barrier(2)

    def attempt(participant):
        token, submission_id, image_bytes = participant
        with get_session_factory()() as db:
            barrier.wait(timeout=5)
            try:
                service.save_image(
                    db, token, submission_id, "front", image_bytes, "image/png"
                )
                return 200
            except HTTPException as exc:
                return exc.status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(attempt, participants)) == [200, 429]
    with get_session_factory()() as db:
        reserved = db.get(MailUploadQuota, 1).reserved_bytes
        assert reserved <= service.GLOBAL_BYTE_LIMIT
        if same_bytes:
            assert reserved == service.GLOBAL_BYTE_LIMIT
    assert len(storage[0].objects) == len(storage[1].objects) == 1


def test_reuse_reserves_each_new_reference_and_keeps_new_bytes_separate(
    client, storage
):
    headers, _, first_invite = session(client)
    first = draft(client, headers)
    assert upload(client, first, headers).status_code == 200
    assert upload(client, first, headers, "back").status_code == 200
    second = draft(client, headers)
    assert upload(client, second, headers).status_code == 200
    other, _, other_invite = session(client)
    third = draft(client, other)
    with get_session_factory()() as db:
        assert db.get(MailUploadQuota, 1).reserved_bytes == 3 * len(photo())
        assert db.get(MailUploadInvitation, first_invite).reserved_bytes == 3 * len(
            photo()
        )
        db.get(MailUploadInvitation, other_invite).max_bytes = len(photo()) - 1
        db.commit()
    assert upload(client, third, other).status_code == 429
    with get_session_factory()() as db:
        db.get(MailUploadInvitation, other_invite).max_bytes = 100000
        db.commit()
    assert upload(client, third, other).status_code == 200
    assert upload(client, third, other, "back", photo("blue")).status_code == 200
    with get_session_factory()() as db:
        assert db.get(MailUploadQuota, 1).reserved_bytes == 4 * len(photo()) + len(
            photo("blue")
        )
        assert db.get(MailUploadInvitation, other_invite).reserved_bytes == len(
            photo()
        ) + len(photo("blue"))
    assert len(storage[0].objects) == len(storage[1].objects) == 2


@pytest.mark.parametrize("store_index", [0, 1])
@pytest.mark.parametrize("failure", ["missing", "corrupt", "unavailable"])
def test_reuse_verifies_both_copies_before_selecting(
    client, storage, store_index, failure
):
    headers, _, _ = session(client)
    first = draft(client, headers)
    assert upload(client, first, headers).status_code == 200
    key = next(iter(storage[0].objects))
    store = storage[store_index]
    if failure == "missing":
        del store.objects[key]
    elif failure == "corrupt":
        store.objects[key] = b"damaged private original"
    else:
        store.failed = True
    second = draft(client, headers)
    result = upload(client, second, headers)
    if failure == "missing":
        assert result.status_code == 200
        assert storage[0].objects == storage[1].objects == {key: photo()}
    else:
        assert result.status_code == 503
        assert result.json()["detail"] == "We couldn’t save this photo. Try again"
        assert client.get(second, headers=headers).json()["data"]["front"] is None
        assert (
            client.post(
                second + "/submit", headers=headers, json={"likes_ad": True}
            ).status_code
            == 422
        )
        if failure == "corrupt":
            assert store.objects[key] == b"damaged private original"
        else:
            store.failed = False
            assert upload(client, second, headers).status_code == 200
            assert storage[0].objects == storage[1].objects == {key: photo()}
    with get_session_factory()() as db:
        images = list(db.scalars(select(MailUploadImage)))
        assert len(images) == 2
        assert {image.object_key for image in images} == {key}
        assert db.get(MailUploadQuota, 1).reserved_bytes == 2 * len(photo())


@pytest.mark.parametrize("failed_store", [0, 1])
def test_fresh_submission_repairs_unverified_partial_original(
    client, storage, failed_store
):
    headers, _, _ = session(client)
    first = draft(client, headers)
    storage[failed_store].failed = True
    assert upload(client, first, headers).status_code == 503
    key = next(iter(storage[1 - failed_store].objects))
    storage[failed_store].failed = False
    other, _, _ = session(client)
    second = draft(client, other)
    assert upload(client, second, other).status_code == 200
    assert client.get(first, headers=headers).json()["data"]["front"] is None
    assert upload(client, first, headers).status_code == 200
    assert storage[0].objects == storage[1].objects == {key: photo()}
    with get_session_factory()() as db:
        assert db.get(MailUploadQuota, 1).reserved_bytes == 2 * len(photo())


def test_selected_retry_rechecks_both_copies_without_another_reference(client, storage):
    headers, _, _ = session(client)
    path = draft(client, headers)
    assert upload(client, path, headers).status_code == 200
    key = next(iter(storage[0].objects))
    storage[1].objects[key] = b"corrupted"
    assert upload(client, path, headers).status_code == 503
    with get_session_factory()() as db:
        assert len(list(db.scalars(select(MailUploadImage)))) == 1
        assert db.get(MailUploadQuota, 1).reserved_bytes == len(photo())


@pytest.mark.parametrize("same_submission", [False, True])
def test_overlapping_replicas_share_pending_key_before_either_verifies(
    client, storage, monkeypatch, same_submission
):
    from threading import Barrier

    participants = []
    for _ in range(2):
        headers, _, _ = session(client)
        path = draft(client, headers)
        participants.append(
            (headers["Authorization"][7:], uuid.UUID(path.rsplit("/", 1)[1]))
        )
    if same_submission:
        participants[1] = participants[0]
    both_primary_reads = Barrier(2)
    original = storage[0].put_and_verify

    def held_primary(key, file_path, sha):
        # Two distinct DB sessions emulate two API replicas. Neither can select
        # its image before both durable pending references have been reserved.
        both_primary_reads.wait(timeout=5)
        with get_session_factory()() as db:
            rows = list(db.scalars(select(MailUploadImage)))
            assert len(rows) == (1 if same_submission else 2)
            assert {row.object_key for row in rows} == {key}
            assert all(row.verified_at is None and not row.selected for row in rows)
        both_primary_reads.wait(timeout=5)
        original(key, file_path, sha)

    monkeypatch.setattr(storage[0], "put_and_verify", held_primary)

    def upload_on_replica(participant):
        with get_session_factory()() as db:
            token, submission_id = participant
            return service.save_image(
                db, token, submission_id, "front", photo(), "image/png"
            )

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(upload_on_replica, participants))
    assert all(result["data"]["front"] is not None for result in results)
    assert len(storage[0].objects) == len(storage[1].objects) == 1
    with get_session_factory()() as db:
        assert db.get(MailUploadQuota, 1).reserved_bytes == (
            1 if same_submission else 2
        ) * len(photo())


def test_matching_pixels_with_different_original_bytes_are_not_reused(client, storage):
    from PIL.PngImagePlugin import PngInfo

    headers, _, _ = session(client)
    path = draft(client, headers)
    assert upload(client, path, headers).status_code == 200
    image = Image.open(io.BytesIO(photo()))
    metadata = PngInfo()
    metadata.add_text("Comment", "Private original metadata stays intact")
    encoded = io.BytesIO()
    image.save(encoded, format="PNG", pnginfo=metadata)
    changed = encoded.getvalue()
    assert changed != photo()
    assert upload(client, path, headers, "back", changed).status_code == 200
    assert (
        set(storage[0].objects.values())
        == set(storage[1].objects.values())
        == {photo(), changed}
    )


def test_legacy_duplicates_stay_put_and_fresh_refs_choose_one(client, storage):
    from datetime import timedelta

    headers, _, _ = session(client)
    first = draft(client, headers)
    assert upload(client, first, headers).status_code == 200
    first_key = next(iter(storage[0].objects))
    second = draft(client, headers)
    # Emulate the prior writer: a separate original for the same bytes.
    with get_session_factory()() as db:
        original = db.scalar(select(MailUploadImage))
        original.created_at = service.now() - timedelta(days=1)
        legacy = MailUploadImage(
            submission_id=uuid.UUID(second.rsplit("/", 1)[1]),
            side="front",
            sha256=original.sha256,
            byte_count=original.byte_count,
            content_type=original.content_type,
            width=original.width,
            height=original.height,
            object_key="originals/retained-legacy-duplicate",
            verified_at=service.now(),
            selected=True,
        )
        db.add(legacy)
        db.get(MailUploadQuota, 1).reserved_bytes += len(photo())
        db.commit()
    for store in storage:
        store.objects["originals/retained-legacy-duplicate"] = photo()
    before = dict(storage[0].objects)
    third = draft(client, headers)
    assert upload(client, third, headers).status_code == 200
    assert storage[0].objects == storage[1].objects == before
    with get_session_factory()() as db:
        new = db.scalar(
            select(MailUploadImage).where(
                MailUploadImage.submission_id == uuid.UUID(third.rsplit("/", 1)[1])
            )
        )
        assert new.object_key == first_key
        assert db.get(MailUploadQuota, 1).reserved_bytes == 3 * len(photo())


@pytest.mark.parametrize("quota_scope", ["global", "shared_invitation"])
def test_fresh_reference_capacity_does_not_reveal_another_upload(
    client, storage, quota_scope
):
    def open_session():
        result = client.post(
            BASE + "/sessions",
            json={
                "client_id": str(uuid.uuid4()),
                "client_secret": secrets.token_hex(32),
            },
        )
        assert result.status_code == 200
        return {"Authorization": "Bearer " + result.json()["data"]["token"]}

    original_headers = open_session()
    original_path = draft(client, original_headers)
    assert upload(client, original_path, original_headers).status_code == 200
    attacker = open_session()
    with get_session_factory()() as db:
        if quota_scope == "global":
            db.get(MailUploadQuota, 1).reserved_bytes = service.GLOBAL_BYTE_LIMIT
        else:
            pool = db.get(MailUploadInvitation, service.OPEN_POOL_ID)
            pool.reserved_bytes = pool.max_bytes
        db.commit()
    for body in (photo(), photo("blue")):
        result = upload(client, draft(client, attacker), attacker, body=body)
        assert result.status_code == 429
    # This owner already knows its accepted bytes; retry reserves nothing else.
    assert upload(client, original_path, original_headers).status_code == 200


@pytest.mark.parametrize("other_store_unavailable", [False, True])
def test_proven_corruption_invalidates_shared_drafts_but_keeps_saved_history(
    client, storage, other_store_unavailable
):
    submissions = []
    for _ in range(3):
        headers, _, _ = session(client)
        path = draft(client, headers)
        assert upload(client, path, headers).status_code == 200
        assert upload(client, path, headers, "back", photo("blue")).status_code == 200
        submissions.append((path, headers))
    saved_path, saved_headers = submissions.pop()
    saved = client.post(
        saved_path + "/submit", headers=saved_headers, json={"likes_ad": True}
    )
    assert saved.status_code == 200
    key = next(key for key, value in storage[1].objects.items() if value == photo())
    storage[1].objects[key] = b"corrupt private original"
    storage[0].failed = other_store_unavailable
    failed_path, failed_headers = submissions[0]
    assert upload(client, failed_path, failed_headers).status_code == 503
    for path, headers in submissions:
        assert (
            client.post(
                path + "/submit", headers=headers, json={"likes_ad": True}
            ).status_code
            == 422
        )
        current = client.get(path, headers=headers).json()["data"]
        assert current["front"] is None and current["back"] is not None
    assert client.get(saved_path, headers=saved_headers).json() == saved.json()
    assert storage[1].objects[key] == b"corrupt private original"


def test_temporary_store_failure_does_not_withdraw_a_verified_receipt(client, storage):
    headers, _, _ = session(client)
    path = draft(client, headers)
    for side in ("front", "back"):
        assert upload(client, path, headers, side).status_code == 200
    before = client.get(path, headers=headers).json()
    storage[1].failed = True
    assert upload(client, path, headers).status_code == 503
    assert client.get(path, headers=headers).json() == before
    assert (
        client.post(
            path + "/submit", headers=headers, json={"likes_ad": True}
        ).status_code
        == 200
    )


def test_real_store_distinguishes_hash_mismatch_from_transport_failure(tmp_path):
    import hashlib
    from alethical.pipeline.raw_file_store import RawFileStore, StorageIntegrityError

    class Client:
        failed = False

        def head_object(self, **kwargs):
            return {"ContentLength": 7}

        def get_object(self, **kwargs):
            if self.failed:
                raise TimeoutError("transport unavailable")
            return {"Body": io.BytesIO(b"corrupt")}

    client = Client()
    store = RawFileStore(client, "private-test")
    expected = hashlib.sha256(photo()).hexdigest()
    source = tmp_path / "original.png"
    source.write_bytes(photo())
    with pytest.raises(StorageIntegrityError):
        store.put_and_verify("original", str(source), expected)
    client.failed = True
    with pytest.raises(TimeoutError):
        store.put_and_verify("original", str(source), expected)


def test_submit_waits_for_corrupt_receipt_withdrawal(client, storage, monkeypatch):
    import time
    from fastapi import HTTPException
    from sqlalchemy import event
    from sqlalchemy.orm import Session

    headers, _, _ = session(client)
    path = draft(client, headers)
    for side in ("front", "back"):
        assert upload(client, path, headers, side).status_code == 200
    storage[1].objects[next(iter(storage[1].objects))] = b"corrupt"
    token = headers["Authorization"][7:]
    submission_id = uuid.UUID(path.rsplit("/", 1)[1])
    held, release, submit_started = Event(), Event(), Event()
    submit_pid = []
    invalidate = service.invalidate_corrupt_draft_references

    def mark_invalidation(db, key):
        db.info["hold_invalidation_commit"] = True
        try:
            return invalidate(db, key)
        finally:
            db.info.pop("hold_invalidation_commit", None)

    def hold_commit(db):
        if db.info.get("hold_invalidation_commit"):
            held.set()
            assert release.wait(10)

    def retry():
        with get_session_factory()() as db:
            try:
                service.save_image(
                    db, token, submission_id, "front", photo(), "image/png"
                )
            except HTTPException as exc:
                return exc.status_code

    def submit():
        with get_session_factory()() as db:
            owner = service.authorize(db, token)
            submit_pid.append(db.scalar(text("SELECT pg_backend_pid()")))
            submit_started.set()
            try:
                service.submit(db, owner, submission_id, True, None)
            except HTTPException as exc:
                return exc.status_code
            return 200

    monkeypatch.setattr(
        service, "invalidate_corrupt_draft_references", mark_invalidation
    )
    event.listen(Session, "before_commit", hold_commit)
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            retry_result = pool.submit(retry)
            try:
                assert held.wait(5)
                submit_result = pool.submit(submit)
                assert submit_started.wait(5)
                deadline = time.monotonic() + 5
                while True:
                    with get_session_factory()() as db:
                        waiting = db.scalar(
                            text(
                                "SELECT wait_event_type = 'Lock' FROM pg_stat_activity WHERE pid = :pid"
                            ),
                            {"pid": submit_pid[0]},
                        )
                    if waiting:
                        break
                    assert time.monotonic() < deadline, (
                        "submit did not wait for the receipt lock"
                    )
                    time.sleep(0.01)
                assert not submit_result.done()
            finally:
                release.set()
            assert retry_result.result(timeout=5) == 503
            assert submit_result.result(timeout=5) == 422
    finally:
        event.remove(Session, "before_commit", hold_commit)


def test_stale_success_cannot_restore_a_corrupt_draft_receipt(
    client, storage, monkeypatch
):
    from fastapi import HTTPException

    headers, _, _ = session(client)
    first = draft(client, headers)
    assert upload(client, first, headers).status_code == 200
    second = draft(client, headers)
    token = headers["Authorization"][7:]
    second_id = uuid.UUID(second.rsplit("/", 1)[1])
    verified, release = Event(), Event()
    authorize = service.authorize

    def pause_after_verification(db, token):
        if db.info.get("pause_after_verification"):
            db.info["authorization_calls"] = db.info.get("authorization_calls", 0) + 1
            if db.info["authorization_calls"] == 2:
                verified.set()
                assert release.wait(10)
        return authorize(db, token)

    def stale_upload():
        with get_session_factory()() as db:
            db.info["pause_after_verification"] = True
            try:
                service.save_image(db, token, second_id, "front", photo(), "image/png")
            except HTTPException as exc:
                return exc.status_code
            return 200

    monkeypatch.setattr(service, "authorize", pause_after_verification)
    with ThreadPoolExecutor(max_workers=1) as pool:
        pending = pool.submit(stale_upload)
        try:
            assert verified.wait(5)
            storage[1].objects[next(iter(storage[1].objects))] = b"corrupt"
            assert upload(client, first, headers).status_code == 503
        finally:
            release.set()
        assert pending.result(timeout=5) == 503
    assert client.get(second, headers=headers).json()["data"]["front"] is None
    # Once an authorized storage repair restores the exact bytes, a fresh
    # verification can select this same reference without another reservation.
    storage[1].objects[next(iter(storage[1].objects))] = photo()
    assert upload(client, second, headers).status_code == 200
    with get_session_factory()() as db:
        refs = list(db.scalars(select(MailUploadImage)))
        assert len(refs) == 2 and all(ref.verification_generation == 1 for ref in refs)
        assert db.get(MailUploadQuota, 1).reserved_bytes == 2 * len(photo())
