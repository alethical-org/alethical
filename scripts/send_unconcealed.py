#!/usr/bin/env python3
"""Prepare a human-chosen Unconcealed research email; sending is gated off.

Example preparation: uv run python scripts/send_unconcealed.py the-money-only-goes-one-way
The default command reads published metadata, checks the public article and
counts currently eligible subscribers. It never contacts the sending API.

Live delivery requires a separate future operator action: --send, --confirm-slug,
ALETHICAL_UNCONCEALED_SEND_ENABLED=1, a verified sender, postal address, and a
Resend domain whose open and click tracking are disabled. Every recipient has a
durable delivery row; an uncertain attempt is never retried automatically.
"""

from __future__ import annotations

import argparse
import ast
import hashlib
import json
import os
import re
import sys
import time
import uuid
from datetime import date, datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import quote

import httpx
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from alethical.api.services.email_subscriptions import issue_unsubscribe_token
from alethical.api.services.unconcealed_email import (
    PublishedResearch,
    is_direct_public_research_url,
    render_research_email,
    sender_domain,
    validate_sender,
)
from alethical.db.models import (
    AuthIdentity,
    EmailSubscription,
    UnconcealedDelivery,
    UserAccount,
)
from alethical.db.session import NO_PREPARED_STATEMENTS, database_url_for_target

ROOT = Path(__file__).resolve().parents[1]
RESEARCH_INDEX = ROOT / "apps/frontend/src/lib/researchIndex.ts"
RESEND_URL = "https://api.resend.com"
TEMPLATE_VERSION = 1
TIMEOUT = 10.0


class SendRefused(RuntimeError):
    """A required safety check failed; do not send or claim delivery."""


class RecipientSuppressed(SendRefused):
    """A confirmed suppression skips this recipient, not the whole campaign."""


_last_provider_call = 0.0


def pace_provider() -> None:
    # Keep this manual sender below 2 requests/second, leaving capacity for
    # account email. Shared-team 429s still stop, never replay uncertain sends.
    global _last_provider_call
    wait = 0.6 - (time.monotonic() - _last_provider_call)
    if wait > 0:
        time.sleep(wait)
    _last_provider_call = time.monotonic()


