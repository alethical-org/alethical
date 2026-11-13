"""Append-only exact-race outcome reviews, separate from immutable returns."""

from alembic import op

revision = "0094_election_outcomes"
down_revision = "0093_election_comparison"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
CREATE TABLE election_outcome_source (
    id VARCHAR(64) CONSTRAINT pk_election_outcome_source PRIMARY KEY,
    content_hash VARCHAR(64) NOT NULL CONSTRAINT fk_election_outcome_source_content_hash_election_result_source REFERENCES election_result_source(content_hash),
    publisher_hash VARCHAR(64) NOT NULL CONSTRAINT fk_election_outcome_source_publisher_hash_election_resu_6c8e REFERENCES election_result_source(content_hash),
    url TEXT NOT NULL,
    final_url TEXT NOT NULL,
    publisher_url TEXT NOT NULL,
    publisher_hosts JSONB NOT NULL,
    authority TEXT NOT NULL,
    media_type VARCHAR(80) NOT NULL,
    fetched_at TIMESTAMP WITH TIME ZONE NOT NULL
)
    """)
    op.execute("""
CREATE TABLE election_outcome_decision (
    id BIGSERIAL CONSTRAINT pk_election_outcome_decision PRIMARY KEY,
    request_key VARCHAR(64) NOT NULL CONSTRAINT uq_election_outcome_decision_request_key UNIQUE,
    previous_decision_id BIGINT CONSTRAINT uq_election_outcome_decision_previous_decision_id UNIQUE CONSTRAINT fk_election_outcome_decision_previous_decision_id_elect_580f REFERENCES election_outcome_decision(id),
    snapshot_id VARCHAR(64) NOT NULL,
    race_id VARCHAR(64) NOT NULL,
    decision VARCHAR(20) NOT NULL CONSTRAINT ck_election_outcome_decision_valid_decision CHECK (decision IN ('recorded','withdrawn')),
    result_status VARCHAR(20) NOT NULL CONSTRAINT ck_election_outcome_decision_valid_status CHECK (
        result_status IN ('pending','unofficial','certified','recount','tie','unavailable')),
    identity JSONB NOT NULL,
    candidate_outcomes JSONB NOT NULL,
    evidence JSONB NOT NULL CONSTRAINT ck_election_outcome_decision_has_evidence CHECK (jsonb_array_length(evidence) > 0),
    reason TEXT NOT NULL,
    reviewed_by TEXT NOT NULL,
    reviewed_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT fk_election_outcome_decision_snapshot_id_election_compa_2c57 FOREIGN KEY(snapshot_id, race_id) REFERENCES election_comparison_race(snapshot_id, id)
)
    """)
    op.execute(
        "CREATE INDEX ix_election_outcome_race ON election_outcome_decision (snapshot_id, race_id, id)"
    )
    op.execute("""
CREATE FUNCTION preserve_election_outcome_decision() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Outcome review decisions are append-only';
END;
$$ LANGUAGE plpgsql
    """)
    op.execute("""
CREATE TRIGGER election_outcome_decision_append_only
BEFORE UPDATE OR DELETE ON election_outcome_decision
FOR EACH ROW EXECUTE FUNCTION preserve_election_outcome_decision()
    """)
    op.execute("""
CREATE TRIGGER election_outcome_source_append_only
BEFORE UPDATE OR DELETE ON election_outcome_source
FOR EACH ROW EXECUTE FUNCTION preserve_election_outcome_decision()
    """)


def downgrade() -> None:
    op.execute(
        "DROP TRIGGER election_outcome_source_append_only ON election_outcome_source"
    )
    op.execute(
        "DROP TRIGGER election_outcome_decision_append_only ON election_outcome_decision"
    )
    op.execute("DROP FUNCTION preserve_election_outcome_decision()")
    op.drop_table("election_outcome_decision")
    op.drop_table("election_outcome_source")
