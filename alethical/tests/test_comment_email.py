"""Comment email recovery, consent, copies and account isolation on real Postgres."""

import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
import hashlib
import threading
import uuid
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from sqlalchemy import delete, select

from alethical.api.services import comment_email as service
from alethical.db.models import (
    AuthIdentity,
    CommentArticleFollow,
    CommentEmailDelivery,
    CommentMutation,
    CommentProfile,
    CommentStopToken,
    EditorialComment,
    UserAccount,
)
from alethical.db.session import get_session_factory

PIECE = {"title": "An example article", "path": "/read/guides/example"}
ARTICLE = "comment-email-test"


@pytest.fixture(autouse=True)
def safe_mail(monkeypatch, seed_database):
    for key, value in {
        "ALETHICAL_COMMENT_EMAIL_ENABLED": "true",
        "ALETHICAL_EMAIL_ENABLED": "true",
        "ALETHICAL_EMAIL_TRANSPORT": "resend",
        "RESEND_API_KEY": "fake-provider-key",
    }.items():
        monkeypatch.setenv(key, value)
    monkeypatch.delenv("ALETHICAL_EMAIL_ALLOWLIST", raising=False)
    monkeypatch.setattr(service, "REQUEST_SPACING", 0)
    monkeypatch.setattr(service, "_article", lambda _: PIECE)

    def no_network(*args, **kwargs):
        raise AssertionError("A test attempted real email delivery")

    monkeypatch.setattr(service.httpx, "post", no_network)
    with get_session_factory()() as db:
        for model in (
            CommentEmailDelivery,
            CommentStopToken,
            CommentMutation,
            EditorialComment,
            CommentArticleFollow,
            CommentProfile,
        ):
            db.execute(delete(model))
        db.commit()


@pytest.fixture
def discussion():
    actor, reader = uuid.uuid4(), uuid.uuid4()
    with get_session_factory()() as db:
        for user_id, name in ((actor, "Casey"), (reader, "Jordan")):
            email = f"{user_id}@example.org"
            db.add(UserAccount(id=user_id, primary_email=email, is_active=True))
            db.flush()
            db.add(
                AuthIdentity(
                    user_id=user_id,
                    provider="comment-email-test",
                    provider_subject=str(user_id),
                    email=email,
                    email_verified_at=service._now(),
                )
            )
            db.add(CommentProfile(user_id=user_id, public_name=name, reply_emails=True))
        db.add(CommentArticleFollow(user_id=reader, article_id=ARTICLE, enabled=True))
        target = EditorialComment(article_id=ARTICLE, author_id=reader, body="First")
        db.add(target)
        db.commit()
        target_id = target.id

    def queue(kind="new_comment", *, direct=False, updates=True, admin=False):
        reply = kind.endswith("reply")
        with get_session_factory()() as db:
            comment = EditorialComment(
                article_id=ARTICLE,
                author_id=actor,
                root_id=target_id if reply else None,
                reply_to_id=target_id if reply else None,
                body="PRIVATE COMMENT TEXT MUST NOT BE COPIED",
            )
            db.add(comment)
            db.flush()
            row = CommentEmailDelivery(
                event_key=uuid.uuid4(),
                recipient_key="admin" if admin else str(reader),
                user_id=None if admin else reader,
                is_admin=admin,
                actor_id=actor,
                article_id=ARTICLE,
                comment_id=comment.id,
                event_kind=kind,
                direct_reply=direct,
                article_update=updates,
            )
            db.add(row)
            db.commit()
            return row.id

    return actor, reader, target_id, queue


def accepted(monkeypatch):
    requests = []

    def post(url, **kwargs):
        requests.append((url, kwargs))
        return httpx.Response(200, json={"id": "provider-message"})

    monkeypatch.setattr(service.httpx, "post", post)
    return requests


def saved(row_id):
    with get_session_factory()() as db:
        return db.get(CommentEmailDelivery, row_id)


