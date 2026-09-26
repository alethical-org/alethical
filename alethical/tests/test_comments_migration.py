"""Comment privacy must be established by the migration, without host triggers."""

import os
from pathlib import Path
import subprocess
import sys
from uuid import uuid4

import pytest
from sqlalchemy import inspect, text
from sqlalchemy.exc import ProgrammingError
from sqlalchemy.orm import Session

from alethical.db.models import (
    CommentArticleFollow,
    CommentEmailDelivery,
    CommentMutation,
    CommentProfile,
    CommentStopToken,
    EditorialComment,
    UserAccount,
)
from scripts.check_schema_drift import ScratchDatabase, _local_base_url

ROOT = Path(__file__).resolve().parents[2]
PARENT = "0064_email_subscriptions"
REVISION = "0065_editorial_comments"
TABLES = {
    "comment_profile",
    "editorial_comment",
    "comment_article_follow",
    "comment_mutation",
    "comment_stop_token",
    "comment_email_delivery",
}


def migrate(url, direction, revision):
    return subprocess.run(
        [sys.executable, "-m", "alembic", "-c", "alembic.ini", direction, revision],
        cwd=ROOT,
        env={
            **os.environ,
            "DATABASE_URL": url.render_as_string(hide_password=False),
            "ALETHICAL_DATABASE_TARGET": "local",
        },
        text=True,
        capture_output=True,
        check=False,
    )


@pytest.fixture
def prior_schema():
    with ScratchDatabase(_local_base_url(), "comment_privacy") as scratch:
        result = migrate(scratch.url, "upgrade", PARENT)
        assert result.returncode == 0, result.stderr
        engine = scratch.engine()
        try:
            with engine.connect() as db:
                # In particular there is no Supabase ensure_rls event trigger.
                assert db.scalar(text("SELECT count(*) FROM pg_event_trigger")) == 0
            yield scratch.url, engine
        finally:
            engine.dispose()


def assert_private_tables(engine):
    with engine.connect() as db:
        rows = db.execute(
            text("""
                SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
                    (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid)
                FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public' AND c.relname = ANY(:tables)
            """),
            {"tables": sorted(TABLES)},
        ).all()
    assert set(rows) == {(name, True, False, 0) for name in TABLES}


def test_comments_migration_blocks_untrusted_roles_without_host_trigger(prior_schema):
    url, engine = prior_schema
    result = migrate(url, "upgrade", REVISION)
    assert result.returncode == 0, result.stderr
    assert_private_tables(engine)

    with Session(engine) as db:
        owner = UserAccount(primary_email="comment-rls@example.invalid")
        db.add(owner)
        db.flush()
        owner_id = owner.id
        comment = EditorialComment(
            article_id="migration-proof", author_id=owner_id, body="Public words"
        )
        db.add(comment)
        db.flush()
        db.add_all(
            [
                CommentProfile(user_id=owner_id, public_name="Reader"),
                CommentArticleFollow(user_id=owner_id, article_id=comment.article_id),
                CommentMutation(
                    user_id=owner_id,
                    request_key=uuid4(),
                    article_id=comment.article_id,
                    payload_hash="a" * 64,
                    comment_id=comment.id,
                ),
                CommentStopToken(
                    token_digest="b" * 64,
                    user_id=owner_id,
                    article_id=comment.article_id,
                    link_choice="article",
                ),
                CommentEmailDelivery(
                    event_key=uuid4(),
                    recipient_key=f"user:{owner_id}",
                    user_id=owner_id,
                    actor_id=owner_id,
                    article_id=comment.article_id,
                    comment_id=comment.id,
                    event_kind="new_comment",
                ),
            ]
        )
        db.commit()

    role = f"comment_reader_{uuid4().hex}"
    with engine.begin() as db:
        # Give ordinary SQL privileges deliberately: RLS itself must deny access.
        db.execute(text(f'CREATE ROLE "{role}" NOLOGIN NOSUPERUSER NOBYPASSRLS'))
        db.execute(text(f'GRANT USAGE ON SCHEMA public TO "{role}"'))
        for table in sorted(TABLES):
            assert db.scalar(text(f'SELECT count(*) FROM public."{table}"')) == 1
            db.execute(
                text(
                    f'GRANT SELECT, INSERT, UPDATE, DELETE ON public."{table}" TO "{role}"'
                )
            )
        db.execute(text(f'SET LOCAL ROLE "{role}"'))
        for table in sorted(TABLES):
            assert db.scalar(text(f'SELECT count(*) FROM public."{table}"')) == 0
            assert db.execute(text(f'DELETE FROM public."{table}"')).rowcount == 0
        with pytest.raises(ProgrammingError, match="row-level security"):
            with db.begin_nested():
                db.execute(
                    text("""
                        INSERT INTO public.comment_profile
                            (user_id, public_name, reply_emails, version)
                        VALUES (:owner, 'Untrusted', true, 0)
                    """),
                    {"owner": owner_id},
                )
        db.execute(text("RESET ROLE"))
        for table in sorted(TABLES):
            assert db.scalar(text(f'SELECT count(*) FROM public."{table}"')) == 1
        db.execute(text(f'DROP OWNED BY "{role}"'))
        db.execute(text(f'DROP ROLE "{role}"'))

    result = migrate(url, "downgrade", PARENT)
    assert result.returncode == 0, result.stderr
    with engine.connect() as db:
        assert not TABLES & set(inspect(db).get_table_names(schema="public"))
        assert (
            db.scalar(
                text("SELECT id FROM user_account WHERE id = :owner"),
                {"owner": owner_id},
            )
            == owner_id
        )
    result = migrate(url, "upgrade", REVISION)
    assert result.returncode == 0, result.stderr
    assert_private_tables(engine)


def test_comments_migration_rejects_unexpected_host_policy_atomically(prior_schema):
    url, engine = prior_schema
    with engine.begin() as db:
        db.execute(
            text("""
            CREATE FUNCTION expose_new_comment_table() RETURNS event_trigger
            LANGUAGE plpgsql AS $$ DECLARE command record; BEGIN
                FOR command IN SELECT * FROM pg_event_trigger_ddl_commands() LOOP
                    IF command.object_identity = 'public.comment_profile' THEN
                        CREATE POLICY unexpected_access ON public.comment_profile
                            USING (true) WITH CHECK (true);
                        RETURN;
                    END IF;
                END LOOP;
            END $$;
            CREATE EVENT TRIGGER expose_new_comment_table ON ddl_command_end
                WHEN TAG IN ('CREATE TABLE')
                EXECUTE FUNCTION expose_new_comment_table();
        """)
        )
    result = migrate(url, "upgrade", REVISION)
    assert result.returncode != 0
    assert (
        "Editorial comments require RLS enabled and zero policies" in result.stderr
    ), result.stderr
    with engine.connect() as db:
        assert not TABLES & set(inspect(db).get_table_names(schema="public"))
        assert db.scalar(text("SELECT version_num FROM alembic_version")) == PARENT