class _PageHead(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.meta: dict[str, str] = {}
        self.canonical: str | None = None
        self.title: str = ""
        self._in_title = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        fields = dict(attrs)
        if tag == "title":
            self._in_title = True
        if tag == "meta":
            key = fields.get("property") or fields.get("name")
            if key and fields.get("content") is not None:
                self.meta[key.lower()] = fields["content"] or ""
        if tag == "link" and fields.get("rel") == "canonical":
            self.canonical = fields.get("href")

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._in_title = False

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title += data


def _short_date(value: date) -> str:
    return f"{value.strftime('%b')} {value.day}, {value.year}"


def published_research_from_registry(
    slug: str, source: str | None = None
) -> PublishedResearch:
    """Read only an exported research entry actually listed as published."""
    if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", slug):
        raise SendRefused("The research slug is invalid")
    registry = source if source is not None else RESEARCH_INDEX.read_text()
    array_match = re.search(
        r"export const PUBLISHED_PIECE_INDEX:[^=]*=\s*\[(.*?)\];", registry, re.S
    )
    if array_match is None:
        raise SendRefused("The published piece list could not be read")
    listed = set(re.findall(r"\b([A-Z][A-Z_]+_INDEX_ENTRY)\b", array_match.group(1)))
    for constant in listed:
        match = re.search(
            rf"export const {re.escape(constant)}: PieceIndexEntry = \{{(.*?)\n\}};",
            registry,
            re.S,
        )
        if match is None:
            raise SendRefused("A published piece entry could not be read")
        body = match.group(1)
        slug_match = re.search(r"\bslug:\s*('(?:\\.|[^'\\])*')", body)
        if slug_match is None or ast.literal_eval(slug_match.group(1)) != slug:
            continue
        if not re.search(r"\btraits:\s*\{\s*research:\s*true\b", body):
            raise SendRefused("That published piece is a guide, not research")
        if not re.search(r"\bindexed:\s*true\b", body):
            raise SendRefused("That research is not public for search")

        def value(field: str) -> str:
            found = re.search(rf"\b{field}:\s*('(?:\\.|[^'\\])*')", body)
            if found is None:
                raise SendRefused(f"Published research lacks {field}")
            return str(ast.literal_eval(found.group(1)))

        try:
            piece = PublishedResearch(
                slug=slug,
                title=value("title"),
                published_on=date.fromisoformat(value("publishedOn")),
                records_through=date.fromisoformat(value("recordsThrough")),
                public_url=f"https://www.alethical.com/read/research/{slug}",
            )
            piece.validate()
        except ValueError as exc:
            raise SendRefused("Published research metadata is invalid") from exc
        return piece
    raise SendRefused("The research slug is not in the published piece list")


def require_public_page(piece: PublishedResearch) -> None:
    """Compare the deployed article with the exact local published record."""
    if not is_direct_public_research_url(piece.public_url):
        raise SendRefused("The research address is not an allowed public page")
    try:
        response = httpx.get(piece.public_url, timeout=TIMEOUT, follow_redirects=False)
    except httpx.HTTPError as exc:
        raise SendRefused("The public research page could not be reached") from exc
    if response.status_code != 200 or "text/html" not in response.headers.get(
        "content-type", ""
    ):
        raise SendRefused("The public research page did not return HTML")
    if len(response.content) > 1_000_000:
        raise SendRefused("The public research page is unexpectedly large")
    head = _PageHead()
    head.feed(response.text)
    expected_description = (
        f"Published {_short_date(piece.published_on)} · "
        f"records through {_short_date(piece.records_through)}."
    )
    if (
        head.canonical != piece.public_url
        or head.title != f"{piece.title} | Alethical"
        or head.meta.get("article:published_time") != piece.published_on.isoformat()
        or head.meta.get("description") != expected_description
        or "noindex" in head.meta.get("robots", "").lower()
    ):
        raise SendRefused("The public article does not match the published record")


def _content_hash(piece: PublishedResearch, sender: str, postal: str) -> str:
    body = json.dumps(
        [
            TEMPLATE_VERSION,
            piece.slug,
            piece.title,
            piece.published_on.isoformat(),
            piece.records_through.isoformat(),
            piece.public_url,
            sender,
            postal,
        ],
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return hashlib.sha256(body.encode()).hexdigest()


def eligible_user_ids(db: Session) -> list[uuid.UUID]:
    verified_email = (
        select(AuthIdentity.id)
        .where(
            AuthIdentity.user_id == UserAccount.id,
            AuthIdentity.email == UserAccount.primary_email,
            AuthIdentity.email_verified_at.is_not(None),
        )
        .exists()
    )
    return list(
        db.scalars(
            select(UserAccount.id)
            .join(EmailSubscription, EmailSubscription.user_id == UserAccount.id)
            .where(
                UserAccount.is_active.is_(True),
                UserAccount.primary_email.is_not(None),
                EmailSubscription.research.is_(True),
                verified_email,
            )
            .order_by(UserAccount.id)
        )
    )


def require_campaign_ready(
    db: Session, piece: PublishedResearch, content_hash: str
) -> None:
    """One uncertain or changed delivery pauses the whole chosen campaign."""
    rows = db.scalars(
        select(UnconcealedDelivery).where(
            UnconcealedDelivery.campaign_key == piece.slug
        )
    )
    for row in rows:
        if row.content_hash != content_hash:
            raise SendRefused(
                "A prior delivery used different article or email content"
            )
        if row.state not in {"accepted", "canceled"}:
            raise SendRefused("A prior delivery needs human reconciliation")


def _currently_eligible(
    db: Session, user_id: uuid.UUID
) -> tuple[UserAccount, str] | None:
    account = db.scalar(
        select(UserAccount)
        .where(UserAccount.id == user_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if account is None or not account.is_active or not account.primary_email:
        return None
    preference = db.get(EmailSubscription, user_id, populate_existing=True)
    if preference is None or preference.research is not True:
        return None
    verified = db.scalar(
        select(AuthIdentity.id).where(
            AuthIdentity.user_id == user_id,
            AuthIdentity.email == account.primary_email,
            AuthIdentity.email_verified_at.is_not(None),
        )
    )
    if verified is None:
        return None
    return account, account.primary_email


def _api_headers(api_key: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {api_key}"}


def require_resend_domain_without_tracking(
    api_key: str, domain_id: str, sender: str
) -> None:
    if not re.fullmatch(r"[a-f0-9-]{36}", domain_id):
        raise SendRefused("The Resend domain ID is missing or invalid")
    try:
        pace_provider()
        response = httpx.get(
            f"{RESEND_URL}/domains/{domain_id}",
            headers=_api_headers(api_key),
            timeout=TIMEOUT,
        )
    except httpx.HTTPError as exc:
        raise SendRefused("Resend domain settings could not be read") from exc
    if response.status_code != 200:
        raise SendRefused("Resend domain settings could not be read")
    try:
        data = response.json()
    except ValueError as exc:
        raise SendRefused("Resend domain settings are invalid") from exc
    if (
        not isinstance(data, dict)
        or data.get("name") != sender_domain(sender)
        or data.get("status") != "verified"
        or data.get("open_tracking") is not False
        or data.get("click_tracking") is not False
    ):
        raise SendRefused("Sender domain is not verified with both tracking modes off")


def require_not_suppressed(api_key: str, email: str) -> None:
    try:
        pace_provider()
        response = httpx.get(
            f"{RESEND_URL}/suppressions/{quote(email, safe='')}",
            headers=_api_headers(api_key),
            timeout=TIMEOUT,
        )
    except httpx.HTTPError as exc:
        raise SendRefused("Recipient suppression status could not be read") from exc
    if response.status_code == 200:
        raise RecipientSuppressed("Recipient is suppressed by the email provider")
    if response.status_code != 404:
        raise SendRefused("Recipient suppression status could not be read")
    try:
        error = response.json()
    except ValueError as exc:
        raise SendRefused("Recipient suppression status could not be read") from exc
    if not isinstance(error, dict) or error.get("name") != "not_found":
        raise SendRefused("Recipient suppression status could not be read")


def _send_one(
    db: Session,
    *,
    user_id: uuid.UUID,
    piece: PublishedResearch,
    sender: str,
    postal: str,
    api_key: str,
    content_hash: str,
) -> str:
    """Reserve before the provider call so an uncertain call cannot repeat."""
    try:
        current = _currently_eligible(db, user_id)
        if current is None:
            db.rollback()
            return "no longer subscribed"
        _, email = current
        old = db.scalar(
            select(UnconcealedDelivery).where(
                UnconcealedDelivery.campaign_key == piece.slug,
                UnconcealedDelivery.user_id == user_id,
            )
        )
        if old is not None:
            old_hash = old.content_hash
            old_state = old.state
            db.rollback()
            if old_hash != content_hash:
                return "content changed"
            if old_state == "accepted":
                return "already accepted"
            if old_state == "canceled":
                return "already canceled"
            return "prior outcome unresolved"
        raw_token = issue_unsubscribe_token(db, user_id)
        delivery = UnconcealedDelivery(
            campaign_key=piece.slug,
            user_id=user_id,
            content_hash=content_hash,
            state="sending",
            attempted_at=datetime.now(timezone.utc),
        )
        db.add(delivery)
        db.commit()
        delivery_id = delivery.id
    except Exception:
        db.rollback()
        raise

    # The persisted "sending" row intentionally blocks a second attempt if the
    # process dies before Resend answers. Reconciliation is a human operation.
    try:
        current = _currently_eligible(db, user_id)
        if current is None:
            delivery = db.get(UnconcealedDelivery, delivery_id)
            if delivery is not None:
                delivery.state = "canceled"
            db.commit()
            return "no longer subscribed"
        _, email = current
        require_not_suppressed(api_key, email)
        message = render_research_email(
            piece, unsubscribe_token=raw_token, postal_address=postal
        )
        pace_provider()
        response = httpx.post(
            f"{RESEND_URL}/emails",
            headers={
                **_api_headers(api_key),
                "Content-Type": "application/json",
                "Idempotency-Key": f"unconcealed-{delivery_id}",
            },
            json={
                "from": sender,
                "to": [email],
                "reply_to": "ask@alethical.com",
                "subject": message.subject,
                "html": message.html,
                "text": message.text,
                "headers": message.headers,
            },
            timeout=TIMEOUT,
        )
        delivery = db.get(UnconcealedDelivery, delivery_id)
        if response.status_code != 200:
            delivery.state = "unknown"
            db.commit()
            return "provider did not confirm"
        data = response.json()
        if not isinstance(data, dict) or not isinstance(data.get("id"), str):
            delivery.state = "unknown"
            db.commit()
            return "provider did not confirm"
        delivery.state = "accepted"
        delivery.provider_id = data["id"]
        db.commit()
        return "accepted"
    except RecipientSuppressed:
        db.rollback()
        with db.begin():
            delivery = db.get(UnconcealedDelivery, delivery_id)
            if delivery is not None:
                delivery.state = "canceled"
        return "suppressed"
    except SendRefused:
        db.rollback()
        with db.begin():
            delivery = db.get(UnconcealedDelivery, delivery_id)
            if delivery is not None:
                delivery.state = "blocked"
        return "provider check refused"
    except Exception:
        db.rollback()
        with db.begin():
            delivery = db.get(UnconcealedDelivery, delivery_id)
            if delivery is not None:
                delivery.state = "unknown"
        return "outcome unknown"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("slug", help="Slug of a published research piece")
    parser.add_argument("--target", choices=("local", "production"), default="local")
    parser.add_argument(
        "--send", action="store_true", help="Attempt live sends after all gates"
    )
    parser.add_argument(
        "--confirm-slug", help="Repeat the slug to authorize this campaign"
    )
    parser.add_argument("--preview-dir", type=Path, help="Write HTML and text previews")
    parser.add_argument(
        "--reviewed-content-hash", help="Hash printed with a reviewed preview"
    )
    args = parser.parse_args(argv)
    try:
        piece = published_research_from_registry(args.slug)
        require_public_page(piece)
        engine = create_engine(
            database_url_for_target(args.target),
            pool_pre_ping=True,
            connect_args=NO_PREPARED_STATEMENTS,
        )
        with Session(engine, expire_on_commit=False) as db:
            recipients = eligible_user_ids(db)
            print(f"Public research: {piece.title}")
            print(f"Eligible subscribed accounts: {len(recipients)}")
            if args.preview_dir and args.send:
                raise SendRefused("Review the preview in a separate preparation run")
            sender = ""
            postal = os.environ.get("ALETHICAL_UNCONCEALED_POSTAL_ADDRESS", "").strip()
            digest = ""
            if args.preview_dir or args.send:
                sender = validate_sender(
                    os.environ.get("ALETHICAL_UNCONCEALED_FROM", "")
                )
                preview = render_research_email(
                    piece, unsubscribe_token="preview-token", postal_address=postal
                )
                digest = _content_hash(piece, sender, postal)
                if args.preview_dir:
                    args.preview_dir.mkdir(parents=True, exist_ok=True)
                    html_path = args.preview_dir / f"{piece.slug}.html"
                    text_path = args.preview_dir / f"{piece.slug}.txt"
                    html_path.write_text(preview.html)
                    text_path.write_text(preview.text)
                    print(f"Preview HTML: {html_path}")
                    print(f"Preview text: {text_path}")
                    print(f"Reviewed content hash: {digest}")
            if not args.send:
                print("Preparation complete. No email sent.")
                return 0
            if args.confirm_slug != piece.slug:
                raise SendRefused("The matching --confirm-slug is required")
            if not args.reviewed_content_hash or args.reviewed_content_hash != digest:
                raise SendRefused("A matching hash from a reviewed preview is required")
            if os.environ.get("ALETHICAL_UNCONCEALED_SEND_ENABLED", "").lower() not in {
                "1",
                "true",
                "yes",
                "on",
            }:
                raise SendRefused("Unconcealed live sending is disabled")
            if os.environ.get("ALETHICAL_EMAIL_TRANSPORT", "").lower() != "resend":
                raise SendRefused("The Resend transport is not configured")
            api_key = os.environ.get("RESEND_API_KEY", "").strip()
            if not api_key:
                raise SendRefused("The Resend API key is missing")
            require_resend_domain_without_tracking(
                api_key,
                os.environ.get("ALETHICAL_UNCONCEALED_RESEND_DOMAIN_ID", "").strip(),
                sender,
            )
            require_campaign_ready(db, piece, digest)
            outcomes: dict[str, int] = {}
            for user_id in recipients:
                result = _send_one(
                    db,
                    user_id=user_id,
                    piece=piece,
                    sender=sender,
                    postal=postal,
                    api_key=api_key,
                    content_hash=digest,
                )
                outcomes[result] = outcomes.get(result, 0) + 1
                if result in {
                    "outcome unknown",
                    "provider did not confirm",
                    "provider check refused",
                    "prior outcome unresolved",
                    "content changed",
                }:
                    break
            for label, count in sorted(outcomes.items()):
                print(f"{label}: {count}")
            if any(
                outcomes.get(label)
                for label in (
                    "outcome unknown",
                    "provider did not confirm",
                    "provider check refused",
                    "prior outcome unresolved",
                    "content changed",
                )
            ):
                return 2
            return 0
    except (SendRefused, ValueError) as exc:
        # No tokens, addresses, provider response bodies, or authentication values.
        print(f"Send refused: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