def due(row_id):
    with get_session_factory()() as db:
        db.get(CommentEmailDelivery, row_id).next_attempt_at = service._now()
        db.commit()


@pytest.mark.parametrize(
    "key,value",
    [
        ("ALETHICAL_COMMENT_EMAIL_ENABLED", "false"),
        ("ALETHICAL_EMAIL_ENABLED", "false"),
        ("ALETHICAL_EMAIL_TRANSPORT", "console"),
        ("RESEND_API_KEY", ""),
    ],
)
def test_all_delivery_gates_preserve_pending(monkeypatch, discussion, key, value):
    row_id = discussion[3]()
    monkeypatch.setenv(key, value)
    assert service.drain_once() == 0
    assert saved(row_id).state == "pending"
    assert saved(row_id).attempted_at is None


@pytest.mark.parametrize(
    "kind,direct,updates,admin,subject,opening,stop_count",
    [
        (
            "new_reply",
            True,
            False,
            False,
            "Casey replied to your comment on Alethical",
            "Article: An example article",
            1,
        ),
        (
            "new_reply",
            True,
            True,
            False,
            "Casey replied to your comment on Alethical",
            "Article: An example article",
            2,
        ),
        (
            "new_comment",
            False,
            True,
            False,
            "New comment on “An example article” on Alethical",
            "Casey commented.",
            1,
        ),
        (
            "new_reply",
            False,
            True,
            False,
            "New reply on “An example article” on Alethical",
            "Casey replied to Jordan.",
            1,
        ),
        (
            "edit_comment",
            False,
            True,
            False,
            "Comment edited on “An example article” on Alethical",
            "Casey edited their comment.",
            1,
        ),
        (
            "edit_reply",
            False,
            True,
            False,
            "Reply edited on “An example article” on Alethical",
            "Casey edited their reply.",
            1,
        ),
        (
            "new_comment",
            False,
            False,
            True,
            "New comment on “An example article”",
            "View comment:",
            0,
        ),
        (
            "new_reply",
            False,
            False,
            True,
            "New reply on “An example article”",
            "View reply:",
            0,
        ),
        (
            "edit_comment",
            False,
            False,
            True,
            "Comment edited on “An example article”",
            "View comment:",
            0,
        ),
        (
            "edit_reply",
            False,
            False,
            True,
            "Reply edited on “An example article”",
            "View reply:",
            0,
        ),
    ],
)
def test_approved_email_copies(
    monkeypatch, discussion, kind, direct, updates, admin, subject, opening, stop_count
):
    requests = accepted(monkeypatch)
    row_id = discussion[3](kind, direct=direct, updates=updates, admin=admin)
    comment_id = saved(row_id).comment_id
    assert service.drain_once() == 1
    message = requests[0][1]["json"]
    assert message["from"] == "Alethical <ask@alethical.com>"
    assert message["reply_to"] == "ask@alethical.com"
    assert message["to"] == (
        ["ask@alethical.com"] if admin else [f"{discussion[1]}@example.org"]
    )
    assert message["subject"] == subject
    assert message["text"].startswith(opening)
    assert "PRIVATE COMMENT TEXT" not in message["text"]
    assert message["text"].count("/comment-emails#") == stop_count
    link = f"https://www.alethical.com/read/guides/example#comment-{comment_id}"
    stop_links = [
        line for line in message["text"].splitlines() if "/comment-emails#" in line
    ]
    view_kind = "reply" if kind.endswith("reply") else "comment"
    if admin:
        assert message["text"] == f"View {view_kind}:\n{link}"
    elif direct:
        expected = f"Article: An example article\n\nView reply:\n{link}\n\nStop reply emails:\n{stop_links[0]}"
        if updates:
            expected += "\n\nYou also receive new or edited comments and replies on this article."
            expected += f"\n\nStop updates for this article:\n{stop_links[1]}"
        assert message["text"] == expected
    else:
        assert message["text"] == (
            f"{opening}\n\nView {view_kind}:\n{link}\n\n"
            "You chose to receive new or edited comments and replies on this article."
            f"\n\nStop updates for this article:\n{stop_links[0]}"
        )
    with get_session_factory()() as db:
        for link in stop_links:
            fields = parse_qs(urlparse(link).fragment)
            digest = hashlib.sha256(fields["token"][0].encode()).hexdigest()
            token = db.get(CommentStopToken, digest)
            assert token.user_id == discussion[1]
            assert token.article_id == ARTICLE
            assert token.link_choice == fields["choice"][0]
    assert saved(row_id).message_payload is None
    assert service.drain_once() == 0


