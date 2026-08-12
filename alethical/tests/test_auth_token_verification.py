"""The code that decides whether a sign-in token is real (#115).

`SupabaseAuthService.authenticate` guards every `/me` route, and until now it
had no direct coverage at all: every other test replaces the whole service with
a fake that string-compares a fixed token (`FakeSupabaseAuthService` in
`alethical/tests/conftest.py`), which is right for a contract test and means the
real claim-reading code was never run.

So these tests mock one level lower -- at the Supabase client boundary -- and
run the real `authenticate` over the claim shapes the library actually returns.
`get_claims` hands back a `ClaimsResponse`, which is a `dict` subclass, so the
dict branch is the live one; the attribute branch is a fallback and is covered
too.

The fail-closed guard that refuses the local dev token against production lives
one layer up in the service factory and is already covered by
`test_dev_auth_token_refused_when_target_is_production` in
`alethical/tests/test_api_contract.py`; the factory tests here cover the rest of
its branches without duplicating it.
"""

from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from alethical.api.auth import get_auth_service
from alethical.api.main import create_app
from alethical.api.services import auth as auth_module
from alethical.api.services.auth import (
    CompositeAuthService,
    LocalDevAuthService,
    SupabaseAuthService,
)

# The error a rejected or expired token really raises. `supabase` re-exports the
# AuthError base class but not this subclass, so `supabase-auth` is declared in
# pyproject.toml rather than reached through supabase's own requirements (#701).
from supabase_auth.errors import AuthInvalidJwtError, AuthRetryableError

SUPABASE_ENV = {
    "SUPABASE_URL": "https://project.supabase.co",
    "SUPABASE_PUBLISHABLE_KEY": "sb_publishable_test",
}
AUTH_ENV_VARS = (
    "ALETHICAL_DEV_AUTH_TOKEN",
    "ALETHICAL_DATABASE_TARGET",
    "SUPABASE_URL",
    "SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_ANON_KEY",
)


class _FakeGoTrue:
    """Stands in for `client.auth`, the only part of the Supabase client used."""

    def __init__(self):
        self._response = None
        self._error: Exception | None = None
        self._user_response = None
        self._user_error: Exception | None = None
        self.tokens_seen: list[str] = []
        self.user_tokens_seen: list[str] = []

    def configure(
        self,
        response=None,
        error: Exception | None = None,
        user_response=None,
        user_error: Exception | None = None,
    ) -> None:
        self._response = response
        self._error = error
        self._user_response = user_response
        self._user_error = user_error

    def get_claims(self, bearer_token: str):
        self.tokens_seen.append(bearer_token)
        if self._error is not None:
            raise self._error
        return self._response

    def get_user(self, bearer_token: str):
        self.user_tokens_seen.append(bearer_token)
        if self._user_error is not None:
            raise self._user_error
        return self._user_response


class _FakeSupabaseClient:
    def __init__(self):
        self.auth = _FakeGoTrue()


class _ClaimsResponseObject:
    """A claims response that exposes `.claims` instead of being a mapping."""

    def __init__(self, claims):
        self.claims = claims


@pytest.fixture(autouse=True)
def _stubbed_supabase_client(monkeypatch):
    """Replace only the Supabase client constructor, nothing above it.

    Everything these tests exercise -- reading the claims, mapping them onto a
    principal, refusing what it cannot read -- is the shipped code in
    `alethical/api/services/auth.py`, not a reimplementation of it.
    """
    monkeypatch.setattr(
        auth_module, "create_client", lambda url, key: _FakeSupabaseClient()
    )


@pytest.fixture()
def _clean_auth_env(monkeypatch):
    """Start a factory test from no auth configuration at all.

    `alethical/db/session.py` reads a developer's local `.env` into the
    environment at import time, so a real SUPABASE_URL can be present and would
    otherwise change which services the factory builds.
    """
    for name in AUTH_ENV_VARS:
        monkeypatch.delenv(name, raising=False)
    auth_module.get_supabase_auth_service.cache_clear()
    yield
    auth_module.get_supabase_auth_service.cache_clear()


