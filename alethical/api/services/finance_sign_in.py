"""Send an Alethical Finance sign-in code only to an address on the access list.

Finance has no sign-up (Finance access decisions, issue 2741). If the browser
asked Supabase for a code directly, any typed address would get a new account,
and Supabase's answer would tell the caller which addresses already have one.
So the server checks the list first, asks Supabase for a code only for an
active entry, and the caller gets the same answer either way. The person then
proves the code to Supabase from the browser, and every Finance request checks
the list again (``alethical/api/finance_access.py``).
"""

from __future__ import annotations

import logging
import os
import threading
import time

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from alethical.api.services.finance_access import normalize_email
from alethical.db.models import FinanceAccessEntry

logger = logging.getLogger(__name__)

# The same wait the sign-in screen shows before "Send a new code" works again,
# and Supabase's own minimum between emails to 1 address.
RESEND_WAIT_SECONDS = 60


class SignInCodeUnavailable(RuntimeError):
    """Code sign-in is not configured here, so no address can be sent a code."""


class _RecentRequests:
    """Per-process memory of when each listed address last got a code request."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._sent: dict[str, float] = {}

    def claim(self, email: str, now: float) -> bool:
        with self._lock:
            for address, sent in list(self._sent.items()):
                if now - sent >= RESEND_WAIT_SECONDS:
                    del self._sent[address]
            if email in self._sent:
                return False
            self._sent[email] = now
            return True


RECENT = _RecentRequests()


def _settings() -> tuple[str, str, str]:
    supabase_url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_PUBLISHABLE_KEY") or os.environ.get(
        "SUPABASE_ANON_KEY", ""
    )
    # A first-time address gets Supabase's confirmation email, whose link goes
    # to this address. Without it the link would fall back to the project's
    # Site URL, alethical.com, and Finance never links there.
    return_url = os.environ.get("ALETHICAL_FINANCE_SIGN_IN_RETURN_URL", "")
    if not (supabase_url and key and return_url.startswith("https://")):
        if not (return_url.startswith("http://localhost:") and supabase_url and key):
            raise SignInCodeUnavailable("Finance code sign-in is not configured")
    return supabase_url, key, return_url


def _is_listed(db: Session, email: str) -> bool:
    return (
        db.scalar(
            select(FinanceAccessEntry.id).where(
                FinanceAccessEntry.email == email,
                FinanceAccessEntry.revoked_at.is_(None),
            )
        )
        is not None
    )


def _send(supabase_url: str, key: str, return_url: str, email: str) -> None:
    try:
        response = httpx.post(
            f"{supabase_url}/auth/v1/otp",
            params={"redirect_to": return_url},
            headers={"apikey": key, "Content-Type": "application/json"},
            # Creating the Supabase account here is the list provisioning it, not
            # a sign-up: only an active entry reaches this call.
            json={"email": email, "create_user": True},
            timeout=httpx.Timeout(8.0, connect=3.0),
        )
    except httpx.HTTPError as exc:
        logger.warning("Finance sign-in code request failed: %s", type(exc).__name__)
        return
    if response.status_code >= 400:
        # Never returned to the caller: a failure only a listed address can
        # reach would tell the caller the address is listed.
        logger.warning(
            "Finance sign-in code request refused with HTTP %s", response.status_code
        )


def send_code(request: tuple[str, str, str, str]) -> None:
    _send(*request)


def code_request_for(db: Session, raw_email: str) -> tuple[str, str, str, str] | None:
    """What to send Supabase for a listed address, or None for any other.

    Raises ValueError for a value that cannot be an address and
    SignInCodeUnavailable when this server cannot send codes at all. Neither
    depends on whether the address is listed. The caller sends after its
    response has gone, so a listed address does not answer slower than an
    unlisted one.
    """
    email = normalize_email(raw_email)
    supabase_url, key, return_url = _settings()
    if not _is_listed(db, email):
        return None
    if not RECENT.claim(email, time.monotonic()):
        return None
    return supabase_url, key, return_url, email
