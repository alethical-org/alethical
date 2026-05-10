from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
import os

from supabase import create_client


@dataclass(frozen=True)
class AuthenticatedPrincipal:
    provider: str
    provider_subject: str
    email: str | None = None
    email_verified: bool = False


class SupabaseAuthService:
    def __init__(self, *, supabase_url: str, supabase_publishable_key: str):
        self._client = create_client(supabase_url, supabase_publishable_key)

    def authenticate(self, bearer_token: str) -> AuthenticatedPrincipal:
        claims_response = self._client.auth.get_claims(bearer_token)
        if claims_response is None:
            raise ValueError("Unable to verify Supabase JWT")
        claims = claims_response.get("claims") if isinstance(claims_response, dict) else claims_response.claims
        if not isinstance(claims, dict):
            raise ValueError("Unable to read Supabase JWT claims")
        subject = claims.get("sub")
        if not subject:
            raise ValueError("Supabase JWT missing subject")
        email = claims.get("email")
        email_verified = bool(claims.get("email_confirmed_at") or claims.get("phone_confirmed_at"))
        return AuthenticatedPrincipal(
            provider="supabase",
            provider_subject=subject,
            email=email,
            email_verified=email_verified,
        )


class LocalDevAuthService:
    def __init__(
        self,
        *,
        token: str,
        provider: str = "demo",
        provider_subject: str = "ada-demo",
        email: str = "ada@example.com",
    ):
        self._token = token
        self._provider = provider
        self._provider_subject = provider_subject
        self._email = email

    def authenticate(self, bearer_token: str) -> AuthenticatedPrincipal:
        if bearer_token != self._token:
            raise ValueError("Invalid development bearer token")
        return AuthenticatedPrincipal(
            provider=self._provider,
            provider_subject=self._provider_subject,
            email=self._email,
            email_verified=True,
        )


class CompositeAuthService:
    def __init__(self, *services):
        self._services = services

    def authenticate(self, bearer_token: str) -> AuthenticatedPrincipal:
        last_error: Exception | None = None
        for service in self._services:
            try:
                return service.authenticate(bearer_token)
            except ValueError as exc:
                last_error = exc
                continue
        if last_error is not None:
            raise last_error
        raise ValueError("No authentication services configured")


@lru_cache(maxsize=1)
def get_supabase_auth_service():
    services = []

    dev_auth_token = os.environ.get("ALETHICAL_DEV_AUTH_TOKEN")
    if dev_auth_token:
        services.append(LocalDevAuthService(token=dev_auth_token))

    supabase_url = os.environ.get("SUPABASE_URL")
    publishable_key = os.environ.get("SUPABASE_PUBLISHABLE_KEY") or os.environ.get("SUPABASE_ANON_KEY")
    if supabase_url and publishable_key:
        services.append(
            SupabaseAuthService(
                supabase_url=supabase_url,
                supabase_publishable_key=publishable_key,
            )
        )

    if not services:
        raise RuntimeError(
            "SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY or SUPABASE_ANON_KEY are required"
            " unless ALETHICAL_DEV_AUTH_TOKEN is set for local development"
        )

    if len(services) == 1:
        return services[0]

    return CompositeAuthService(*services)
