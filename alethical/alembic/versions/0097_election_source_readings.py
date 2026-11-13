"""Append-only checked local source readings, independent of candidate review."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0097_election_source_readings"
down_revision = "0096_board_finance_seals"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "election_source_reading_decision",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("subject_key", sa.String(64), nullable=False),
        sa.Column("receipt_sha256", sa.String(64), nullable=False),
        sa.Column("original_sha256", sa.String(64), nullable=False),
        sa.Column("schema_id", sa.String(80), nullable=False),
        sa.Column("request_key", sa.String(64), nullable=False),
        sa.Column("previous_decision_id", sa.BigInteger()),
        sa.Column("decision", sa.String(20), nullable=False),
        sa.Column("receipt", postgresql.JSONB(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("reviewed_by", sa.Text(), nullable=False),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["original_sha256"], ["election_result_source.content_hash"]
        ),
        sa.ForeignKeyConstraint(
            ["previous_decision_id", "subject_key"],
            [
                "election_source_reading_decision.id",
                "election_source_reading_decision.subject_key",
            ],
        ),
        sa.UniqueConstraint("request_key"),
        sa.UniqueConstraint("previous_decision_id"),
        sa.UniqueConstraint("id", "subject_key"),
        sa.CheckConstraint(
            "decision IN ('checked','withdrawn')", name="valid_decision"
        ),
        sa.CheckConstraint(
            "previous_decision_id IS NULL OR previous_decision_id < id",
            name="ordered_history",
        ),
        sa.CheckConstraint(
            "decision = 'checked' OR previous_decision_id IS NOT NULL",
            name="withdrawal_has_previous",
        ),
        sa.CheckConstraint("jsonb_typeof(receipt) = 'object'", name="receipt_object"),
    )
    op.create_index(
        "ix_source_reading_initial",
        "election_source_reading_decision",
        ["subject_key"],
        unique=True,
        postgresql_where=sa.text("previous_decision_id IS NULL"),
    )
    op.create_index(
        "ix_source_reading_receipt",
        "election_source_reading_decision",
        ["receipt_sha256", "id"],
    )
    op.create_index(
        "ix_source_reading_subject",
        "election_source_reading_decision",
        ["subject_key", "id"],
    )
    op.execute("""
CREATE FUNCTION preserve_source_reading() RETURNS trigger AS $$
DECLARE previous election_source_reading_decision;
BEGIN
 IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Source reading decisions are append-only'; END IF;
 IF NEW.previous_decision_id IS NOT NULL THEN
   SELECT * INTO previous FROM election_source_reading_decision
     WHERE id = NEW.previous_decision_id FOR UPDATE;
   IF NOT FOUND OR previous.subject_key <> NEW.subject_key
     OR previous.original_sha256 <> NEW.original_sha256 OR previous.schema_id <> NEW.schema_id THEN
     RAISE EXCEPTION 'Source reading predecessor belongs to another subject';
   END IF;
   IF NEW.decision = 'withdrawn' AND (NEW.receipt_sha256 <> previous.receipt_sha256 OR NEW.receipt <> previous.receipt) THEN
     RAISE EXCEPTION 'Withdrawal must retain the preceding reading';
   END IF;
 END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql
    """)
    op.execute(
        "CREATE TRIGGER source_reading_append_only BEFORE INSERT OR UPDATE OR DELETE ON election_source_reading_decision FOR EACH ROW EXECUTE FUNCTION preserve_source_reading()"
    )


def downgrade():
    op.execute(
        "DROP TRIGGER source_reading_append_only ON election_source_reading_decision"
    )
    op.execute("DROP FUNCTION preserve_source_reading()")
    op.drop_table("election_source_reading_decision")
