"""Editorial eligibility, ownership, stable retries and email-choice races."""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
from threading import Barrier
import uuid

import pytest
from sqlalchemy import delete, func, select

from alethical.api.auth import get_auth_service
from alethical.api.routers.admin import administrator_access
from alethical.api.services import comments as service
from alethical.api.services.auth import AuthenticatedPrincipal
from alethical.db.models import (
    CommentArticleFollow,
    CommentEmailDelivery,
    CommentMutation,
    CommentProfile,
    CommentStopToken,
    EditorialComment,
    UserAccount,
)
from alethical.db.session import get_session_factory

ARTICLE = "research-the-money-only-goes-one-way"
GUIDE = "guide-what-the-records-name"
PUBLIC = f"/api/v1/comments/articles/{ARTICLE}"
ME = "/api/v1/me/comments"
FIRST = {"Authorization": "Bearer test-supabase-token"}
SECOND = {"Authorization": "Bearer test-supabase-token-grace"}


@pytest.fixture(autouse=True)
def clean_comments(seed_database, monkeypatch):
    monkeypatch.setenv("ALETHICAL_COMMENT_EMAIL_ENABLED", "false")
    with get_session_factory()() as db:
        for model in (
            CommentEmailDelivery,
            CommentStopToken,
            CommentMutation,
            CommentArticleFollow,
            EditorialComment,
            CommentProfile,
        ):
            db.execute(delete(model))
        db.commit()


