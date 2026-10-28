"""Alethical Finance's sign-in by emailed code, sent by Alethical itself.

Finance has no sign-up (Finance access decisions, issue 2741), and whether an
address is on its access list names a client, so no answer may reveal it. The
request route checks only the address's form and answers every address the same
way, with a new random challenge. After that answer has gone, Finance's own 2
sending threads check the list and the sending caps, make the code and send the
email. Codes go only to active list entries, through Alethical's own email
sender, and are kept only as salted hashes beside a SHA-256 of their challenge,
with an expiry and a limit on wrong tries.

A code is proved together with the challenge its request was answered with, so
nobody else's requests or wrong tries can use it up. A proved code is exchanged
for a 1-time Supabase sign-in token: the Supabase account is created or found
only then, with the server's secret key, and the browser turns the token into
its session. Every Finance request checks the list again
(``alethical/api/finance_access.py``).
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import os
import secrets
from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass
from datetime import timedelta

import httpx
from sqlalchemy import delete, func, select, text
from sqlalchemy.orm import Session

from alethical.api.services.contact import DEFAULT_FROM, _allowlist, _enabled
from alethical.api.services.finance_access import normalize_email
from alethical.db.models import FinanceAccessEntry, FinanceSignInCode
from alethical.db.session import get_session_factory

logger = logging.getLogger(__name__)

CODE_DIGITS = 8
CODE_LIFETIME = timedelta(minutes=10)
MAX_WRONG_TRIES = 5
RESEND_URL = "https://api.resend.com/emails"

# Sending caps. Finance's codes share Resend's free plan (100 emails a day) with
# Contact us, comment alerts and alethical.com's sign-in emails, so Finance takes
# at most 40 of them. Each cap is checked after the answer has gone, so a code
# held back by a cap is answered like any other request.
CODES_PER_ADDRESS_PER_MINUTE = 1  # the sign-in screen's 60-second resend wait
CODES_PER_ADDRESS_PER_HOUR = 5
CODES_PER_ADDRESS_PER_DAY = 10
FINANCE_CODES_PER_DAY = 40
# Code rows stay this long so the caps can count them, then go.
KEEP_CODE_ROWS = timedelta(days=2)
# Delivery runs here, never in a request: it holds no request slot or worker.
SENDING_THREADS = 2
# Each Supabase call waits at most 1.5 s to connect and 3 s for each send and
# read. Both bodies are small (1 write, 1 read), so the 2 calls take at most
# 2 x (1.5 + 3) = 9 s, inside the browser's 10-second limit
# (REQUEST_TIMEOUT_MS in apps/finance/src/api/client.ts).
SUPABASE_TIMEOUT = httpx.Timeout(3.0, connect=1.5)
# Slow enough that a copied hash cannot be tried against all 10^8 codes before it
# expires; about 50 ms per check.
_SCRYPT = {"n": 2**14, "r": 8, "p": 1, "dklen": 32}
# 1 code is made at a time across every API process, so simultaneous requests
# cannot both pass a cap.
_MAKING_A_CODE = text("SELECT pg_advisory_xact_lock(hashtext('finance-sign-in-code'))")

_SENDING = ThreadPoolExecutor(
    max_workers=SENDING_THREADS, thread_name_prefix="finance-sign-in-code"
)


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


def new_challenge() -> str:
    """A random challenge for 1 code request, made alike for every address."""
    return secrets.token_urlsafe(32)


def _challenge_hash(challenge: str) -> str:
    return hashlib.sha256(challenge.encode()).hexdigest()


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


def _hand_off(work: Callable[..., None], *args: object) -> Future:
    """Run work on Finance's sending threads; tests replace this to run it inline."""
    return _SENDING.submit(work, *args)


def schedule_delivery(email: str, challenge: str) -> None:
    """Queue the list check, the caps and any email for 1 request, and return."""
    _hand_off(deliver_code, email, _challenge_hash(challenge))