def _service_returning(
    claims_response=None,
    *,
    error: Exception | None = None,
    user_response=None,
    user_error: Exception | None = None,
):
    """A real SupabaseAuthService set up to receive one fixed claims response."""
    service = SupabaseAuthService(
        supabase_url=SUPABASE_ENV["SUPABASE_URL"],
        supabase_publishable_key=SUPABASE_ENV["SUPABASE_PUBLISHABLE_KEY"],
    )
    service._client.auth.configure(
        response=claims_response,
        error=error,
        user_response=user_response,
        user_error=user_error,
    )
    return service, service._client.auth


def _trusted_user_response(*, subject: str, email: str | None, email_confirmed_at=None):
    return SimpleNamespace(
        user=SimpleNamespace(
            id=subject,
            email=email,
            email_confirmed_at=email_confirmed_at,
        )
    )


def test_a_valid_token_produces_the_matching_unconfirmed_principal():
    """The real JWT shape has no trusted email-confirmation field (#1466)."""
    service, gotrue = _service_returning(
        {
            "claims": {
                "sub": "5f3a0c0e-2c2b-4b9f-9c1a-0f2c8f6d7e11",
                "email": "Ada@Example.com",
            }
        }
    )

    principal = service.authenticate("header.payload.signature")

    assert principal.provider == "supabase"
    assert principal.provider_subject == "5f3a0c0e-2c2b-4b9f-9c1a-0f2c8f6d7e11"
    assert principal.email == "Ada@Example.com"
    assert principal.email_verified is False
    # The token reaches the verifier unchanged -- no trimming or re-encoding.
    assert gotrue.tokens_seen == ["header.payload.signature"]


def test_a_claims_response_exposing_an_attribute_is_read_too():
    """The fallback branch, for a client that returns an object not a mapping."""
    service, _ = _service_returning(
        _ClaimsResponseObject(
            {"sub": "attribute-shaped", "email": "attribute@example.com"}
        )
    )

    principal = service.authenticate("token")

    assert principal.provider_subject == "attribute-shaped"
    assert principal.email_verified is False


def test_a_trusted_confirmed_user_record_marks_the_email_verified():
    subject = "trusted-confirmed-subject"
    service, gotrue = _service_returning(
        {"claims": {"sub": subject, "email": "stale@example.com"}},
        user_response=_trusted_user_response(
            subject=subject,
            email="Current@Example.com",
            email_confirmed_at="2026-08-01T12:00:00Z",
        ),
    )

    principal = service.resolve_confirmed_email(
        "header.payload.signature", service.authenticate("header.payload.signature")
    )

    assert principal.email == "Current@Example.com"
    assert principal.email_verified is True
    assert gotrue.user_tokens_seen == ["header.payload.signature"]


def test_an_unconfirmed_user_record_cannot_mark_the_email_verified():
    subject = "trusted-unconfirmed-subject"
    service, _ = _service_returning(
        {"claims": {"sub": subject, "email": "pending@example.com"}},
        user_response=_trusted_user_response(
            subject=subject,
            email="pending@example.com",
            email_confirmed_at=None,
        ),
    )

    principal = service.resolve_confirmed_email("token", service.authenticate("token"))

    assert principal.email == "pending@example.com"
    assert principal.email_verified is False


def test_a_user_record_for_a_different_subject_is_refused():
    service, _ = _service_returning(
        {"claims": {"sub": "token-subject", "email": "owner@example.com"}},
        user_response=_trusted_user_response(
            subject="different-subject",
            email="owner@example.com",
            email_confirmed_at="2026-08-01T12:00:00Z",
        ),
    )

    with pytest.raises(ValueError, match="subject does not match"):
        service.resolve_confirmed_email("token", service.authenticate("token"))


def test_a_missing_trusted_user_record_is_refused():
    service, _ = _service_returning(
        {"claims": {"sub": "missing-user", "email": "missing@example.com"}}
    )

    with pytest.raises(ValueError, match="Unable to read Supabase user"):
        service.resolve_confirmed_email("token", service.authenticate("token"))


