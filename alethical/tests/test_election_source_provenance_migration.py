"""Private provenance storage keeps evidence scoped and history immutable."""

# ruff: noqa: F811
from datetime import datetime, UTC
import hashlib

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import SQLAlchemyError

from alethical.db import models as m
from alethical.pipeline.election_comparison import archive_source
from alethical.tests.test_election_comparison_storage import db, MemoryStore  # noqa: F401


def entry(db, **changes):
    source = archive_source(db, MemoryStore(), b"synthetic official original")
    values = dict(
        subject_key="1" * 64,
        schema_id="retained-acquisition:v1",
        receipt_sha256="2" * 64,
        request_key="3" * 64,
        primary_source_sha256=source,
        decision="checked",
        receipt={"schema": "retained-acquisition:v1"},
        evidence_sha256=hashlib.sha256(b"{}").hexdigest(),
        evidence_body=b"{}",
        reviewed_by="private synthetic reviewer",
        reason="Storage-only test, not approved source evidence",
        reviewed_at=datetime.now(UTC),
    )
    row = m.ElectionSourceProvenanceDecision(**(values | changes))
    db.add(row)
    db.flush()
    return row


@pytest.mark.parametrize(
    "change",
    [
        "missing_schema",
        "null_schema",
        "wrong_schema",
        "no_body",
        "empty_body",
        "root_with_private_body",
        "oversized",
    ],
)
def test_database_rejects_wrong_schema_or_private_evidence_scope(db, change):
    changes = {
        "missing_schema": {"receipt": {}},
        "null_schema": {"receipt": {"schema": None}},
        "wrong_schema": {"receipt": {"schema": "other"}},
        "no_body": {"evidence_body": None},
        "empty_body": {"evidence_body": b""},
        "root_with_private_body": {
            "schema_id": "local-recipient-root:v1",
            "receipt": {"schema": "local-recipient-root:v1"},
        },
        "oversized": {"evidence_body": b"x" * (1048576 + 1)},
    }[change]
    with pytest.raises(SQLAlchemyError), db.begin_nested():
        entry(db, **changes)
    assert db.scalar(select(m.ElectionSourceProvenanceDecision.id)) is None


@pytest.mark.parametrize(
    "mutation", ["update", "delete", "withdraw_changed_body", "fork"]
)
def test_provenance_history_is_immutable_and_withdrawal_keeps_evidence(db, mutation):
    first = entry(db)
    with pytest.raises(SQLAlchemyError), db.begin_nested():
        if mutation == "update":
            db.execute(
                text(
                    "UPDATE election_source_provenance_decision SET evidence_body='changed' WHERE id=:id"
                ),
                {"id": first.id},
            )
        elif mutation == "delete":
            db.execute(
                text("DELETE FROM election_source_provenance_decision WHERE id=:id"),
                {"id": first.id},
            )
        elif mutation == "withdraw_changed_body":
            entry(
                db,
                previous_decision_id=first.id,
                request_key="4" * 64,
                decision="withdrawn",
                evidence_body=b"changed",
            )
        else:
            entry(db, request_key="4" * 64)
    assert db.get(m.ElectionSourceProvenanceDecision, first.id).evidence_body == b"{}"


def test_root_binding_stores_no_private_capture_body(db):
    row = entry(
        db,
        schema_id="local-recipient-root:v1",
        receipt={"schema": "local-recipient-root:v1"},
        evidence_body=None,
        evidence_sha256=None,
    )
    assert row.evidence_body is None


def test_populated_downgrade_refuses_and_empty_roundtrip_restores_table(db):
    import importlib
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from sqlalchemy import inspect

    migration = importlib.import_module(
        "alethical.alembic.versions.0098_election_source_provenance"
    )
    with Operations.context(MigrationContext.configure(db.connection())):
        migration.downgrade()
        assert not inspect(db.connection()).has_table(
            "election_source_provenance_decision"
        )
        migration.upgrade()
        assert inspect(db.connection()).has_table("election_source_provenance_decision")
        row = entry(db)
        with (
            pytest.raises(SQLAlchemyError, match="Retain source provenance history"),
            db.begin_nested(),
        ):
            migration.downgrade()
        assert db.get(m.ElectionSourceProvenanceDecision, row.id).evidence_body == b"{}"
