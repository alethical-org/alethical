"""FCC draft evidence remains private without relying on hosted database triggers."""

from uuid import uuid4

import pytest
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError, ProgrammingError
from sqlalchemy.orm import Session

from alethical.db import models as m
from alethical.tests.test_candidates_migration import migrate
from scripts.check_schema_drift import ScratchDatabase, _local_base_url

PARENT = "0066_candidate_lookup"
REVISION = "0067_fcc_political_files"
TABLES = {
    "fcc_source_body",
    "fcc_scan",
    "fcc_observation",
    "fcc_document",
    "fcc_extraction",
    "fcc_page",
    "fcc_expense_link",
}
HASH = "a" * 64


@pytest.fixture
def prior_schema():
    with ScratchDatabase(_local_base_url(), "fcc_privacy") as scratch:
        result = migrate(scratch.url, "upgrade", PARENT)
        assert result.returncode == 0, result.stderr
        engine = scratch.engine()
        try:
            with engine.connect() as db:
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
        columns = {
            column["name"]: column
            for column in inspect(db).get_columns("fcc_extraction")
        }
        assert "attempts" in columns and columns["attempts"]["nullable"] is False
        foreign_keys = inspect(db).get_foreign_keys("fcc_expense_link")
        assert any(
            key["constrained_columns"] == ["content_hash", "extraction_version"]
            and key["referred_table"] == "fcc_extraction"
            and key["referred_columns"] == ["content_hash", "version"]
            for key in foreign_keys
        )


def seed_all_tables(engine):
    with Session(engine) as db:
        db.add(
            m.FCCSourceBody(
                content_hash=HASH,
                object_key="private/body.gz",
                byte_size=1,
                compressed_hash="b" * 64,
                compressed_byte_size=1,
                compression="gzip",
            )
        )
        scan = m.FCCScan(status="complete", stations=["KSTP-TV"], counts={})
        db.add(scan)
        db.flush()
        db.add(
            m.FCCObservation(
                scan_id=scan.id,
                url="https://publicfiles.fcc.gov/example",
                facility_id="28010",
                kind="file",
                status="stored",
                content_hash=HASH,
                details={},
            )
        )
        db.add(
            m.FCCDocument(
                facility_id="28010",
                file_id="record-1",
                content_hash=HASH,
                call_sign="KSTP-TV",
                folder_id="folder-1",
                folder_path="political-files/2026",
                name="Invoice",
                url="https://files.fcc.gov/download/example.pdf",
                year=2026,
            )
        )
        db.add(
            m.FCCExtraction(
                content_hash=HASH,
                version="reader-v1",
                document_kind="invoice",
                status="pending_review",
                facts=[],
                errors=[],
                attempts=[],
            )
        )
        db.flush()
        db.add(
            m.FCCPage(
                content_hash=HASH,
                version="reader-v1",
                page=1,
                text="Private draft text",
                method="native",
                status="read",
            )
        )
        db.add(
            m.FCCExpenseLink(
                content_hash=HASH,
                extraction_version="reader-v1",
                source_dataset="cfb",
                source_snapshot_id=uuid4(),
                source_content_hash="c" * 64,
                source_row_number=1,
                source_row={},
                status="suggested",
                evidence="Private draft evidence",
            )
        )
        db.commit()


def test_fcc_migration_private_even_with_grants_and_reversible(prior_schema):
    url, engine = prior_schema
    result = migrate(url, "upgrade", REVISION)
    assert result.returncode == 0, result.stderr
    assert_private_tables(engine)
    seed_all_tables(engine)
    role = f"fcc_reader_{uuid4().hex}"
    with engine.begin() as db:
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
        assert (
            db.execute(
                text("UPDATE fcc_page SET text = 'Changed private text'")
            ).rowcount
            == 0
        )
        with pytest.raises(ProgrammingError, match="row-level security"):
            with db.begin_nested():
                db.execute(
                    text("""
                    INSERT INTO fcc_scan (id, status, stations, counts)
                    VALUES (gen_random_uuid(), 'complete', '[]', '{}')
                """)
                )
        db.execute(text("RESET ROLE"))
        for table in sorted(TABLES):
            assert db.scalar(text(f'SELECT count(*) FROM public."{table}"')) == 1
        assert db.scalar(text("SELECT text FROM fcc_page")) == "Private draft text"
        db.execute(text(f'DROP OWNED BY "{role}"'))
        db.execute(text(f'DROP ROLE "{role}"'))

    # Owner-level writes still have to carry evidence, a valid reading and a reviewer.
    with engine.begin() as db:
        for values, expected in (
            (
                {
                    "version": "missing-reader",
                    "status": "suggested",
                    "evidence": "Evidence",
                    "reviewer": None,
                },
                "foreign key",
            ),
            (
                {
                    "version": "reader-v1",
                    "status": "suggested",
                    "evidence": "  ",
                    "reviewer": None,
                },
                "fcc_link_evidence",
            ),
            (
                {
                    "version": "reader-v1",
                    "status": "accepted",
                    "evidence": "Evidence",
                    "reviewer": None,
                },
                "fcc_link_review",
            ),
            (
                {
                    "version": "reader-v1",
                    "status": "rejected",
                    "evidence": "Evidence",
                    "reviewer": " ",
                },
                "fcc_link_review",
            ),
        ):
            with pytest.raises(IntegrityError, match=expected):
                with db.begin_nested():
                    db.execute(
                        text("""
                        INSERT INTO fcc_expense_link
                            (id, content_hash, extraction_version, source_dataset,
                             source_snapshot_id, source_content_hash, source_row_number,
                             source_row, status, evidence, reviewed_by)
                        VALUES (gen_random_uuid(), :hash, :version, 'cfb', gen_random_uuid(),
                            repeat('c',64), 2, '{}', :status, :evidence, :reviewer)
                    """),
                        {"hash": HASH, **values},
                    )

    result = migrate(url, "downgrade", PARENT)
    assert result.returncode == 0, result.stderr
    with engine.connect() as db:
        tables = set(inspect(db).get_table_names(schema="public"))
        assert not TABLES & tables
        assert "candidate_record" in tables
        assert db.scalar(text("SELECT version_num FROM alembic_version")) == PARENT
    result = migrate(url, "upgrade", REVISION)
    assert result.returncode == 0, result.stderr
    assert_private_tables(engine)


def test_fcc_migration_rejects_unexpected_public_policy_atomically(prior_schema):
    url, engine = prior_schema
    with engine.begin() as db:
        db.execute(
            text("""
            CREATE FUNCTION expose_new_fcc_table() RETURNS event_trigger
            LANGUAGE plpgsql AS $$ DECLARE command record; BEGIN
                FOR command IN SELECT * FROM pg_event_trigger_ddl_commands() LOOP
                    IF command.object_identity = 'public.fcc_extraction' THEN
                        CREATE POLICY unexpected_access ON public.fcc_extraction
                            USING (true) WITH CHECK (true);
                        RETURN;
                    END IF;
                END LOOP;
            END $$;
            CREATE EVENT TRIGGER expose_new_fcc_table ON ddl_command_end
                WHEN TAG IN ('CREATE TABLE') EXECUTE FUNCTION expose_new_fcc_table();
        """)
        )
    result = migrate(url, "upgrade", REVISION)
    assert result.returncode != 0
    assert "FCC archive requires RLS enabled and zero policies" in result.stderr
    with engine.connect() as db:
        assert not TABLES & set(inspect(db).get_table_names(schema="public"))
        assert db.scalar(text("SELECT version_num FROM alembic_version")) == PARENT