def test_an_unverifiable_token_is_refused():
    """`get_claims` answering None means the token could not be verified."""
    service, _ = _service_returning(None)

    with pytest.raises(ValueError, match="Unable to verify Supabase JWT"):
        service.authenticate("token")


def test_unreadable_claims_are_refused():
    """A response whose claims are not a mapping is refused, not coerced."""
    service, _ = _service_returning({"claims": "not-a-mapping"})

    with pytest.raises(ValueError, match="Unable to read Supabase JWT claims"):
        service.authenticate("token")


@pytest.mark.parametrize(
    "claims",
    [
        pytest.param({"email": "nobody@example.com"}, id="subject-absent"),
        pytest.param({"sub": "", "email": "nobody@example.com"}, id="subject-empty"),
        pytest.param({"sub": None}, id="subject-null"),
    ],
)
def test_a_token_without_a_subject_is_refused(claims):
    """The subject is the account key, so a token without one cannot map to a user."""
    service, _ = _service_returning({"claims": claims})

    with pytest.raises(ValueError, match="Supabase JWT missing subject"):
        service.authenticate("token")


def test_a_token_the_verifier_rejects_raises_rather_than_returning_a_principal():
    """An expired or forged token surfaces the library's own error."""
    service, _ = _service_returning(error=AuthInvalidJwtError("JWT has expired"))

    with pytest.raises(AuthInvalidJwtError, match="JWT has expired"):
        service.authenticate("expired.token.here")


def test_an_absent_email_produces_a_principal_with_no_email():
    """Sign-in does not require an email; the account simply has none."""
    service, _ = _service_returning({"claims": {"sub": "no-email-subject"}})

    principal = service.authenticate("token")

    assert principal.provider_subject == "no-email-subject"
    assert principal.email is None
    assert principal.email_verified is False


def test_an_unconfirmed_email_is_carried_but_marked_unverified():
    service, _ = _service_returning(
        {"claims": {"sub": "unconfirmed-subject", "email": "pending@example.com"}}
    )

    principal = service.authenticate("token")

    assert principal.email == "pending@example.com"
    assert principal.email_verified is False


def test_a_confirmed_phone_alone_does_not_mark_the_email_verified():
    """A confirmed phone number is not a confirmed email address (#1039).

    ``phone_confirmed_at`` used to satisfy `email_verified` as well, so a
    phone-verified account with an unconfirmed address arrived claiming the
    address was proven. That flag is what decides whether an identity may join
    an existing account, so the two are now kept apart.
    """
    service, _ = _service_returning(
        {
            "claims": {
                "sub": "phone-only-subject",
                "email": "phone-only@example.com",
                "phone_confirmed_at": "2026-08-01T12:00:00Z",
            }
        }
    )

    assert service.authenticate("token").email_verified is False


def test_a_sign_in_pass_alone_never_marks_an_email_verified():
    """Even invented confirmation fields in a JWT cannot claim an account (#1466)."""
    service, gotrue = _service_returning(
        {
            "claims": {
                "sub": "claims-only-subject",
                "email": "claims-only@example.com",
                "email_confirmed_at": "2026-08-01T12:00:00Z",
                "phone_confirmed_at": "2026-08-01T12:00:00Z",
                "user_metadata": {"email_verified": True},
            }
        }
    )

    assert service.authenticate("token").email_verified is False
    assert gotrue.user_tokens_seen == []


def test_the_local_dev_service_accepts_only_its_own_token():
    service = LocalDevAuthService(token="dev-token")

    principal = service.authenticate("dev-token")
    assert principal.provider == "demo"
    assert principal.provider_subject == "ada-demo"
    assert principal.email_verified is True

    for wrong in ("", "dev-token ", "DEV-TOKEN", "another-token"):
        with pytest.raises(ValueError, match="Invalid development bearer token"):
            service.authenticate(wrong)


