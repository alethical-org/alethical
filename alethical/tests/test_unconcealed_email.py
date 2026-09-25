"""Unconcealed mail must preserve published facts and prevent duplicate sends."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from types import SimpleNamespace

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from alethical.api.services.unconcealed_email import (
    PublishedResearch,
    render_research_email,
)
from alethical.db.models import (
    AuthIdentity,
    EmailSubscription,
    UnconcealedDelivery,
    UserAccount,
)
from alethical.db.session import get_engine
from scripts import send_unconcealed as sender

POSTAL = "123 Example Street, Saint Paul, MN 55101"


def _piece(title: str = "The Money Only Goes One Way") -> PublishedResearch:
    return PublishedResearch(
        slug="the-money-only-goes-one-way",
        title=title,
        published_on=date(2026, 8, 20),
        records_through=date(2026, 7, 20),
        public_url="https://www.alethical.com/read/research/the-money-only-goes-one-way",
    )


def test_email_escapes_article_title_and_has_matching_plain_text() -> None:
    piece = _piece("Money <script>alert('x')</script> & lobbying")
    message = render_research_email(
        piece, unsubscribe_token="safe-token_123", postal_address=POSTAL
    )
    assert "&lt;script&gt;" in message.html
    assert "<script>" not in message.html
    assert piece.title in message.text
    assert "Published August 20, 2026" in message.text
    assert "Records through July 20, 2026" in message.text
    assert (
        piece.public_url in message.text
        and f'href="{piece.public_url}"' in message.html
    )
    assert message.headers == {
        "List-Unsubscribe": (
            "<https://api.alethical.com/api/v1/email-subscriptions/"
            "one-click/safe-token_123>"
        ),
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    }
    assert "unsubscribe#unsubscribe=safe-token_123" in message.html
    assert "<img" not in message.html and "pixel" not in message.html
    assert "utm_" not in message.html and "resend.com" not in message.html


def test_email_refuses_missing_postal_and_non_public_address() -> None:
    with pytest.raises(ValueError, match="postal address"):
        render_research_email(
            _piece(), unsubscribe_token="safe-token", postal_address="TBD"
        )
    piece = PublishedResearch(
        slug="the-money-only-goes-one-way",
        title="Test",
        published_on=date(2026, 8, 20),
        records_through=date(2026, 7, 20),
        public_url="https://example.com/read/research/the-money-only-goes-one-way",
    )
    with pytest.raises(ValueError, match="public Alethical"):
        render_research_email(
            piece, unsubscribe_token="safe-token", postal_address=POSTAL
        )


def test_published_registry_allows_research_but_not_guide_or_missing_slug() -> None:
    piece = sender.published_research_from_registry("the-money-only-goes-one-way")
    assert piece.title == "The Money Only Goes One Way"
    assert piece.records_through.isoformat() == "2026-07-20"
    with pytest.raises(sender.SendRefused, match="guide"):
        sender.published_research_from_registry("who-has-to-report-their-money")
    with pytest.raises(sender.SendRefused, match="not in the published"):
        sender.published_research_from_registry("future-research")


def test_publication_check_requires_exact_live_title_dates_and_canonical(
    monkeypatch,
) -> None:
    body = """<html><head><title>The Money Only Goes One Way | Alethical</title>
    <link rel="canonical" href="https://www.alethical.com/read/research/the-money-only-goes-one-way">
    <meta property="article:published_time" content="2026-08-20">
    <meta name="description" content="Published Aug 20, 2026 · records through Jul 20, 2026.">
    </head></html>"""
    monkeypatch.setattr(
        sender.httpx,
        "get",
        lambda *args, **kwargs: httpx.Response(
            200,
            request=httpx.Request("GET", _piece().public_url),
            headers={"Content-Type": "text/html"},
            text=body,
        ),
    )
    sender.require_public_page(_piece())
    with pytest.raises(sender.SendRefused, match="does not match"):
        sender.require_public_page(_piece("Changed after publication"))


def test_provider_domain_and_suppression_gates(monkeypatch) -> None:
    calls: list[str] = []

    def fake_get(url: str, **kwargs):
        calls.append(url)
        if "/domains/" in url:
            return SimpleNamespace(
                status_code=200,
                json=lambda: {
                    "name": "alethical.com",
                    "status": "verified",
                    "open_tracking": False,
                    "click_tracking": False,
                },
            )
        return SimpleNamespace(status_code=404, json=lambda: {"name": "not_found"})

    monkeypatch.setattr(sender.httpx, "get", fake_get)
    sender.require_resend_domain_without_tracking(
        "re_fake",
        "00000000-0000-0000-0000-000000000001",
        "Unconcealed <ask@alethical.com>",
    )
    sender.require_not_suppressed("re_fake", "reader@example.com")
    assert calls == [
        "https://api.resend.com/domains/00000000-0000-0000-0000-000000000001",
        "https://api.resend.com/suppressions/reader%40example.com",
    ]
    monkeypatch.setattr(
        sender.httpx,
        "get",
        lambda url, **kwargs: SimpleNamespace(
            status_code=200,
            json=lambda: {
                "name": "alethical.com",
                "status": "verified",
                "open_tracking": True,
                "click_tracking": False,
            },
        ),
    )
    with pytest.raises(sender.SendRefused, match="tracking modes off"):
        sender.require_resend_domain_without_tracking(
            "re_fake",
            "00000000-0000-0000-0000-000000000001",
            "Unconcealed <ask@alethical.com>",
        )


def test_live_switch_blocks_send_even_with_reviewed_preview(
    seed_database, monkeypatch
) -> None:
    monkeypatch.setattr(sender, "require_public_page", lambda piece: None)
    monkeypatch.setenv("ALETHICAL_UNCONCEALED_FROM", "Unconcealed <ask@alethical.com>")
    monkeypatch.setenv("ALETHICAL_UNCONCEALED_POSTAL_ADDRESS", POSTAL)
    monkeypatch.delenv("ALETHICAL_UNCONCEALED_SEND_ENABLED", raising=False)
    monkeypatch.setattr(
        sender.httpx,
        "post",
        lambda *args, **kwargs: pytest.fail("Disabled delivery reached the provider"),
    )
    digest = sender._content_hash(_piece(), "Unconcealed <ask@alethical.com>", POSTAL)
    result = sender.main(
        [
            "the-money-only-goes-one-way",
            "--send",
            "--confirm-slug",
            "the-money-only-goes-one-way",
            "--reviewed-content-hash",
            digest,
        ]
    )
    assert result == 1


def test_preparation_writes_reviewable_html_and_text(
    seed_database, monkeypatch, tmp_path
) -> None:
    monkeypatch.setattr(sender, "require_public_page", lambda piece: None)
    monkeypatch.setenv("ALETHICAL_UNCONCEALED_FROM", "Unconcealed <ask@alethical.com>")
    monkeypatch.setenv("ALETHICAL_UNCONCEALED_POSTAL_ADDRESS", POSTAL)
    monkeypatch.setattr(
        sender.httpx,
        "post",
        lambda *args, **kwargs: pytest.fail("Preparation reached the provider"),
    )
    assert (
        sender.main(["the-money-only-goes-one-way", "--preview-dir", str(tmp_path)])
        == 0
    )
    html = (tmp_path / "the-money-only-goes-one-way.html").read_text()
    text = (tmp_path / "the-money-only-goes-one-way.txt").read_text()
    assert (
        "The Money Only Goes One Way" in html and "The Money Only Goes One Way" in text
    )
    assert "preview-token" in html and "preview-token" in text
    assert POSTAL in html and POSTAL in text


def test_uncertain_delivery_is_durable_and_never_retried(
    seed_database, monkeypatch
) -> None:
    user_id = uuid.uuid4()
    email = f"unconcealed-{user_id.hex}@example.com"
    with Session(get_engine()) as db:
        db.add(UserAccount(id=user_id, primary_email=email, is_active=True))
        db.flush()
        db.add(
            AuthIdentity(
                user_id=user_id,
                provider="supabase",
                provider_subject=f"unconcealed-{user_id.hex}",
                email=email,
                email_verified_at=datetime.now(timezone.utc),
            )
        )
        db.add(EmailSubscription(user_id=user_id, research=True, features=False))
        db.commit()

    calls = []
    monkeypatch.setattr(sender, "require_not_suppressed", lambda *_: None)

    def uncertain_post(*args, **kwargs):
        calls.append(kwargs)
        raise httpx.TimeoutException("outcome unknown")

    monkeypatch.setattr(sender.httpx, "post", uncertain_post)
    digest = sender._content_hash(_piece(), "Unconcealed <ask@alethical.com>", POSTAL)
    with Session(get_engine(), expire_on_commit=False) as db:
        assert user_id in sender.eligible_user_ids(db)
        first = sender._send_one(
            db,
            user_id=user_id,
            piece=_piece(),
            sender="Unconcealed <ask@alethical.com>",
            postal=POSTAL,
            api_key="re_fake",
            content_hash=digest,
        )
        second = sender._send_one(
            db,
            user_id=user_id,
            piece=_piece(),
            sender="Unconcealed <ask@alethical.com>",
            postal=POSTAL,
            api_key="re_fake",
            content_hash=digest,
        )
        rows = list(
            db.scalars(
                select(UnconcealedDelivery).where(
                    UnconcealedDelivery.user_id == user_id
                )
            )
        )
        with pytest.raises(sender.SendRefused, match="needs human reconciliation"):
            sender.require_campaign_ready(db, _piece(), digest)
    assert first == "outcome unknown"
    assert second == "prior outcome unresolved"
    assert len(calls) == 1 and len(rows) == 1 and rows[0].state == "unknown"
    assert calls[0]["headers"]["Idempotency-Key"] == f"unconcealed-{rows[0].id}"
    assert calls[0]["json"]["to"] == [email]
    assert calls[0]["json"]["headers"]["List-Unsubscribe-Post"] == (
        "List-Unsubscribe=One-Click"
    )


@pytest.mark.parametrize("changed", ["preference", "account"])
def test_opt_out_or_account_lock_after_claim_prevents_provider_call(
    seed_database, monkeypatch, changed
) -> None:
    user_id = uuid.uuid4()
    email = f"unconcealed-{user_id.hex}@example.com"
    with Session(get_engine()) as db:
        db.add(UserAccount(id=user_id, primary_email=email, is_active=True))
        db.flush()
        db.add(
            AuthIdentity(
                user_id=user_id,
                provider="supabase",
                provider_subject=f"unconcealed-{user_id.hex}",
                email=email,
                email_verified_at=datetime.now(timezone.utc),
            )
        )
        db.add(EmailSubscription(user_id=user_id, research=True))
        db.commit()

    original = sender._currently_eligible
    checks = 0

    def eligibility(db, requested_user_id):
        nonlocal checks
        checks += 1
        if checks == 2:
            with Session(get_engine()) as other:
                if changed == "preference":
                    preference = other.get(EmailSubscription, user_id)
                    assert preference is not None
                    preference.research = False
                else:
                    account = other.get(UserAccount, user_id)
                    assert account is not None
                    account.is_active = False
                other.commit()
        return original(db, requested_user_id)

    monkeypatch.setattr(sender, "_currently_eligible", eligibility)
    monkeypatch.setattr(
        sender.httpx,
        "post",
        lambda *args, **kwargs: pytest.fail(
            "Stopped subscription reached the provider"
        ),
    )
    digest = sender._content_hash(_piece(), "Unconcealed <ask@alethical.com>", POSTAL)
    with Session(get_engine(), expire_on_commit=False) as db:
        outcome = sender._send_one(
            db,
            user_id=user_id,
            piece=_piece(),
            sender="Unconcealed <ask@alethical.com>",
            postal=POSTAL,
            api_key="re_fake",
            content_hash=digest,
        )
        delivery = db.scalar(
            select(UnconcealedDelivery).where(UnconcealedDelivery.user_id == user_id)
        )
    assert checks == 2 and outcome == "no longer subscribed"
    assert delivery is not None and delivery.state == "canceled"


def test_confirmed_suppression_skips_recipient_without_stopping_campaign(
    seed_database, monkeypatch
):
    ids = [uuid.uuid4(), uuid.uuid4()]
    with Session(get_engine()) as db:
        for user_id in ids:
            email = f"suppression-test-{user_id.hex}@example.invalid"
            db.add(UserAccount(id=user_id, primary_email=email, is_active=True))
            db.flush()
            db.add(
                AuthIdentity(
                    user_id=user_id,
                    provider="supabase",
                    provider_subject=str(user_id),
                    email=email,
                    email_verified_at=datetime.now(timezone.utc),
                )
            )
            db.add(EmailSubscription(user_id=user_id, research=True))
        db.commit()

    def suppression(key, address):
        if ids[0].hex in address:
            raise sender.RecipientSuppressed("Suppressed")

    monkeypatch.setattr(sender, "require_not_suppressed", suppression)
    monkeypatch.setattr(sender, "pace_provider", lambda: None)
    calls = []

    def send(*args, **kwargs):
        calls.append(kwargs)
        return SimpleNamespace(status_code=200, json=lambda: {"id": "test-provider-id"})

    monkeypatch.setattr(sender.httpx, "post", send)
    piece = _piece()
    piece = sender.PublishedResearch(
        slug="suppression-test",
        title=piece.title,
        published_on=piece.published_on,
        records_through=piece.records_through,
        public_url="https://www.alethical.com/read/research/suppression-test",
    )
    digest = sender._content_hash(piece, "Unconcealed <ask@alethical.com>", POSTAL)
    with Session(get_engine(), expire_on_commit=False) as db:
        outcomes = [
            sender._send_one(
                db,
                user_id=user_id,
                piece=piece,
                sender="Unconcealed <ask@alethical.com>",
                postal=POSTAL,
                api_key="re_fake",
                content_hash=digest,
            )
            for user_id in ids
        ]
        sender.require_campaign_ready(db, piece, digest)
    assert outcomes == ["suppressed", "accepted"]
    assert len(calls) == 1


def test_provider_pacing_reserves_room_between_requests(monkeypatch):
    monkeypatch.setattr(sender, "_last_provider_call", 100.0)
    monkeypatch.setattr(sender.time, "monotonic", lambda: 100.1)
    waits = []
    monkeypatch.setattr(sender.time, "sleep", waits.append)
    sender.pace_provider()
    assert waits == [pytest.approx(0.5)]