@pytest.mark.parametrize(
    "condition", ["inactive", "unconfirmed", "self", "deleted", "stopped"]
)
def test_ineligible_recipients_and_removed_comments_never_send(discussion, condition):
    actor, reader, _, queue = discussion
    row_id = queue()
    with get_session_factory()() as db:
        row = db.get(CommentEmailDelivery, row_id)
        if condition == "inactive":
            db.get(UserAccount, reader).is_active = False
        elif condition == "unconfirmed":
            identity = db.scalar(
                select(AuthIdentity).where(AuthIdentity.user_id == reader)
            )
            identity.email_verified_at = None
        elif condition == "self":
            row.user_id = actor
        elif condition == "deleted":
            db.get(EditorialComment, row.comment_id).status = "removed"
        else:
            db.get(CommentArticleFollow, (reader, ARTICLE)).enabled = False
        db.commit()
    assert service.drain_once() == 0
    assert saved(row_id).state == "cancelled"


def test_allowlist_holds_without_discarding_delivery(monkeypatch, discussion):
    requests = accepted(monkeypatch)
    row_id = discussion[3]()
    monkeypatch.setenv("ALETHICAL_EMAIL_ALLOWLIST", "allowed@example.org")
    assert service.drain_once() == 0
    assert not requests
    assert saved(row_id).state == "pending"
    monkeypatch.setenv("ALETHICAL_EMAIL_ALLOWLIST", f"{discussion[1]}@example.org")
    due(row_id)
    assert service.drain_once() == 1


def test_current_preferences_choose_the_surviving_reason(monkeypatch, discussion):
    requests = accepted(monkeypatch)
    row_id = discussion[3]("new_reply", direct=True, updates=True)
    with get_session_factory()() as db:
        db.get(CommentProfile, discussion[1]).reply_emails = False
        db.commit()
    assert service.drain_once() == 1
    assert (
        requests[0][1]["json"]["subject"]
        == "New reply on “An example article” on Alethical"
    )
    assert "Stop reply emails" not in requests[0][1]["json"]["text"]
    assert saved(row_id).direct_reply is False


def test_edit_is_not_a_direct_reply_alert(discussion):
    row_id = discussion[3]("edit_reply", direct=True, updates=False)
    assert service.drain_once() == 0
    assert saved(row_id).state == "cancelled"


def test_retry_reuses_a_durable_exact_payload_despite_name_change(
    monkeypatch, discussion
):
    row_id = discussion[3]("new_reply", direct=True, updates=True)
    requests = []

    def uncertain(url, **kwargs):
        # A different connection sees the payload before the external side effect.
        durable = saved(row_id)
        assert durable.message_payload == kwargs["json"]
        assert durable.attempted_at is not None
        requests.append(kwargs)
        if len(requests) == 1:
            raise httpx.ReadTimeout("provider may have accepted")
        return httpx.Response(200, json={"id": "one-provider-message"})

    monkeypatch.setattr(service.httpx, "post", uncertain)
    assert service.drain_once() == 0
    assert saved(row_id).state == "pending"
    with get_session_factory()() as db:
        db.get(CommentProfile, discussion[0]).public_name = "Changed name"
        db.commit()
    due(row_id)
    assert service.drain_once() == 1
    assert requests[0]["json"] == requests[1]["json"]
    assert (
        requests[0]["headers"]["Idempotency-Key"]
        == requests[1]["headers"]["Idempotency-Key"]
    )
    assert saved(row_id).message_payload is None
    assert saved(row_id).attempt_count == 2