def test_the_composite_service_tries_each_configured_service_in_turn():
    dev = LocalDevAuthService(token="dev-token")
    supabase, _ = _service_returning(
        {"claims": {"sub": "supabase-subject", "email_confirmed_at": "2026-08-01"}}
    )
    composite = CompositeAuthService(dev, supabase)

    assert composite.authenticate("dev-token").provider == "demo"
    assert composite.authenticate("a.real.jwt").provider == "supabase"


def test_the_composite_service_reports_the_last_failure_when_none_accept():
    composite = CompositeAuthService(
        LocalDevAuthService(token="dev-token"),
        LocalDevAuthService(token="other-dev-token"),
    )

    with pytest.raises(ValueError, match="Invalid development bearer token"):
        composite.authenticate("neither-of-them")


def test_the_composite_service_with_nothing_configured_refuses_every_token():
    with pytest.raises(ValueError, match="No authentication services configured"):
        CompositeAuthService().authenticate("token")


def test_the_factory_refuses_to_build_with_no_configuration(_clean_auth_env):
    """No dev token and no Supabase keys means /me answers 503, never 200."""
    with pytest.raises(RuntimeError, match="SUPABASE_URL"):
        auth_module.get_supabase_auth_service()


def test_the_factory_builds_only_what_the_environment_configures(
    _clean_auth_env, monkeypatch
):
    monkeypatch.setenv("ALETHICAL_DEV_AUTH_TOKEN", "dev-token")
    assert isinstance(auth_module.get_supabase_auth_service(), LocalDevAuthService)

    auth_module.get_supabase_auth_service.cache_clear()
    monkeypatch.delenv("ALETHICAL_DEV_AUTH_TOKEN")
    for name, value in SUPABASE_ENV.items():
        monkeypatch.setenv(name, value)
    assert isinstance(auth_module.get_supabase_auth_service(), SupabaseAuthService)

    auth_module.get_supabase_auth_service.cache_clear()
    monkeypatch.setenv("ALETHICAL_DEV_AUTH_TOKEN", "dev-token")
    assert isinstance(auth_module.get_supabase_auth_service(), CompositeAuthService)


def test_the_factory_accepts_the_older_anon_key_name(_clean_auth_env, monkeypatch):
    """Deployments still setting SUPABASE_ANON_KEY must keep working."""
    monkeypatch.setenv("SUPABASE_URL", SUPABASE_ENV["SUPABASE_URL"])
    monkeypatch.setenv("SUPABASE_ANON_KEY", "sb_anon_test")

    assert isinstance(auth_module.get_supabase_auth_service(), SupabaseAuthService)


def _client_with_real_verification(
    claims_response=None, *, error=None, user_response=None, user_error=None
):
    """An app whose auth dependency is the real service over a stubbed client."""
    service, _ = _service_returning(
        claims_response,
        error=error,
        user_response=user_response,
        user_error=user_error,
    )
    app = create_app()
    app.dependency_overrides[get_auth_service] = lambda: service
    return TestClient(app)


def test_a_request_with_no_authorization_header_is_unauthorized():
    response = _client_with_real_verification().get("/api/v1/me")

    assert response.status_code == 401
    assert response.json()["title"] == "Unauthorized"


