"""The search release pointer is private, holds 1 active release and round-trips."""

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from alethical.tests.test_candidates_migration import migrate
from scripts.check_schema_drift import ScratchDatabase, _local_base_url

PARENT = "0100_election_precinct_lookup"
REVISION = "0101_national_fcc_search_release"


def release(db, release_id, active):
    db.execute(
        text(
            "INSERT INTO national_fcc_search_release (release_id, object_key,"
            " sqlite_sha256, sqlite_bytes, stored_sha256, stored_bytes, filings, saved,"
            " unavailable, unchecked, index_through, saved_updated, active)"
            " VALUES (:id, 'k', :h, 1, :h, 1, 5, 3, 1, 1, '2026-11-16', '2026-11-20', :a)"
        ),
        {"id": release_id, "h": "a" * 64, "a": active},
    )


def test_search_release_upgrade_downgrade_upgrade():
    with ScratchDatabase(_local_base_url(), "fcc_search_release") as scratch:
        for step in ("upgrade", "downgrade", "upgrade"):
            target = PARENT if step == "downgrade" else REVISION
            result = migrate(scratch.url, step, target)
            assert result.returncode == 0, result.stderr
        engine = scratch.engine()
        try:
            with engine.begin() as db:
                security = db.execute(
                    text(
                        "SELECT relrowsecurity FROM pg_class"
                        " WHERE relname = 'national_fcc_search_release'"
                    )
                ).scalar_one()
                assert security is True
                release(db, "r1", True)
                release(db, "r2", False)
            with pytest.raises(IntegrityError), engine.begin() as db:
                release(db, "r3", True)
        finally:
            engine.dispose()
