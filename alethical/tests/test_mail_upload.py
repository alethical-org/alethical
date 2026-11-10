from __future__ import annotations

import io
import secrets
import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from pathlib import Path

import pytest
from PIL import Image
from sqlalchemy import text

from alethical.api.services import mail_upload as service
from alethical.db.models import MailUploadInvitation, MailUploadQuota
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
        assert self.objects[key] == data

    def get(self, key, destination, *, max_bytes):
        assert len(self.objects[key]) <= max_bytes
        Path(destination).write_bytes(self.objects[key])


@pytest.fixture()
def storage(monkeypatch, seed_database):
    monkeypatch.setenv("ALETHICAL_MAIL_UPLOAD_ENABLED", "true")
    primary, mirror = Store(), Store()
    monkeypatch.setattr(service, "stores", lambda: (primary, mirror))
    with get_session_factory()() as db:
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
    assert len(storage[0].objects) == 2
    assert all(body == photo() for body in storage[0].objects.values())
    assert "object_key" not in result.text and "url" not in result.text
    assert result.headers["cache-control"] == "private, no-store"


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
        assert len(rows) == 5 and all(row[1] for row in rows)
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


def test_simultaneous_writers_share_global_byte_reservation(client, storage):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    from fastapi import HTTPException

    participants = []
    for _ in range(2):
        headers, _, _ = session(client)
        path = draft(client, headers)
        participants.append(
            (headers["Authorization"][7:], uuid.UUID(path.rsplit("/", 1)[1]))
        )
    data = photo()
    with get_session_factory()() as db:
        db.get(MailUploadQuota, 1).reserved_bytes = service.GLOBAL_BYTE_LIMIT - len(
            data
        )
        db.commit()
    barrier = Barrier(2)

    def attempt(participant):
        token, submission_id = participant
        with get_session_factory()() as db:
            barrier.wait(timeout=5)
            try:
                service.save_image(db, token, submission_id, "front", data, "image/png")
                return 200
            except HTTPException as exc:
                return exc.status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(attempt, participants)) == [200, 429]
    with get_session_factory()() as db:
        assert db.get(MailUploadQuota, 1).reserved_bytes == service.GLOBAL_BYTE_LIMIT
    assert len(storage[0].objects) == len(storage[1].objects) == 1