def settings(client, headers=FIRST, article_id=ARTICLE):
    response = client.get(
        f"{ME}/settings", params={"article_id": article_id}, headers=headers
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


def base(client, headers=FIRST, article_id=ARTICLE):
    state = settings(client, headers, article_id)
    return {
        "request_key": str(uuid.uuid4()),
        "expected_account_id": state["account_id"],
    }


def create(
    client,
    body="A reader's comment",
    *,
    headers=FIRST,
    article_id=ARTICLE,
    reply_to=None,
    name="A",
):
    state = settings(client, headers, article_id)
    payload = {
        "request_key": str(uuid.uuid4()),
        "expected_account_id": state["account_id"],
        "body": body,
    }
    if state["public_name"] is None:
        payload.update(
            public_name=name, expected_profile_version=state["profile_version"]
        )
    if reply_to:
        payload["reply_to_id"] = reply_to
    response = client.post(
        f"/api/v1/comments/articles/{article_id}", json=payload, headers=headers
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]["comment"]


def follow(client, headers=FIRST, article_id=ARTICLE, **choices):
    state = settings(client, headers, article_id)
    payload = {
        **base(client, headers, article_id),
        "article_id": article_id,
        "expected_profile_version": state["profile_version"],
        "expected_follow_version": state["follow_version"],
        **choices,
    }
    response = client.post(f"{ME}/preferences", headers=headers, json=payload)
    assert response.status_code == 200, response.text
    return response.json()["data"]["settings"]


def alter(client, item, action="edit", headers=FIRST, **fields):
    return client.post(
        f"/api/v1/comments/articles/{item['article_id']}/{item['id']}/{action}",
        headers=headers,
        json={
            **base(client, headers, item["article_id"]),
            "expected_version": item["version"],
            **fields,
        },
    )


def rows(client, article_id=ARTICLE):
    response = client.get(f"/api/v1/comments/articles/{article_id}")
    assert response.status_code == 200, response.text
    return response.json()["data"]["items"]


def issue_token(user_id, article_id=ARTICLE, choice="article"):
    token = uuid.uuid4().hex + uuid.uuid4().hex
    with get_session_factory()() as db:
        db.add(
            CommentStopToken(
                token_digest=hashlib.sha256(token.encode()).hexdigest(),
                user_id=uuid.UUID(user_id),
                article_id=article_id,
                link_choice=choice,
            )
        )
        db.commit()
    return token


def test_read_is_public_but_only_published_editorial_is_eligible(client):
    assert client.get(PUBLIC).json() == {"data": {"items": [], "next_cursor": None}}
    assert "no-store" in client.get(PUBLIC).headers["cache-control"]
    for article_id in (
        "money",
        "bills-SF1832",
        "read",
        "future-draft",
        "campaign-finance",
    ):
        assert client.get(f"/api/v1/comments/articles/{article_id}").status_code == 404
        assert (
            client.post(
                f"/api/v1/comments/articles/{article_id}",
                headers=FIRST,
                json={**base(client), "body": "No"},
            ).status_code
            == 404
        )
    assert (
        client.get(f"{ME}/settings", params={"article_id": ARTICLE}).status_code == 401
    )
    assert client.post(PUBLIC, json={**base(client), "body": "No"}).status_code == 401


def test_first_name_is_empty_accepts_initials_and_duplicates_and_changes_globally(
    client,
):
    assert settings(client)["public_name"] is None
    first = create(client, name="Q")
    guide = create(client, article_id=GUIDE)
    create(client, headers=SECOND, name="Q")
    state = settings(client)
    response = client.post(
        f"{ME}/name",
        headers=FIRST,
        json={
            **base(client),
            "article_id": ARTICLE,
            "expected_version": state["profile_version"],
            "public_name": "Quinn Reader",
        },
    )
    assert response.status_code == 200
    assert rows(client)[0]["name"] == "Quinn Reader"
    assert rows(client, GUIDE)[0]["name"] == "Quinn Reader"
    assert rows(client)[1]["name"] == "Q"
    assert first["edited_at"] is None and guide["edited_at"] is None
    with get_session_factory()() as db:
        assert db.scalar(select(func.count()).select_from(CommentEmailDelivery)) == 3


def test_no_private_email_in_public_or_settings_and_plain_text_is_preserved(client):
    text = '<script>alert("x")</script>\nhttps://example.org/'
    item = create(client, body=text, name="<b>Reader</b>")
    assert item["body"] == text and item["name"] == "<b>Reader</b>"
    serialized = str(rows(client)) + str(settings(client))
    assert "ada@example.com" not in serialized and "primary_email" not in serialized


def test_empty_and_over_limit_content_or_blank_name_is_refused(client):
    for body, name in (("", "A"), ("  ", "A"), ("x" * 2001, "A"), ("text", "  ")):
        result = client.post(
            PUBLIC,
            headers=FIRST,
            json={
                **base(client),
                "body": body,
                "public_name": name,
                "expected_profile_version": 0,
            },
        )
        assert result.status_code == 422
    assert rows(client) == []
    assert len(create(client, body="😀" * 2000)["body"]) == 2000


def test_reply_to_reply_retains_exact_target_and_one_conversation(client):
    root = create(client)
    reply = create(client, headers=SECOND, name="Grace", reply_to=root["id"])
    last = create(client, reply_to=reply["id"])
    assert reply["root_id"] == last["root_id"] == root["id"]
    assert last["reply_to_id"] == reply["id"]
    assert last["reply_to_name"] == "Grace"
    linked = client.get(f"{PUBLIC}/conversation/{last['id']}")
    assert [row["id"] for row in linked.json()["data"]["items"]] == [
        root["id"],
        reply["id"],
        last["id"],
    ]
    assert (
        client.post(
            f"/api/v1/comments/articles/{GUIDE}",
            headers=FIRST,
            json={**base(client), "body": "Cross article", "reply_to_id": root["id"]},
        ).status_code
        == 404
    )


def test_owner_edit_delete_admin_remove_and_stale_edits(client):
    item = create(client)
    for action in ("edit", "delete", "remove"):
        fields = {"body": "Changed by someone else"} if action == "edit" else {}
        assert alter(client, item, action, SECOND, **fields).status_code == 403
    edited = alter(client, item, body="New words").json()["data"]["comment"]
    assert edited["posted_at"] == item["posted_at"]
    assert edited["edited_at"] is not None and edited["version"] == 2
    assert alter(client, item, body="Stale words").status_code == 409
    before = edited["edited_at"]
    assert (
        alter(client, edited, body="New words").json()["data"]["comment"]["edited_at"]
        == before
    )
    client.app.dependency_overrides[administrator_access] = lambda: True
    removed = alter(client, edited, "remove", SECOND).json()["data"]["comment"]
    assert removed["status"] == "removed" and removed["body"] is None
    assert removed["name"] is None and removed["author_id"] is None
    assert rows(client) == []


def test_parent_and_intermediate_deletion_preserve_other_replies(client):
    root = create(client)
    middle = create(client, headers=SECOND, reply_to=root["id"])
    child = create(client, reply_to=middle["id"])
    assert alter(client, root, "delete").status_code == 200
    assert alter(client, middle, "delete", SECOND).status_code == 200
    result = rows(client)
    assert [row["id"] for row in result] == [root["id"], middle["id"], child["id"]]
    assert result[0]["body"] is result[1]["body"] is None
    assert result[2]["reply_to_name"] is None
    assert alter(client, child, "delete").status_code == 200
    assert rows(client) == []
    assert client.get(f"{PUBLIC}/conversation/{child['id']}").status_code == 404


def test_pagination_has_10_complete_conversations_and_stable_cursor(client):
    items = [create(client, body=str(index)) for index in range(12)]
    reply = create(client, reply_to=items[0]["id"])
    page = client.get(PUBLIC).json()["data"]
    assert len(page["items"]) == 11
    assert page["items"][1]["id"] == reply["id"]
    second = client.get(PUBLIC, params={"cursor": page["next_cursor"]}).json()["data"]
    assert [row["id"] for row in second["items"]] == [row["id"] for row in items[10:]]
    assert second["next_cursor"] is None
    assert client.get(PUBLIC, params={"cursor": "not-a-cursor"}).status_code == 400
    assert (
        client.get(
            f"/api/v1/comments/articles/{GUIDE}", params={"cursor": page["next_cursor"]}
        ).status_code
        == 400
    )


def test_request_retry_returns_one_comment_and_one_admin_delivery(client):
    payload = {
        **base(client),
        "body": "Once",
        "public_name": "A",
        "expected_profile_version": 0,
    }
    one = client.post(PUBLIC, headers=FIRST, json=payload)
    two = client.post(PUBLIC, headers=FIRST, json=payload)
    assert one.status_code == two.status_code == 200
    assert one.json() == two.json()
    assert (
        client.post(
            PUBLIC, headers=FIRST, json={**payload, "body": "Different"}
        ).status_code
        == 409
    )
    assert len(rows(client)) == 1
    with get_session_factory()() as db:
        assert db.scalar(select(func.count()).select_from(CommentEmailDelivery)) == 1
    status = client.get(
        f"{ME}/requests/{payload['request_key']}",
        headers=FIRST,
        params={"article_id": ARTICLE},
    )
    assert status.json()["data"]["state"] == "saved"
    assert (
        client.get(
            f"{ME}/requests/{payload['request_key']}",
            headers=SECOND,
            params={"article_id": ARTICLE},
        ).json()["data"]["state"]
        == "not_found"
    )


def test_not_found_status_fences_off_late_original_submission(client):
    payload = {
        **base(client),
        "body": "Arrived late",
        "public_name": "A",
        "expected_profile_version": 0,
    }
    status = client.get(
        f"{ME}/requests/{payload['request_key']}",
        headers=FIRST,
        params={"article_id": ARTICLE},
    )
    assert status.json()["data"] == {"state": "not_found", "result": None}
    assert client.post(PUBLIC, headers=FIRST, json=payload).status_code == 409
    payload["request_key"] = str(uuid.uuid4())
    assert client.post(PUBLIC, headers=FIRST, json=payload).status_code == 200
    assert len(rows(client)) == 1


def test_account_binding_and_status_never_restore_deleted_body(client):
    wrong = {
        **base(client, SECOND),
        "body": "Wrong account",
        "public_name": "A",
        "expected_profile_version": 0,
    }
    assert client.post(PUBLIC, headers=FIRST, json=wrong).status_code == 409
    payload = {
        **base(client),
        "body": "Erased",
        "public_name": "A",
        "expected_profile_version": 0,
    }
    item = client.post(PUBLIC, headers=FIRST, json=payload).json()["data"]["comment"]
    alter(client, item, "delete")
    response = client.get(
        f"{ME}/requests/{payload['request_key']}",
        headers=FIRST,
        params={"article_id": ARTICLE},
    )
    assert response.json()["data"]["result"]["comment"]["body"] is None


def test_email_recipient_overlap_edits_self_exclusion_and_no_name_alert(client):
    root = create(client)
    follow(client, article_updates=True)
    reply = create(client, headers=SECOND, reply_to=root["id"])
    with get_session_factory()() as db:
        recipients = db.scalars(
            select(CommentEmailDelivery).where(
                CommentEmailDelivery.comment_id == uuid.UUID(reply["id"])
            )
        ).all()
        assert len(recipients) == 2
        reader = next(row for row in recipients if not row.is_admin)
        assert reader.direct_reply and reader.article_update
    edit = alter(client, reply, headers=SECOND, body="Edited reply")
    assert edit.status_code == 200
    with get_session_factory()() as db:
        edited = db.scalars(
            select(CommentEmailDelivery).where(
                CommentEmailDelivery.event_kind == "edit_reply"
            )
        ).all()
        assert len(edited) == 2
        assert not next(row for row in edited if not row.is_admin).direct_reply
    own = create(client)
    with get_session_factory()() as db:
        own_deliveries = db.scalars(
            select(CommentEmailDelivery).where(
                CommentEmailDelivery.comment_id == uuid.UUID(own["id"])
            )
        ).all()
        assert len(own_deliveries) == 1 and own_deliveries[0].is_admin


def test_follow_only_reply_and_reply_only_edit_choices(client):
    root = create(client)
    follow(client, reply_emails=False, article_updates=True)
    reply = create(client, headers=SECOND, reply_to=root["id"])
    with get_session_factory()() as db:
        reader = db.scalar(
            select(CommentEmailDelivery).where(
                CommentEmailDelivery.comment_id == uuid.UUID(reply["id"]),
                CommentEmailDelivery.is_admin.is_(False),
            )
        )
        assert reader.article_update and not reader.direct_reply
    follow(client, reply_emails=True, article_updates=False)
    alter(client, reply, headers=SECOND, body="Edited")
    with get_session_factory()() as db:
        edited = db.scalars(
            select(CommentEmailDelivery).where(
                CommentEmailDelivery.event_kind == "edit_reply"
            )
        ).all()
        assert len(edited) == 1 and edited[0].is_admin


def test_stop_inspection_is_read_only_and_stale_saves_cannot_restore_choices(client):
    state = follow(client, article_updates=True)
    token = issue_token(state["account_id"])
    stale = {
        **base(client),
        "article_id": ARTICLE,
        "expected_profile_version": state["profile_version"],
        "expected_follow_version": state["follow_version"],
        "article_updates": True,
    }
    endpoint = "/api/v1/comments/email-stop"
    inspect = client.post(endpoint + "/inspect", json={"token": token})
    assert inspect.status_code == 200 and inspect.json()["data"]["article_updates"]
    assert settings(client)["follow_version"] == state["follow_version"]
    assert client.get(endpoint, params={"token": token}).status_code == 405
    stopped = client.post(endpoint, json={"token": token, "choice": "article"})
    assert (
        stopped.json()["data"]["reply_emails"]
        and not stopped.json()["data"]["article_updates"]
    )
    assert (
        client.post(f"{ME}/preferences", headers=FIRST, json=stale).status_code == 409
    )
    again = client.post(endpoint, json={"token": token, "choice": "replies"})
    assert not again.json()["data"]["reply_emails"]
    assert not again.json()["data"]["article_updates"]
    assert follow(client, reply_emails=True, article_updates=True)["reply_emails"]
    assert (
        client.post(endpoint, json={"token": token, "choice": "all"}).status_code == 422
    )


def test_preference_retry_returns_current_truth_after_stop(client):
    state = settings(client)
    payload = {
        **base(client),
        "article_id": ARTICLE,
        "expected_profile_version": 0,
        "expected_follow_version": 0,
        "article_updates": True,
    }
    assert (
        client.post(f"{ME}/preferences", headers=FIRST, json=payload).status_code == 200
    )
    token = issue_token(state["account_id"])
    client.post(
        "/api/v1/comments/email-stop", json={"token": token, "choice": "article"}
    )
    response = client.post(f"{ME}/preferences", headers=FIRST, json=payload)
    assert response.status_code == 200
    assert response.json()["data"]["settings"]["article_updates"] is False


def test_unconfirmed_accounts_cannot_write(client):
    class Unconfirmed:
        def authenticate(self, token):
            return AuthenticatedPrincipal(
                "supabase",
                str(uuid.UUID(int=30465)),
                "unconfirmed-comment@example.org",
                False,
            )

    client.app.dependency_overrides[get_auth_service] = lambda: Unconfirmed()
    assert (
        client.get(
            f"{ME}/settings", headers=FIRST, params={"article_id": ARTICLE}
        ).status_code
        == 403
    )
    client.app.dependency_overrides.pop(get_auth_service)


def test_deactivated_account_cannot_post_but_can_read_public_comments(client):
    item = create(client)
    account_id = uuid.UUID(settings(client)["account_id"])
    with get_session_factory()() as db:
        db.get(UserAccount, account_id).is_active = False
        db.commit()
    try:
        result = client.post(
            PUBLIC,
            headers=FIRST,
            json={
                "request_key": str(uuid.uuid4()),
                "expected_account_id": str(account_id),
                "body": "Blocked",
            },
        )
        assert result.status_code == 403
        assert result.json()["type"].endswith("/account-deactivated")
        assert rows(client)[0]["id"] == item["id"]
    finally:
        with get_session_factory()() as db:
            db.get(UserAccount, account_id).is_active = True
            db.commit()


def test_write_rate_limit_is_account_scoped(client):
    from alethical.api.rate_limit import SlidingWindowLimiter

    client.app.state.comment_limiter = SlidingWindowLimiter(1, 60)
    create(client)
    assert (
        client.post(
            PUBLIC, headers=FIRST, json={**base(client), "body": "Too fast"}
        ).status_code
        == 429
    )
    assert create(client, headers=SECOND)["body"]


def test_large_request_is_bounded_without_a_public_name_length_rule(client):
    normal = {
        **base(client),
        "body": "Hello",
        "public_name": "N" * 3000,
        "expected_profile_version": 0,
    }
    assert client.post(PUBLIC, headers=FIRST, json=normal).status_code == 200
    oversized = {**normal, "request_key": str(uuid.uuid4()), "public_name": "N" * 70000}
    response = client.post(PUBLIC, headers=FIRST, json=oversized)
    assert response.status_code == 413
    assert "no-store" in response.headers["cache-control"]


def test_same_request_in_parallel_commits_once(client):
    create(client)
    account_id = uuid.UUID(settings(client)["account_id"])
    payload = {
        "request_key": uuid.uuid4(),
        "expected_account_id": account_id,
        "body": "Concurrent retry",
    }

    def send():
        with get_session_factory()() as db:
            return service.create_comment(
                db, db.get(UserAccount, account_id), ARTICLE, payload
            )["comment"]["id"]

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: send(), range(2)))
    assert results[0] == results[1]
    assert len(rows(client)) == 2


