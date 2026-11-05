"""Operator-managed, read-only Finance accounts with revocable opaque sessions.

These credentials never create a Supabase user and cannot authorize public-site
account changes. Passwords and bearer tokens are stored only as salted password
hashes and SHA-256 token digests. Every Finance request reads current access.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import timedelta

from sqlalchemy import delete, func, select, text
from sqlalchemy.orm import Session

from alethical.api.services.finance_access import FinanceAccount, normalize_email
from alethical.db.models import FinanceResearchAccount, FinanceResearchSession

TOKEN_PREFIX = "finance_research_"
SESSION_DAYS = 30
# Fixed parameters keep stored input from asking the server for unbounded work.
_SCRYPT_N = 32768
_SCRYPT_R = 8
_SCRYPT_P = 3
_DUMMY_HASH = "scrypt$" + "00" * 16 + "$" + "00" * 32


class CredentialsNotAccepted(Exception):
    pass


def _derive(password: str, salt: bytes) -> bytes:
    return hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=_SCRYPT_N,
        r=_SCRYPT_R,
        p=_SCRYPT_P,
        dklen=32,
        maxmem=64 * 1024 * 1024,
    )


def hash_password(password: str) -> str:
    if not 8 <= len(password) <= 1024:
        raise ValueError("Use a password between 8 and 1024 characters.")
    salt = secrets.token_bytes(16)
    return f"scrypt${salt.hex()}${_derive(password, salt).hex()}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        scheme, salt_hex, digest_hex = encoded.split("$")
        salt = bytes.fromhex(salt_hex)
        digest = bytes.fromhex(digest_hex)
        if scheme != "scrypt" or len(salt) != 16 or len(digest) != 32:
            return False
    except (ValueError, AttributeError):
        return False
    return hmac.compare_digest(_derive(password, salt), digest)


def _lock_address(db: Session, email: str) -> None:
    # Also serializes the first creation, before there is an account row to lock.
    db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
        {"key": "finance-research:" + email},
    )


def set_password(db: Session, email: str, password: str) -> FinanceResearchAccount:
    """Create/restore an account or change its password, ending all old sessions.

    Caller commits. The account row lock also serializes login with rotation.
    A login either completes before rotation and loses its session, or checks the
    new password after it; an old password can never leave a surviving session.
    """
    email = normalize_email(email)
    encoded = hash_password(password)
    _lock_address(db, email)
    account = db.scalar(
        select(FinanceResearchAccount)
        .where(FinanceResearchAccount.email == email)
        .with_for_update()
    )
    if account is None:
        account = FinanceResearchAccount(email=email, password_hash=encoded)
        db.add(account)
    else:
        account.password_hash = encoded
        account.revoked_at = None
        account.password_changed_at = func.now()
        db.execute(
            delete(FinanceResearchSession).where(
                FinanceResearchSession.account_id == account.id
            )
        )
    db.flush()
    db.refresh(account)
    return account


def revoke(db: Session, email: str) -> FinanceResearchAccount | None:
    email = normalize_email(email)
    _lock_address(db, email)
    account = db.scalar(
        select(FinanceResearchAccount)
        .where(FinanceResearchAccount.email == email)
        .with_for_update()
    )
    if account is not None:
        account.revoked_at = func.now()
        db.execute(
            delete(FinanceResearchSession).where(
                FinanceResearchSession.account_id == account.id
            )
        )
        db.flush()
        db.refresh(account)
    return account


def sign_in(db: Session, email: str, password: str) -> dict:
    try:
        normalized = normalize_email(email)
    except ValueError:
        normalized = ""
    account = db.scalar(
        select(FinanceResearchAccount)
        .where(FinanceResearchAccount.email == normalized)
        .with_for_update()
    )
    accepted = verify_password(
        password, account.password_hash if account else _DUMMY_HASH
    )
    if not accepted or account is None or account.revoked_at is not None:
        raise CredentialsNotAccepted
    now = db.execute(select(func.now())).scalar_one()
    expires = now + timedelta(days=SESSION_DAYS)
    token = TOKEN_PREFIX + secrets.token_urlsafe(32)
    # Bound retained expired rows without a recurring job.
    db.execute(
        delete(FinanceResearchSession).where(
            FinanceResearchSession.account_id == account.id,
            FinanceResearchSession.expires_at <= now,
        )
    )
    db.add(
        FinanceResearchSession(
            token_digest=hashlib.sha256(token.encode()).hexdigest(),
            account_id=account.id,
            expires_at=expires,
        )
    )
    db.flush()
    return {
        "access_token": token,
        "email": account.email,
        "expires_at": expires.isoformat(),
    }


def _digest(token: str) -> str | None:
    if not token.startswith(TOKEN_PREFIX) or len(token) != len(TOKEN_PREFIX) + 43:
        return None
    return hashlib.sha256(token.encode()).hexdigest()


def session_account(db: Session, token: str) -> FinanceAccount | None:
    digest = _digest(token)
    if digest is None:
        return None
    account = db.scalar(
        select(FinanceResearchAccount)
        .join(
            FinanceResearchSession,
            FinanceResearchSession.account_id == FinanceResearchAccount.id,
        )
        .where(
            FinanceResearchSession.token_digest == digest,
            FinanceResearchSession.expires_at > func.now(),
            FinanceResearchAccount.revoked_at.is_(None),
        )
    )
    if account is None:
        return None
    return FinanceAccount(
        provider_subject=f"finance-research:{account.id}",
        email=account.email,
        is_alethical_team=False,
        can_edit=False,
    )


def sign_out(db: Session, token: str) -> None:
    digest = _digest(token)
    if digest:
        db.execute(
            delete(FinanceResearchSession).where(
                FinanceResearchSession.token_digest == digest
            )
        )