def deliver_code(email: str, challenge_hash: str) -> None:
    """Email a new code if the address is listed and within every sending cap."""
    try:
        settings = _settings()
        db = _session()
        try:
            created = _new_code(db, email, challenge_hash)
        finally:
            db.close()
        if created is None:
            return
        code_id, code = created
        allowed = _allowlist()
        if allowed is not None and email not in allowed:
            logger.info("Finance sign-in code held back by ALETHICAL_EMAIL_ALLOWLIST")
            return
        _send(settings, email, code, code_id)
    except Exception as exc:  # noqa: BLE001 -- nothing may reach the caller
        logger.warning("Finance sign-in code not delivered: %s", type(exc).__name__)


def _over_a_cap(db: Session, email: str) -> bool:
    made = FinanceSignInCode.created_at
    mine = FinanceSignInCode.email == email
    minute, hour, day, everyone = db.execute(
        select(
            func.count().filter(mine, made > func.now() - timedelta(minutes=1)),
            func.count().filter(mine, made > func.now() - timedelta(hours=1)),
            func.count().filter(mine),
            func.count(),
        ).where(made > func.now() - timedelta(days=1))
    ).one()
    return (
        minute >= CODES_PER_ADDRESS_PER_MINUTE
        or hour >= CODES_PER_ADDRESS_PER_HOUR
        or day >= CODES_PER_ADDRESS_PER_DAY
        or everyone >= FINANCE_CODES_PER_DAY
    )


def _new_code(db: Session, email: str, challenge_hash: str) -> tuple[str, str] | None:
    db.execute(_MAKING_A_CODE)
    listed = db.scalar(
        select(FinanceAccessEntry.id).where(
            FinanceAccessEntry.email == email, FinanceAccessEntry.revoked_at.is_(None)
        )
    )
    if listed is None:
        db.rollback()
        return None
    if _over_a_cap(db, email):
        db.rollback()
        logger.info("Finance sign-in code held back by a sending cap")
        return None
    # Earlier codes stay valid for their own challenges; only old rows go.
    db.execute(
        delete(FinanceSignInCode).where(
            FinanceSignInCode.created_at < func.now() - KEEP_CODE_ROWS
        )
    )
    code = f"{secrets.randbelow(10**CODE_DIGITS):0{CODE_DIGITS}d}"
    row = FinanceSignInCode(
        email=email,
        code_hash=_hash(code, secrets.token_bytes(16)),
        challenge_hash=challenge_hash,
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


def prove_code(db: Session, raw_email: str, raw_code: str, raw_challenge: str) -> dict:
    """A 1-time Supabase sign-in token for a proved code.

    Raises CodeNotAccepted the same way for an unlisted address, a wrong,
    expired or used code, a wrong or missing challenge, one with too many wrong
    tries, and one another proof is checking at this moment; ValueError for a
    malformed address; SignInCodeUnavailable when this server or Supabase cannot
    finish. The code is used up only once Supabase has issued the token.
    """
    email = normalize_email(raw_email)
    settings = _settings()
    code = raw_code.strip() if isinstance(raw_code, str) else ""
    challenge = raw_challenge if isinstance(raw_challenge, str) else ""
    # A row another proof holds is skipped, never waited for, so simultaneous
    # tries cannot queue behind a held code and show that one exists.
    held = db.scalar(
        select(FinanceSignInCode)
        .where(
            FinanceSignInCode.challenge_hash == _challenge_hash(challenge),
            FinanceSignInCode.email == email,
            FinanceSignInCode.used_at.is_(None),
            FinanceSignInCode.expires_at > func.now(),
            FinanceSignInCode.wrong_tries < MAX_WRONG_TRIES,
        )
        .with_for_update(skip_locked=True)
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
    try:
        created = httpx.post(
            f"{settings.supabase_url}/auth/v1/admin/users",
            headers=headers,
            json={"email": email, "email_confirm": True},
            timeout=SUPABASE_TIMEOUT,
        )
        # 422 is an account that already exists; issuing the token decides.
        if created.status_code >= 400 and created.status_code not in (409, 422):
            raise SignInCodeUnavailable(f"account HTTP {created.status_code}")
        issued = httpx.post(
            f"{settings.supabase_url}/auth/v1/admin/generate_link",
            headers=headers,
            json={"type": "magiclink", "email": email},
            timeout=SUPABASE_TIMEOUT,
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
    # Supabase checks an "email" token against both a sign-in token and a new
    # account's sign-up token, whichever generate_link issued.
    return {"token_hash": token, "type": "email"}