@pytest.mark.parametrize("change", ["stop_one", "email", "expired"])
def test_uncertain_attempt_never_resends_a_changed_or_expired_payload(
    monkeypatch, discussion, change
):
    row_id = discussion[3]("new_reply", direct=True, updates=True)

    def timeout(*args, **kwargs):
        raise httpx.ReadTimeout("uncertain")

    monkeypatch.setattr(service.httpx, "post", timeout)
    assert service.drain_once() == 0
    requests = accepted(monkeypatch)
    with get_session_factory()() as db:
        row = db.get(CommentEmailDelivery, row_id)
        if change == "expired":
            row.attempted_at = service._now() - timedelta(hours=24)
        elif change == "stop_one":
            db.get(CommentProfile, discussion[1]).reply_emails = False
        else:
            db.get(UserAccount, discussion[1]).primary_email = "new@example.org"
            identity = db.scalar(
                select(AuthIdentity).where(AuthIdentity.user_id == discussion[1])
            )
            identity.email = "new@example.org"
        row.next_attempt_at = service._now()
        db.commit()
    assert service.drain_once() == 0
    assert not requests
    assert saved(row_id).state == ("uncertain" if change == "expired" else "cancelled")
    assert saved(row_id).message_payload is None


@pytest.mark.parametrize(
    "status,name,state",
    [
        (429, "rate_limit_exceeded", "pending"),
        (503, "internal_server_error", "pending"),
        (409, "concurrent_idempotent_requests", "pending"),
        (409, "invalid_idempotent_request", "failed"),
        (422, "validation_error", "failed"),
    ],
)
def test_provider_rejections_are_retried_only_when_safe(
    monkeypatch, discussion, status, name, state
):
    row_id = discussion[3]()
    monkeypatch.setattr(
        service.httpx,
        "post",
        lambda *a, **kw: httpx.Response(status, json={"name": name}),
    )
    assert service.drain_once() == 0
    row = saved(row_id)
    assert row.state == state
    assert (row.message_payload is not None) == (state == "pending")


def test_two_workers_cannot_send_the_same_or_parallel_batches(monkeypatch, discussion):
    row_id = discussion[3]()
    entered, release = threading.Event(), threading.Event()
    requests = []

    def post(*args, **kwargs):
        requests.append(kwargs)
        entered.set()
        assert release.wait(5)
        return httpx.Response(200, json={"id": "once"})

    monkeypatch.setattr(service.httpx, "post", post)
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(service.drain_once)
        assert entered.wait(5)
        try:
            assert pool.submit(service.drain_once).result(timeout=3) == 0
        finally:
            release.set()
        assert first.result(timeout=5) == 1
    assert len(requests) == 1
    assert saved(row_id).state == "sent"


def test_slow_delivery_does_not_delay_stops_or_account_writes(monkeypatch, discussion):
    discussion[3]()
    entered, release, stopped = threading.Event(), threading.Event(), threading.Event()

    def post(*args, **kwargs):
        entered.set()
        assert release.wait(5)
        assert stopped.is_set()
        return httpx.Response(200, json={"id": "started-before-stop"})

    def stop():
        with get_session_factory()() as db:
            db.scalar(
                select(UserAccount)
                .where(UserAccount.id == discussion[1])
                .with_for_update()
            )
            db.get(CommentArticleFollow, (discussion[1], ARTICLE)).enabled = False
            db.commit()
        stopped.set()

    monkeypatch.setattr(service.httpx, "post", post)
    with ThreadPoolExecutor(max_workers=2) as pool:
        sending = pool.submit(service.drain_once)
        assert entered.wait(5)
        stopping = pool.submit(stop)
        try:
            stopping.result(timeout=3)
        finally:
            release.set()
        assert sending.result(timeout=5) == 1
    assert stopped.is_set()
    row_id = discussion[3]()
    assert service.drain_once() == 0
    assert saved(row_id).state == "cancelled"


