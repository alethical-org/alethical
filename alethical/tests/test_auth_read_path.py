"""The read-path auth dependency must not write on every request (#108).

`get_optional_current_user` runs as a dependency on read endpoints (GET
/public/bills, GET /public/bills/{id}, GET /me, ...). It used to bump
last_used_at/last_signed_in_at and db.commit() on EVERY authenticated request,
so every signed-in GET issued a write. These tests pin the split: provisioning
(first sign-in) still writes; a repeated authenticated read writes nothing.
"""

from __future__ import annotations

from sqlalchemy import event, select
from sqlalchemy.orm import Session

from alethical.api.auth import get_auth_service
from alethical.api.main import create_app
from alethical.api.services.auth import AuthenticatedPrincipal
from alethical.db.schema import load_schema
from alethical.db.session import get_engine

from fastapi.testclient import TestClient

schema = load_schema()
AuthIdentity = schema.AuthIdentity
UserAccount = schema.UserAccount


def _read_identity(provider_subject: str):
    with Session(get_engine()) as db:
        identity = db.scalar(
            select(AuthIdentity).where(
                AuthIdentity.provider == "supabase",
                AuthIdentity.provider_subject == provider_subject,
            )
        )
        if identity is None:
            return None
        user = db.scalar(select(UserAccount).where(UserAccount.id == identity.user_id))
        return {
            "identity_updated_at": identity.updated_at,
            "identity_last_used_at": identity.last_used_at,
            "user_id": user.id,
            "user_updated_at": user.updated_at,
            "user_last_signed_in_at": user.last_signed_in_at,
        }


def test_repeated_authenticated_read_does_not_write(client, auth_headers):
    """A second authenticated GET for an existing user commits nothing."""
    # First call resolves or provisions the fixture user (supabase-user-ada).
    assert client.get("/api/v1/me", headers=auth_headers).status_code == 200
    before = _read_identity("supabase-user-ada")
    assert before is not None

    commits: list[int] = []

    def _record_commit(_session):
        commits.append(1)

    event.listen(Session, "after_commit", _record_commit)
    try:
        second = client.get("/api/v1/me", headers=auth_headers)
    finally:
        event.remove(Session, "after_commit", _record_commit)

    assert second.status_code == 200
    assert commits == [], "read-path auth dependency committed on a plain read"

    after = _read_identity("supabase-user-ada")
    # updated_at has onupdate=func.now(), so an unchanged value proves no UPDATE.
    assert after["identity_updated_at"] == before["identity_updated_at"]
    assert after["user_updated_at"] == before["user_updated_at"]
    assert after["identity_last_used_at"] == before["identity_last_used_at"]
    assert after["user_last_signed_in_at"] == before["user_last_signed_in_at"]


def test_first_sign_in_provisions_and_writes():
    """A never-seen subject is provisioned on first authenticated request."""
    subject = "supabase-user-provision-108"
    email = "provision-108@example.com"

    class FakeAuthService:
        def authenticate(self, bearer_token: str) -> AuthenticatedPrincipal:
            return AuthenticatedPrincipal(
                provider="supabase",
                provider_subject=subject,
                email=email,
                email_verified=True,
            )

    app = create_app()
    app.dependency_overrides[get_auth_service] = lambda: FakeAuthService()
    fresh = TestClient(app)

    # Clean slate so provisioning is genuinely exercised regardless of test order.
    with Session(get_engine()) as db:
        existing = db.scalar(
            select(AuthIdentity).where(
                AuthIdentity.provider == "supabase",
                AuthIdentity.provider_subject == subject,
            )
        )
        if existing is not None:
            user = db.scalar(
                select(UserAccount).where(UserAccount.id == existing.user_id)
            )
            db.delete(existing)
            if user is not None:
                db.delete(user)
            db.commit()

    assert _read_identity(subject) is None

    assert (
        fresh.get("/api/v1/me", headers={"Authorization": "Bearer any"}).status_code
        == 200
    )

    provisioned = _read_identity(subject)
    assert provisioned is not None
    assert provisioned["user_last_signed_in_at"] is not None
    assert provisioned["identity_last_used_at"] is not None
