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

from datetime import UTC, date, datetime
from alethical.db.models import (
    CandidateClaim,
    CandidateRecord,
    CandidateSnapshot,
    CandidateStatement,
    CandidateStatementRevision,
    CandidateStatementReport,
    UserAccount,
)
from scripts.check_schema_drift import ScratchDatabase, _local_base_url

ROOT = Path(__file__).resolve().parents[2]
PARENT = "0065_editorial_comments"
REVISION = "0066_candidate_lookup"
TABLES = {
    "candidate_record",
    "candidate_snapshot",
    "candidate_claim",
    "candidate_statement",
    "candidate_statement_revision",
    "candidate_statement_report",
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
    with ScratchDatabase(_local_base_url(), "candidate_privacy") as scratch:
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


def test_candidates_migration_blocks_untrusted_roles_without_host_trigger(prior_schema):
    url, engine = prior_schema
    result = migrate(url, "upgrade", REVISION)
    assert result.returncode == 0, result.stderr
    assert_private_tables(engine)

    with Session(engine) as db:
        owner = UserAccount(primary_email="candidate-rls@example.invalid")
        db.add(owner)
        db.flush()
        owner_id = owner.id
        now = datetime.now(UTC)
        record = CandidateRecord(
            id="a" * 64,
            election_id="8334",
            election_date=date(2026, 11, 3),
            public_payload={},
            source_sha256="b" * 64,
            checked_at=now,
        )
        db.add(record)
        db.add(
            CandidateSnapshot(
                id="b" * 64,
                election_id="8334",
                source_sha256="b" * 64,
                public_payload={},
                checked_at=now,
            )
        )
        db.flush()
        claim = CandidateClaim(
            candidate_id=record.id,
            user_id=owner.id,
            status="approved",
            evidence_url="https://example.invalid",
            request_note="Private evidence",
        )
        db.add(claim)
        db.flush()
        db.add(
            CandidateStatement(
                candidate_id=record.id,
                claim_id=claim.id,
                body="Public statement",
                updated_at=now,
            )
        )
        db.add(
            CandidateStatementRevision(
                candidate_id=record.id,
                claim_id=claim.id,
                body="Old public statement",
                action="published",
                created_at=now,
            )
        )
        db.add(
            CandidateStatementReport(
                candidate_id=record.id,
                claim_id=claim.id,
                reason="Private report",
                statement_body="Public statement",
                statement_version=1,
                created_at=now,
            )
        )
        db.commit()

    role = f"candidate_reader_{uuid4().hex}"
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
                        INSERT INTO public.candidate_claim
                            (id, candidate_id, user_id, status, evidence_url, request_note, version)
                        VALUES (gen_random_uuid(), repeat('a',64), :owner, 'pending', 'https://example.invalid', 'Private', 1)
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


def test_candidates_migration_rejects_unexpected_host_policy_atomically(prior_schema):
    url, engine = prior_schema
    with engine.begin() as db:
        db.execute(
            text("""
            CREATE FUNCTION expose_new_candidate_table() RETURNS event_trigger
            LANGUAGE plpgsql AS $$ DECLARE command record; BEGIN
                FOR command IN SELECT * FROM pg_event_trigger_ddl_commands() LOOP
                    IF command.object_identity = 'public.candidate_claim' THEN
                        CREATE POLICY unexpected_access ON public.candidate_claim
                            USING (true) WITH CHECK (true);
                        RETURN;
                    END IF;
                END LOOP;
            END $$;
            CREATE EVENT TRIGGER expose_new_candidate_table ON ddl_command_end
                WHEN TAG IN ('CREATE TABLE')
                EXECUTE FUNCTION expose_new_candidate_table();
        """)
        )
    result = migrate(url, "upgrade", REVISION)
    assert result.returncode != 0
    assert "Candidate records require RLS enabled and zero policies" in result.stderr, (
        result.stderr
    )
    with engine.connect() as db:
        assert not TABLES & set(inspect(db).get_table_names(schema="public"))
        assert db.scalar(text("SELECT version_num FROM alembic_version")) == PARENT