@pytest.mark.parametrize(
    "header",
    [
        pytest.param("some.jwt.value", id="scheme-missing"),
        pytest.param("Token some.jwt.value", id="wrong-scheme"),
        pytest.param("bearer some.jwt.value", id="lowercase-scheme"),
    ],
)
def test_a_malformed_authorization_header_is_unauthorized(header):
    """The scheme check runs before verification, so no token is even read."""
    response = _client_with_real_verification().get(
        "/api/v1/me", headers={"Authorization": header}
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Bearer token required"


def test_a_rejected_token_is_unauthorized_rather_than_a_server_error():
    response = _client_with_real_verification(
        error=AuthInvalidJwtError("Invalid JWT signature")
    ).get("/api/v1/me", headers={"Authorization": "Bearer forged.jwt.value"})

    assert response.status_code == 401
    assert response.json()["title"] == "Unauthorized"


def test_a_temporary_trusted_user_lookup_failure_is_service_unavailable():
    response = _client_with_real_verification(
        {"claims": {"sub": "temporary-failure", "email": "later@example.com"}},
        user_error=AuthRetryableError("Supabase is temporarily unavailable", 503),
    ).get("/api/v1/me", headers={"Authorization": "Bearer retry.this.request"})

    assert response.status_code == 503
    assert response.json()["title"] == "Service Unavailable"


def test_a_verified_token_reaches_the_account_it_names(client, auth_headers):
    """End to end: real verification code, real provisioning, real /me payload."""
    verified = _client_with_real_verification(
        {
            "claims": {
                "sub": "supabase-user-real-verification-115",
                "email": "real-verification-115@example.com",
            }
        },
        user_response=_trusted_user_response(
            subject="supabase-user-real-verification-115",
            email="real-verification-115@example.com",
            email_confirmed_at="2026-08-01T12:00:00Z",
        ),
    )

    response = verified.get(
        "/api/v1/me", headers={"Authorization": "Bearer a.real.jwt"}
    )

    assert response.status_code == 200
    assert response.json()["data"]["primary_email"] == (
        "real-verification-115@example.com"
    )
    # A different token maps to a different account, not this one.
    assert (
        client.get("/api/v1/me", headers=auth_headers).json()["data"]["primary_email"]
        == "ada@example.com"
    )


def test_2_confirmed_sign_in_methods_with_the_same_email_open_1_account():
    shared_email = f"shared-sign-in-{uuid.uuid4()}@example.com"
    first_subject = f"first-sign-in-{uuid.uuid4()}"
    second_subject = f"second-sign-in-{uuid.uuid4()}"
    service, gotrue = _service_returning(
        {"claims": {"sub": first_subject, "email": shared_email}},
        user_response=_trusted_user_response(
            subject=first_subject,
            email=shared_email,
            email_confirmed_at="2026-08-01T12:00:00Z",
        ),
    )
    app = create_app()
    app.dependency_overrides[get_auth_service] = lambda: service
    sign_in_client = TestClient(app)
    headers = {"Authorization": "Bearer same.person.first.method"}

    first = sign_in_client.get("/api/v1/me", headers=headers)

    gotrue.configure(
        response={"claims": {"sub": second_subject, "email": shared_email}},
        user_response=_trusted_user_response(
            subject=second_subject,
            email=shared_email,
            email_confirmed_at="2026-08-01T12:00:00Z",
        ),
    )
    headers = {"Authorization": "Bearer same.person.second.method"}
    second = sign_in_client.get("/api/v1/me", headers=headers)

    assert first.status_code == 200
    assert second.status_code == 200
    assert second.json()["data"]["id"] == first.json()["data"]["id"]


def test_an_existing_blank_email_repairs_once_then_skips_the_user_lookup():
    """The 2 known live accounts repair on use without slowing later reads (#1466)."""
    subject = f"supabase-user-email-repair-{uuid.uuid4()}"
    email = f"email-repair-{uuid.uuid4()}@example.com"
    claims_response = {"claims": {"sub": subject, "email": email}}
    service, gotrue = _service_returning(
        claims_response,
        user_response=_trusted_user_response(
            subject=subject,
            email=email,
            email_confirmed_at=None,
        ),
    )
    app = create_app()
    app.dependency_overrides[get_auth_service] = lambda: service
    repair_client = TestClient(app)
    headers = {"Authorization": "Bearer repair.this.email"}

    first = repair_client.get("/api/v1/me", headers=headers)
    assert first.status_code == 200
    assert first.json()["data"]["primary_email"] is None

    gotrue.configure(
        response=claims_response,
        user_response=_trusted_user_response(
            subject=subject,
            email=email,
            email_confirmed_at="2026-08-01T12:00:00Z",
        ),
    )
    second = repair_client.get("/api/v1/me", headers=headers)
    third = repair_client.get("/api/v1/me", headers=headers)

    assert second.json()["data"]["primary_email"] == email
    assert third.json()["data"]["primary_email"] == email
    assert gotrue.user_tokens_seen == ["repair.this.email", "repair.this.email"]