def test_restart_recovers_committed_sending_row(monkeypatch, discussion):
    requests = accepted(monkeypatch)
    row_id = discussion[3]()
    with get_session_factory()() as db:
        row = db.get(CommentEmailDelivery, row_id)
        assert service._prepare(db, row)
        row.next_attempt_at = service._now()
        original = row.message_payload
        db.commit()
    assert service.drain_once() == 1
    assert requests[0][1]["json"] == original


def test_sender_paces_and_honors_batch_limit(monkeypatch, discussion):
    accepted(monkeypatch)
    sleeps = []
    monkeypatch.setattr(service, "REQUEST_SPACING", 0.55)
    monkeypatch.setattr(service.time, "sleep", sleeps.append)
    discussion[3]()
    discussion[3]()
    assert service.drain_once(limit=1) == 1
    assert sleeps == [0.55]


def test_lifespan_runs_off_event_loop_and_waits_for_shutdown(monkeypatch):
    entered = threading.Event()

    def drain(*, _stop):
        with pytest.raises(RuntimeError, match="no running event loop"):
            asyncio.get_running_loop()
        entered.set()
        assert _stop.wait(5)
        return 0

    monkeypatch.setattr(service, "drain_once", drain)

    async def exercise():
        async with service.comment_email_lifespan(None):
            assert await asyncio.to_thread(entered.wait, 3)

    asyncio.run(exercise())


def test_retry_does_not_restore_deleted_target_identity(monkeypatch, discussion):
    row_id = discussion[3]("new_reply", direct=False, updates=True)

    def timeout(*args, **kwargs):
        raise httpx.ReadTimeout("uncertain")

    monkeypatch.setattr(service.httpx, "post", timeout)
    assert service.drain_once() == 0
    requests = accepted(monkeypatch)
    with get_session_factory()() as db:
        target = db.get(EditorialComment, discussion[2])
        target.status = "deleted"
        target.author_id = None
        target.body = None
        db.commit()
    due(row_id)
    assert service.drain_once() == 0
    assert not requests
    assert saved(row_id).state == "cancelled"
    assert saved(row_id).message_payload is None


def test_article_reply_email_omits_already_deleted_target_identity(
    monkeypatch, discussion
):
    row_id = discussion[3]("new_reply", direct=False, updates=True)
    with get_session_factory()() as db:
        target = db.get(EditorialComment, discussion[2])
        target.status = "deleted"
        target.author_id = None
        target.body = None
        db.commit()
    requests = accepted(monkeypatch)
    assert service.drain_once() == 1
    assert requests[0][1]["json"]["text"].startswith("Casey replied.\n")
    assert "Jordan" not in requests[0][1]["json"]["text"]
    assert saved(row_id).state == "sent"


def test_first_send_omits_target_removed_after_payload_preparation(
    monkeypatch, discussion
):
    row_id = discussion[3]("new_reply", direct=False, updates=True)
    with get_session_factory()() as db:
        assert service._prepare(db, db.get(CommentEmailDelivery, row_id))
        db.commit()
    with get_session_factory()() as db:
        target = db.get(EditorialComment, discussion[2])
        target.status = "removed"
        target.author_id = None
        target.body = None
        db.commit()
    requests = accepted(monkeypatch)
    with get_session_factory()() as db:
        service._attempt(db, db.get(CommentEmailDelivery, row_id))
        db.commit()
    assert len(requests) == 1
    assert requests[0][1]["json"]["text"].startswith("Casey replied.\n")
    assert "Jordan" not in requests[0][1]["json"]["text"]
    assert saved(row_id).state == "sent"
