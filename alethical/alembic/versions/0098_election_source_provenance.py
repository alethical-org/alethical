"""Private append-only acquisition and typed recipient-root evidence."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0098_election_source_provenance"
down_revision = "0097_election_source_readings"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "election_source_provenance_decision",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("subject_key", sa.String(64), nullable=False),
        sa.Column("schema_id", sa.String(80), nullable=False),
        sa.Column("receipt_sha256", sa.String(64), nullable=False),
        sa.Column("request_key", sa.String(64), nullable=False),
        sa.Column("previous_decision_id", sa.BigInteger()),
        sa.Column("primary_source_sha256", sa.String(64), nullable=False),
        sa.Column("decision", sa.String(20), nullable=False),
        sa.Column("receipt", postgresql.JSONB(), nullable=False),
        sa.Column("evidence_sha256", sa.String(64)),
        sa.Column("evidence_body", sa.LargeBinary()),
        sa.Column("reviewed_by", sa.Text(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["primary_source_sha256"], ["election_result_source.content_hash"]
        ),
        sa.ForeignKeyConstraint(
            ["previous_decision_id", "subject_key"],
            [
                "election_source_provenance_decision.id",
                "election_source_provenance_decision.subject_key",
            ],
        ),
        sa.UniqueConstraint("request_key"),
        sa.UniqueConstraint("previous_decision_id"),
        sa.UniqueConstraint("id", "subject_key"),
        sa.CheckConstraint(
            "decision IN ('checked','withdrawn')", name="valid_decision"
        ),
        sa.CheckConstraint(
            "schema_id IN ('retained-acquisition:v1','local-recipient-root:v1')",
            name="valid_schema",
        ),
        sa.CheckConstraint(
            "previous_decision_id IS NULL OR previous_decision_id < id",
            name="ordered_history",
        ),
        sa.CheckConstraint(
            "decision = 'checked' OR previous_decision_id IS NOT NULL",
            name="withdrawal_has_previous",
        ),
        sa.CheckConstraint(
            "jsonb_typeof(receipt) = 'object' AND receipt->>'schema' IS NOT NULL AND receipt->>'schema' = schema_id",
            name="receipt_schema",
        ),
        sa.CheckConstraint(
            "(schema_id = 'retained-acquisition:v1' AND evidence_sha256 IS NOT NULL "
            "AND evidence_body IS NOT NULL AND octet_length(evidence_body) BETWEEN 1 AND 1048576) "
            "OR (schema_id = 'local-recipient-root:v1' AND evidence_sha256 IS NULL AND evidence_body IS NULL)",
            name="private_evidence_scope",
        ),
    )
    op.create_index(
        "ix_source_provenance_initial",
        "election_source_provenance_decision",
        ["subject_key"],
        unique=True,
        postgresql_where=sa.text("previous_decision_id IS NULL"),
    )
    op.create_index(
        "ix_source_provenance_receipt",
        "election_source_provenance_decision",
        ["receipt_sha256", "id"],
    )
    op.create_index(
        "ix_source_provenance_subject",
        "election_source_provenance_decision",
        ["subject_key", "id"],
    )
    op.execute("""
CREATE FUNCTION preserve_source_provenance() RETURNS trigger AS $$
DECLARE previous election_source_provenance_decision;
BEGIN
 IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Source provenance decisions are append-only'; END IF;
 IF NEW.previous_decision_id IS NOT NULL THEN
   SELECT * INTO previous FROM election_source_provenance_decision
     WHERE id = NEW.previous_decision_id FOR UPDATE;
   IF NOT FOUND OR previous.subject_key <> NEW.subject_key OR previous.schema_id <> NEW.schema_id THEN
     RAISE EXCEPTION 'Source provenance predecessor belongs to another subject';
   END IF;
   IF NEW.decision = 'withdrawn' AND (
     NEW.receipt_sha256 IS DISTINCT FROM previous.receipt_sha256 OR NEW.receipt IS DISTINCT FROM previous.receipt
     OR NEW.primary_source_sha256 IS DISTINCT FROM previous.primary_source_sha256
     OR NEW.evidence_sha256 IS DISTINCT FROM previous.evidence_sha256 OR NEW.evidence_body IS DISTINCT FROM previous.evidence_body
   ) THEN RAISE EXCEPTION 'Withdrawal must retain preceding provenance evidence'; END IF;
 END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql
    """)
    op.execute(
        "CREATE TRIGGER source_provenance_append_only BEFORE INSERT OR UPDATE OR DELETE ON election_source_provenance_decision FOR EACH ROW EXECUTE FUNCTION preserve_source_provenance()"
    )


def downgrade():
    if op.get_bind().get_isolation_level() != "READ COMMITTED":
        raise RuntimeError(
            "Source provenance rollback requires READ COMMITTED isolation"
        )
    # Serialize both an already-running insert and a new insert with the empty
    # check and drop. Committed review history must never disappear between them.
    op.execute(
        "LOCK TABLE election_source_provenance_decision IN ACCESS EXCLUSIVE MODE"
    )
    op.execute("""
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM election_source_provenance_decision LIMIT 1) THEN
   RAISE EXCEPTION 'Retain source provenance history; roll back application behavior instead';
 END IF;
END $$
    """)
    op.execute(
        "DROP TRIGGER source_provenance_append_only ON election_source_provenance_decision"
    )
    op.execute("DROP FUNCTION preserve_source_provenance()")
    op.drop_table("election_source_provenance_decision")