def test_following_readers_can_post_concurrently_without_fanout_deadlock(
    client, monkeypatch
):
    accounts = [
        uuid.UUID(follow(client, headers=headers, article_updates=True)["account_id"])
        for headers in (FIRST, SECOND)
    ]
    account_locks_held = Barrier(2)
    lock_account = service._lock_account

    def synchronize_account_locks(db, account_id):
        user = lock_account(db, account_id)
        # Both account locks must exist before either post takes the article lock.
        # The winner then queues mail to the other, still-locked account.
        account_locks_held.wait(timeout=5)
        return user

    monkeypatch.setattr(service, "_lock_account", synchronize_account_locks)

    def send(account_id):
        with get_session_factory()() as db:
            return service.create_comment(
                db,
                db.get(UserAccount, account_id),
                ARTICLE,
                {
                    "request_key": uuid.uuid4(),
                    "expected_account_id": account_id,
                    "public_name": "Reader",
                    "expected_profile_version": 0,
                    "body": f"Concurrent post by {account_id}",
                },
            )["comment"]

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(send, accounts))

    assert len({item["id"] for item in results}) == 2
    assert {item["id"] for item in rows(client)} == {item["id"] for item in results}
    with get_session_factory()() as db:
        deliveries = db.scalars(select(CommentEmailDelivery)).all()
        assert len(deliveries) == 4
        assert sum(row.is_admin for row in deliveries) == 2
        assert {row.user_id for row in deliveries if not row.is_admin} == set(accounts)
        assert all(row.user_id != row.actor_id for row in deliveries)


def test_hard_account_delete_erases_words_but_keeps_other_peoples_replies(client):
    # Own a separate account so this test cannot remove the suite's shared readers.
    with get_session_factory()() as db:
        user = UserAccount(primary_email="deleted-comment@example.org")
        db.add(user)
        db.flush()
        user_id = user.id
        db.add(
            CommentProfile(
                user_id=user_id,
                public_name="Deleted Person",
                reply_emails=True,
                version=1,
            )
        )
        root = EditorialComment(
            article_id=ARTICLE,
            author_id=user_id,
            body="Private former text",
            posted_at=datetime.now(timezone.utc),
        )
        db.add(root)
        db.commit()
        root_id = str(root.id)
    reply = create(client, reply_to=root_id)
    with get_session_factory()() as db:
        db.execute(delete(UserAccount).where(UserAccount.id == user_id))
        db.commit()
        removed = db.get(EditorialComment, uuid.UUID(root_id))
        assert (
            removed.body is None
            and removed.author_id is None
            and removed.status == "deleted"
        )
    result = rows(client)
    assert [row["id"] for row in result] == [root_id, reply["id"]]
    assert result[1]["reply_to_name"] is None
