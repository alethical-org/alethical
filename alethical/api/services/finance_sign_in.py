"""Alethical Finance's sign-in by emailed code, sent by Alethical itself.

Finance has no sign-up (Finance access decisions, issue 2741), and whether an
address is on its access list names a client, so no answer may reveal it. The
request route checks only the address's form and answers at once; the list
check, the new code and the email happen after that answer has gone. Codes go
only to active list entries, through Alethical's own email sender, and are kept
only as salted hashes with an expiry and a limit on wrong tries.

A proved code is exchanged for a 1-time Supabase sign-in token: the Supabase
account is created or found only then, with the server's secret key, and the
browser turns the token into its session. Every Finance request checks the list
again (``alethical/api/finance_access.py``).
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import os
import secrets
from dataclasses import dataclass
from datetime import timedelta

import httpx
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from alethical.api.services.contact import DEFAULT_FROM, _allowlist, _enabled
from alethical.api.services.finance_access import normalize_email
from alethical.db.models import FinanceAccessEntry, FinanceSignInCode
from alethical.db.session import get_session_factory

logger = logging.getLogger(__name__)

CODE_DIGITS = 8
CODE_LIFETIME = timedelta(minutes=10)
# The same wait the sign-in screen shows before "Send a new code" works again.
RESEND_WAIT = timedelta(seconds=60)
MAX_WRONG_TRIES = 5
RESEND_URL = "https://api.resend.com/emails"
# Slow enough that a copied hash cannot be tried against all 10^8 codes before it
# expires; about 50 ms per check.
_SCRYPT = {"n": 2**14, "r": 8, "p": 1, "dklen": 32}


class SignInCodeUnavailable(RuntimeError):
    """Code sign-in is not configured here, or Supabase did not answer."""


class CodeNotAccepted(ValueError):
    """The 1 answer for a wrong, expired, used, exhausted or never-sent code."""


@dataclass(frozen=True)
class _Settings:
    supabase_url: str
    secret_key: str
    resend_key: str
    from_address: str


def _settings() -> _Settings:
    """Everything sending and proving a code needs, or SignInCodeUnavailable.

    Off unless ALETHICAL_FINANCE_SIGN_IN_CODE_ENABLED is set, so no code is sent
    until the secret key and the sender are in place.
    """
    settings = _Settings(
        supabase_url=os.environ.get("SUPABASE_URL", "").strip().rstrip("/"),
        secret_key=os.environ.get("SUPABASE_SECRET_KEY", "").strip(),
        resend_key=os.environ.get("RESEND_API_KEY", "").strip(),
        from_address=os.environ.get("ALETHICAL_EMAIL_FROM", DEFAULT_FROM).strip()
        or DEFAULT_FROM,
    )
    if not (
        _enabled(os.environ.get("ALETHICAL_FINANCE_SIGN_IN_CODE_ENABLED"))
        and _enabled(os.environ.get("ALETHICAL_EMAIL_ENABLED"))
        and os.environ.get("ALETHICAL_EMAIL_TRANSPORT", "").strip().lower() == "resend"
        and settings.supabase_url.startswith(("https://", "http://localhost:"))
        and settings.secret_key
        and settings.resend_key
    ):
        raise SignInCodeUnavailable("Finance code sign-in is not configured")
    return settings


def _hash(code: str, salt: bytes) -> str:
    digest = hashlib.scrypt(code.encode(), salt=salt, **_SCRYPT)
    return f"{salt.hex()}${digest.hex()}"


def _matches(code: str, stored: str) -> bool:
    salt, _, _ = stored.partition("$")
    return hmac.compare_digest(_hash(code, bytes.fromhex(salt)), stored)


# Checked when no code is held, so a never-sent code takes as long as a wrong one.
_DECOY = "00" * 16 + "$" + "00" * 32


def check_request(raw_email: str) -> str:
    """The address to send to, checked for form and configuration only.

    Raises ValueError for a value that cannot be an address and
    SignInCodeUnavailable when this server cannot send codes; neither depends on
    the access list, so the answer is the same for every address.
    """
    email = normalize_email(raw_email)
    _settings()
    return email


def _session() -> Session:
    return get_session_factory()()


def deliver_code(email: str) -> None:
    """After the answer has gone: email a new code if the address is listed."""
    try:
        settings = _settings()
        db = _session()
        try:
            created = _new_code(db, email)
        finally:
            db.close()
    except Exception as exc:  # noqa: BLE001 -- nothing may reach the caller
        logger.warning("Finance sign-in code not created: %s", type(exc).__name__)
        return
    if created is None:
        return
    code_id, code = created
    allowed = _allowlist()
    if allowed is not None and email not in allowed:
        logger.info("Finance sign-in code held back by ALETHICAL_EMAIL_ALLOWLIST")
        return
    _send(settings, email, code, code_id)


def _new_code(db: Session, email: str) -> tuple[str, str] | None:
    # Locks the entry, so 2 requests for 1 address cannot both send.
    listed = db.scalar(
        select(FinanceAccessEntry.id)
        .where(
            FinanceAccessEntry.email == email, FinanceAccessEntry.revoked_at.is_(None)
        )
        .with_for_update()
    )
    if listed is None:
        db.rollback()
        return None
    recent = db.scalar(
        select(FinanceSignInCode.id).where(
            FinanceSignInCode.email == email,
            FinanceSignInCode.created_at > func.now() - RESEND_WAIT,
        )
    )
    if recent is not None:
        db.rollback()
        return None
    # A new code replaces every earlier one; a day-old row of any address goes.
    db.execute(
        delete(FinanceSignInCode).where(
            (FinanceSignInCode.email == email)
            | (FinanceSignInCode.created_at < func.now() - timedelta(days=1))
        )
    )
    code = f"{secrets.randbelow(10**CODE_DIGITS):0{CODE_DIGITS}d}"
    row = FinanceSignInCode(
        email=email,
        code_hash=_hash(code, secrets.token_bytes(16)),
        expires_at=func.now() + CODE_LIFETIME,
    )
    db.add(row)
    db.commit()
    return str(row.id), code


def _send(settings: _Settings, email: str, code: str, code_id: str) -> None:
    minutes = int(CODE_LIFETIME.total_seconds() // 60)
    try:
        response = httpx.post(
            RESEND_URL,
            headers={
                "Authorization": f"Bearer {settings.resend_key}",
                "Idempotency-Key": f"finance-sign-in/{code_id}",
            },
            json={
                "from": settings.from_address,
                "to": [email],
                "subject": "Your Alethical Finance sign-in code",
                "text": "\n".join(
                    [
                        f"Your Alethical Finance sign-in code is {code}.",
                        "",
                        f"It works once, for the next {minutes} minutes.",
                        "If you did not ask to sign in, you can ignore this email:"
                        " nobody can sign in without the code.",
                    ]
                ),
            },
            timeout=httpx.Timeout(8.0, connect=3.0),
        )
    except httpx.HTTPError as exc:
        logger.warning("Finance sign-in code email failed: %s", type(exc).__name__)
        return
    if response.status_code >= 400:
        logger.warning(
            "Finance sign-in code email refused with HTTP %s", response.status_code
        )


def prove_code(db: Session, raw_email: str, raw_code: str) -> dict:
    """A 1-time Supabase sign-in token for a proved code.

    Raises CodeNotAccepted the same way for an unlisted address, a wrong,
    expired or used code and one with too many wrong tries; ValueError for a
    malformed address; SignInCodeUnavailable when this server or Supabase cannot
    finish. The code is used up only once Supabase has issued the token.
    """
    email = normalize_email(raw_email)
    settings = _settings()
    code = raw_code.strip() if isinstance(raw_code, str) else ""
    held = db.scalar(
        select(FinanceSignInCode)
        .where(
            FinanceSignInCode.email == email,
            FinanceSignInCode.used_at.is_(None),
            FinanceSignInCode.expires_at > func.now(),
            FinanceSignInCode.wrong_tries < MAX_WRONG_TRIES,
        )
        .order_by(FinanceSignInCode.created_at.desc())
        .limit(1)
        .with_for_update()
    )
    # The slow check runs on every path, so its time never shows whether a code
    # is held; the route also answers every refusal after the same minimum time.
    matched = _matches(code, held.code_hash if held is not None else _DECOY)
    if held is None:
        db.rollback()
        raise CodeNotAccepted
    if not (matched and code.isdigit() and len(code) == CODE_DIGITS):
        held.wrong_tries += 1
        db.commit()
        raise CodeNotAccepted
    listed = db.scalar(
        select(FinanceAccessEntry.id).where(
            FinanceAccessEntry.email == email, FinanceAccessEntry.revoked_at.is_(None)
        )
    )
    if listed is None:
        held.used_at = func.now()
        db.commit()
        raise CodeNotAccepted
    token = _supabase_token(settings, email)
    held.used_at = func.now()
    db.commit()
    return token


def _supabase_token(settings: _Settings, email: str) -> dict:
    """Create or find the Supabase account, then issue a 1-time sign-in token."""
    headers = {"apikey": settings.secret_key, "Content-Type": "application/json"}
    if not settings.secret_key.startswith("sb_secret_"):
        # A legacy service-role key is a token Supabase also wants as the bearer.
        headers["Authorization"] = f"Bearer {settings.secret_key}"
    timeout = httpx.Timeout(8.0, connect=3.0)
    try:
        created = httpx.post(
            f"{settings.supabase_url}/auth/v1/admin/users",
            headers=headers,
            json={"email": email, "email_confirm": True},
            timeout=timeout,
        )
        # 422 is an account that already exists; issuing the token decides.
        if created.status_code >= 400 and created.status_code not in (409, 422):
            raise SignInCodeUnavailable(f"account HTTP {created.status_code}")
        issued = httpx.post(
            f"{settings.supabase_url}/auth/v1/admin/generate_link",
            headers=headers,
            json={"type": "magiclink", "email": email},
            timeout=timeout,
        )
    except httpx.HTTPError as exc:
        raise SignInCodeUnavailable(type(exc).__name__) from None
    if issued.status_code >= 400:
        raise SignInCodeUnavailable(f"token HTTP {issued.status_code}")
    try:
        body = issued.json()
    except ValueError:
        raise SignInCodeUnavailable("token answer unreadable") from None
    properties = body.get("properties") if isinstance(body, dict) else None
    source = properties if isinstance(properties, dict) else body
    token = source.get("hashed_token") if isinstance(source, dict) else None
    if not isinstance(token, str) or not token:
        raise SignInCodeUnavailable("no token issued")
    return {"token_hash": token, "type": "magiclink"}
