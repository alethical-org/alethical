"""Typed Board candidate records and distinct reviewed source relationships."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0099_board_candidate_records"
down_revision = "0098_election_source_provenance"
branch_labels = None
depends_on = None
TABLE = "election_source_provenance_decision"


def _constraints(board):
    acquisitions = "'retained-acquisition:v1'" + (
        ",'retained-board-capture:v1'" if board else ""
    )
    relationships = "'local-recipient-root:v1'" + (
        ",'board_candidate_relationship:v1'" if board else ""
    )
    op.create_check_constraint(
        "valid_schema", TABLE, f"schema_id IN ({acquisitions},{relationships})"
    )
    op.create_check_constraint(
        "private_evidence_scope",
        TABLE,
        f"(schema_id IN ({acquisitions}) AND evidence_sha256 IS NOT NULL AND evidence_body IS NOT NULL AND octet_length(evidence_body) BETWEEN 1 AND 1048576) OR (schema_id IN ({relationships}) AND evidence_sha256 IS NULL AND evidence_body IS NULL)",
    )


def _drop_constraints():
    for name in ("valid_schema", "private_evidence_scope"):
        op.drop_constraint(op.f(f"ck_{TABLE}_{name}"), TABLE, type_="check")


def upgrade():
    op.add_column(
        "election_finance_collection",
        sa.Column("candidate_records", postgresql.JSONB(), nullable=True),
    )
    op.create_check_constraint(
        "candidate_records_schema",
        "election_finance_collection",
        "candidate_records IS NULL OR (jsonb_typeof(candidate_records) = 'object' AND candidate_records->>'schema' IS NOT NULL AND candidate_records->>'schema' = 'mn-cfb-candidate-records:v1')",
    )
    _drop_constraints()
    _constraints(True)
    # Existing to_jsonb immutability and same-schema predecessor triggers cover
    # the new field/claims without rewriting any historical row or trigger.


def downgrade():
    if op.get_bind().get_isolation_level() != "READ COMMITTED":
        raise RuntimeError("Board record rollback requires READ COMMITTED")
    op.execute(
        "LOCK TABLE election_finance_collection, election_source_provenance_decision IN ACCESS EXCLUSIVE MODE"
    )
    op.execute("""DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM election_finance_collection WHERE candidate_records IS NOT NULL)
        OR EXISTS (SELECT 1 FROM election_source_provenance_decision WHERE schema_id IN ('retained-board-capture:v1','board_candidate_relationship:v1'))
      THEN RAISE EXCEPTION 'Retain Board record history; roll back application behavior instead'; END IF;
    END $$""")
    _drop_constraints()
    _constraints(False)
    op.drop_constraint(
        op.f("ck_election_finance_collection_candidate_records_schema"),
        "election_finance_collection",
        type_="check",
    )
    op.drop_column("election_finance_collection", "candidate_records")
