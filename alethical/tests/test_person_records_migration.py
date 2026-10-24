"""Public record schema is additive and cannot expose private tables via SQL."""

from copy import deepcopy
from uuid import uuid4

import pytest
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session
from sqlalchemy.exc import ProgrammingError

from alethical.api.services.person_records import reviewed_register
from alethical.pipeline.candidate_person_records import import_reviewed_records
from alethical.tests.test_candidates_migration import migrate
from scripts.check_schema_drift import ScratchDatabase, _local_base_url

PARENT = "0068_profile_claim_review"
REVISION = "0069_candidate_person_records"
TABLES = {
    "candidate_election",
    "candidate_race_record",
    "candidate_race_member",
    "public_person",
    "person_candidacy",
    "person_service_record",
    "person_research_record",
    "public_record_version",
}


def test_public_records_migration_roundtrip_and_untrusted_roles():
    with ScratchDatabase(_local_base_url(), "public_person") as scratch:
        result = migrate(scratch.url, "upgrade", PARENT)
        assert result.returncode == 0, result.stderr
        result = migrate(scratch.url, "upgrade", REVISION)
        assert result.returncode == 0, result.stderr
        engine = scratch.engine()
        try:
            with Session(engine) as db:
                import_reviewed_records(db)
                db.commit()
            role = "person_reader_" + uuid4().hex
            with engine.begin() as db:
                rows = db.execute(
                    text("""SELECT c.relname,c.relrowsecurity,
                    (SELECT count(*) FROM pg_policy p WHERE p.polrelid=c.oid)
                    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                    WHERE n.nspname='public' AND c.relname=ANY(:tables)"""),
                    {"tables": sorted(TABLES)},
                ).all()
                assert set(rows) == {(name, True, 0) for name in TABLES}
                db.execute(
                    text(f'CREATE ROLE "{role}" NOLOGIN NOSUPERUSER NOBYPASSRLS')
                )
                db.execute(text(f'GRANT USAGE ON SCHEMA public TO "{role}"'))
                for name in sorted(TABLES):
                    assert db.scalar(text(f'SELECT count(*) FROM "{name}"')) > 0
                    db.execute(
                        text(
                            f'GRANT SELECT, INSERT, UPDATE, DELETE ON "{name}" TO "{role}"'
                        )
                    )
                db.execute(text(f'SET LOCAL ROLE "{role}"'))
                for name in sorted(TABLES):
                    assert db.scalar(text(f'SELECT count(*) FROM "{name}"')) == 0
                    assert db.execute(text(f'DELETE FROM "{name}"')).rowcount == 0
                with (
                    pytest.raises(ProgrammingError, match="row-level security"),
                    db.begin_nested(),
                ):
                    db.execute(
                        text(
                            "INSERT INTO public_person (id,name,identity_evidence) VALUES (gen_random_uuid(),'Not verified','{}'::jsonb)"
                        )
                    )
                db.execute(text("RESET ROLE"))
                db.execute(text(f'DROP OWNED BY "{role}"'))
                db.execute(text(f'DROP ROLE "{role}"'))
            result = migrate(scratch.url, "downgrade", PARENT)
            assert result.returncode == 0, result.stderr
            with engine.connect() as db:
                assert not TABLES & set(inspect(db).get_table_names(schema="public"))
                assert db.scalar(text("SELECT count(*) FROM candidate_record")) == 6
            result = migrate(scratch.url, "upgrade", REVISION)
            assert result.returncode == 0, result.stderr
            with Session(engine) as db:
                # Existing candidacy IDs survive rollback and re-import unchanged.
                register = deepcopy(reviewed_register())
                import_reviewed_records(db, register=register)
                db.commit()
                assert db.scalar(text("SELECT count(*) FROM candidate_record")) == 6
        finally:
            engine.dispose()
