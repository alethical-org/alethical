"""A signed-out Track press survives sign-in without trusting the browser (#1487).

The browser receives one random reference. Alethical stores only its SHA-256
digest and the exact Track action, then consumes that row in the same database
transaction that saves the bill. This file pins the security properties: no raw
reference at rest, no outside return address, no replay, and one tracked row
even when two tabs race.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import hashlib

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from alethical.api.services import pending_actions as pending_action_service
from alethical.api.rate_limit import SlidingWindowLimiter
from alethical.db.schema import load_schema
from alethical.db.session import get_engine


schema = load_schema()
PendingAction = schema.PendingAction
TrackedBill = schema.TrackedBill

VALID_BILL = "94-2025-SF1832"
OTHER_BILL = "94-2025-SF2483"


def _create(
    client,
    *,
    bill_id: str = VALID_BILL,
    return_path: str = "/bills/x",
    headers: dict[str, str] | None = None,
):
    return client.post(
        "/api/v1/pending-actions",
        headers=headers,
        json={
            "action": "track_bill",
            "bill_id": bill_id,
            "return_path": return_path,
        },
    )


def _complete(client, headers, reference: str, *, action: str = "track_bill"):
    return client.post(
        "/api/v1/me/pending-actions/complete",
        headers=headers,
        json={"reference": reference, "action": action},
    )


def _clear_rows() -> None:
    with Session(get_engine()) as db:
        db.query(PendingAction).delete()
        db.commit()


def test_creation_stores_only_the_reference_digest_and_action_fields(client):
    _clear_rows()

    response = _create(client, return_path="/bills/94-2025-SF1832?tab=summary#top")

    assert response.status_code == 201
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["referrer-policy"] == "no-referrer"
    payload = response.json()["data"]
    reference = payload["reference"]
    assert len(reference) >= 32
    assert payload["expires_at"]

    with Session(get_engine()) as db:
        rows = db.scalars(select(PendingAction)).all()
        assert len(rows) == 1
        row = rows[0]
        assert row.reference_digest == hashlib.sha256(reference.encode()).hexdigest()
        assert reference not in repr(row.__dict__)
        assert row.action_kind == "track_bill"
        assert row.bill.bill_key == VALID_BILL
        assert row.return_path == "/bills/94-2025-SF1832?tab=summary#top"
        assert row.expires_at > datetime.now(timezone.utc)
        assert set(PendingAction.__table__.columns.keys()) == {
            "reference_digest",
            "action_kind",
            "bill_id",
            "return_path",
            "expires_at",
        }


@pytest.mark.parametrize(
    "return_path",
    [
        "https://evil.example/bills/94-2025-SF1832",
        "//evil.example/bills/94-2025-SF1832",
        "/\\evil.example/bills/94-2025-SF1832",
        "/\t/evil.example/bills/94-2025-SF1832",
        "/\n/evil.example/bills/94-2025-SF1832",
        "/\r/evil.example/bills/94-2025-SF1832",
        "/\0/evil.example/bills/94-2025-SF1832",
        "/\f/evil.example/bills/94-2025-SF1832",
        "/\x7f/evil.example/bills/94-2025-SF1832",
        "/bills/94-2025-SF1832\\evil.example",
        "bills/94-2025-SF1832",
        "",
    ],
)
def test_creation_rejects_unsafe_return_paths_without_saving(client, return_path):
    _clear_rows()

    response = _create(client, return_path=return_path)

    assert response.status_code == 422
    with Session(get_engine()) as db:
        assert db.scalar(select(func.count()).select_from(PendingAction)) == 0


def test_creation_rejects_a_missing_bill_without_saving(client):
    _clear_rows()

    response = _create(client, bill_id="94-2025-HF99999")

    assert response.status_code == 404
    with Session(get_engine()) as db:
        assert db.scalar(select(func.count()).select_from(PendingAction)) == 0


def test_creation_rate_limit_rejects_without_saving_an_extra_row(client):
    _clear_rows()
    client.app.state.pending_action_limiter = SlidingWindowLimiter(
        max_requests=1, window_seconds=60
    )

    first = _create(client)
    blocked = _create(client, bill_id=OTHER_BILL)

    assert first.status_code == 201
    assert blocked.status_code == 429
    assert blocked.headers["retry-after"]
    with Session(get_engine()) as db:
        assert db.scalar(select(func.count()).select_from(PendingAction)) == 1


def test_creation_rate_limit_ignores_rotating_forwarded_addresses(client):
    _clear_rows()

    responses = [
        _create(client, headers={"X-Forwarded-For": f"203.0.113.{number}"})
        for number in range(1, 22)
    ]

    assert [response.status_code for response in responses[:20]] == [201] * 20
    assert responses[20].status_code == 429
    with Session(get_engine()) as db:
        assert db.scalar(select(func.count()).select_from(PendingAction)) == 20


def test_database_cap_prevents_unbounded_rows_even_if_rate_limit_is_bypassed(
    client, monkeypatch
):
    _clear_rows()
    client.app.state.pending_action_limiter = SlidingWindowLimiter(
        max_requests=100, window_seconds=60
    )
    monkeypatch.setattr(pending_action_service, "PENDING_ACTION_MAX_ACTIVE", 1)

    first = _create(client)
    blocked = _create(client, bill_id=OTHER_BILL)

    assert first.status_code == 201
    assert blocked.status_code == 503
    with Session(get_engine()) as db:
        assert db.scalar(select(func.count()).select_from(PendingAction)) == 1


def test_completion_tracks_once_and_consumes_the_pending_action(client, auth_headers):
    _clear_rows()
    reference = _create(client).json()["data"]["reference"]

    first = _complete(client, auth_headers, reference)
    replay = _complete(client, auth_headers, reference)

    assert first.status_code == 200
    assert first.headers["cache-control"] == "no-store"
    assert first.json()["data"] == {
        "action": "track_bill",
        "bill_id": VALID_BILL,
        "return_path": "/bills/x",
    }
    assert replay.status_code == 410
    with Session(get_engine()) as db:
        user = db.scalar(
            select(schema.UserAccount).where(
                schema.UserAccount.primary_email == "ada@example.com"
            )
        )
        bill = db.scalar(select(schema.Bill).where(schema.Bill.bill_key == VALID_BILL))
        assert (
            db.scalar(
                select(func.count())
                .select_from(TrackedBill)
                .where(TrackedBill.user_id == user.id, TrackedBill.bill_id == bill.id)
            )
            == 1
        )
        assert db.scalar(select(func.count()).select_from(PendingAction)) == 0


def test_completion_requires_sign_in_and_does_not_consume_the_action(client):
    _clear_rows()
    reference = _create(client).json()["data"]["reference"]

    response = _complete(client, {}, reference)

    assert response.status_code == 401
    with Session(get_engine()) as db:
        assert db.scalar(select(func.count()).select_from(PendingAction)) == 1


def test_completion_is_idempotent_when_the_bill_was_already_tracked(
    client, auth_headers
):
    _clear_rows()
    tracked = client.put(
        f"/api/v1/me/tracked-bills/{VALID_BILL}",
        headers=auth_headers,
        json={"alerts_enabled": True},
    )
    assert tracked.status_code == 200
    reference = _create(client).json()["data"]["reference"]

    response = _complete(client, auth_headers, reference)

    assert response.status_code == 200
    with Session(get_engine()) as db:
        user = db.scalar(
            select(schema.UserAccount).where(
                schema.UserAccount.primary_email == "ada@example.com"
            )
        )
        bill = db.scalar(select(schema.Bill).where(schema.Bill.bill_key == VALID_BILL))
        assert (
            db.scalar(
                select(func.count())
                .select_from(TrackedBill)
                .where(TrackedBill.user_id == user.id, TrackedBill.bill_id == bill.id)
            )
            == 1
        )
        assert db.scalar(select(func.count()).select_from(PendingAction)) == 0


def test_completion_rejects_an_expired_reference_and_deletes_it(client, auth_headers):
    _clear_rows()
    reference = _create(client).json()["data"]["reference"]
    digest = hashlib.sha256(reference.encode()).hexdigest()
    with Session(get_engine()) as db:
        row = db.get(PendingAction, digest)
        row.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        db.commit()

    response = _complete(client, auth_headers, reference)

    assert response.status_code == 410
    with Session(get_engine()) as db:
        assert db.get(PendingAction, digest) is None


def test_completion_rejects_the_wrong_requested_action_without_consuming(
    client, auth_headers
):
    _clear_rows()
    reference = _create(client).json()["data"]["reference"]

    response = _complete(client, auth_headers, reference, action="save_place")

    assert response.status_code == 422
    with Session(get_engine()) as db:
        assert db.scalar(select(func.count()).select_from(PendingAction)) == 1


def test_two_tabs_complete_one_action_and_create_one_tracked_row(client, auth_headers):
    _clear_rows()
    reference = _create(client, bill_id=OTHER_BILL).json()["data"]["reference"]

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(
            pool.map(
                lambda _unused: _complete(client, auth_headers, reference),
                range(2),
            )
        )

    assert sorted(response.status_code for response in responses) == [200, 410]
    with Session(get_engine()) as db:
        user = db.scalar(
            select(schema.UserAccount).where(
                schema.UserAccount.primary_email == "ada@example.com"
            )
        )
        bill = db.scalar(select(schema.Bill).where(schema.Bill.bill_key == OTHER_BILL))
        assert (
            db.scalar(
                select(func.count())
                .select_from(TrackedBill)
                .where(TrackedBill.user_id == user.id, TrackedBill.bill_id == bill.id)
            )
            == 1
        )
        assert db.scalar(select(func.count()).select_from(PendingAction)) == 0


def test_failed_tracking_rolls_back_and_leaves_the_reference_for_retry(
    client, auth_headers, monkeypatch
):
    _clear_rows()
    reference = _create(client, bill_id=OTHER_BILL).json()["data"]["reference"]

    def fail_before_tracking(*_args, **_kwargs):
        raise RuntimeError("forced write failure")

    monkeypatch.setattr(
        pending_action_service, "_insert_tracked_bill", fail_before_tracking
    )
    with pytest.raises(RuntimeError, match="forced write failure"):
        _complete(client, auth_headers, reference)

    with Session(get_engine()) as db:
        assert db.scalar(select(func.count()).select_from(PendingAction)) == 1
