"""Immutable federal/local finance generations and retained historical evidence."""

from alembic import op

revision = "0095_external_election_finance"
down_revision = "0094_election_outcomes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE election_campaign_account_decision ALTER COLUMN authority TYPE VARCHAR(160), ALTER COLUMN registration_number TYPE VARCHAR(160)"
    )
    op.execute("""
CREATE TABLE election_external_finance_generation (
    id VARCHAR(64) CONSTRAINT pk_election_external_finance_generation PRIMARY KEY,
    election_key VARCHAR(80) NOT NULL,
    snapshot_id VARCHAR(64) NOT NULL CONSTRAINT fk_election_external_finance_generation_snapshot_id_ele_e6f3 REFERENCES election_comparison_snapshot(id),
    copied_at TIMESTAMP WITH TIME ZONE NOT NULL,
    first_published_at TIMESTAMP WITH TIME ZONE,
    sealed_at TIMESTAMP WITH TIME ZONE,
    payload JSONB NOT NULL,
    CONSTRAINT uq_election_external_finance_generation_id_election_key UNIQUE(id, election_key)
)
    """)
    for table in ("report", "payment"):
        # Match the metadata convention's PostgreSQL long-name hash truncation.
        foreign_key = {
            "report": "fk_election_external_finance_report_generation_id_elect_b719",
            "payment": "fk_election_external_finance_payment_generation_id_elec_5266",
        }[table]
        op.execute(f"""
CREATE TABLE election_external_finance_{table} (
    generation_id VARCHAR(64) NOT NULL CONSTRAINT {foreign_key} REFERENCES election_external_finance_generation(id),
    key VARCHAR(64) NOT NULL,
    authority VARCHAR(160) NOT NULL,
    account_id VARCHAR(160) NOT NULL,
    payload JSONB NOT NULL,
    CONSTRAINT pk_election_external_finance_{table} PRIMARY KEY(generation_id, key)
)
        """)
    op.execute(
        "CREATE INDEX ix_external_finance_report_account ON election_external_finance_report (generation_id, authority, account_id)"
    )
    op.execute(
        "CREATE INDEX ix_external_finance_payment_target ON election_external_finance_payment (generation_id, authority, (payload ->> 'target_source_candidate_id'))"
    )
    op.execute("""
CREATE TABLE election_external_finance_current (
    election_key VARCHAR(80) CONSTRAINT pk_election_external_finance_current PRIMARY KEY,
    generation_id VARCHAR(64) NOT NULL,
    CONSTRAINT fk_election_external_finance_current_generation_id_elec_109a FOREIGN KEY(generation_id, election_key) REFERENCES election_external_finance_generation(id, election_key)
)
    """)
    op.execute("""
CREATE FUNCTION preserve_external_finance() RETURNS trigger AS $$
BEGIN
    IF TG_TABLE_NAME = 'election_external_finance_generation' THEN
        IF TG_OP = 'INSERT' AND NEW.sealed_at IS NULL AND NEW.first_published_at IS NULL THEN
            RETURN NEW;
        END IF;
        IF TG_OP = 'UPDATE' THEN
            IF OLD.sealed_at IS NULL AND NEW.sealed_at IS NOT NULL
               AND OLD.first_published_at IS NULL
               AND (to_jsonb(OLD) - 'sealed_at') = (to_jsonb(NEW) - 'sealed_at') THEN
                RETURN NEW;
            END IF;
            IF OLD.sealed_at IS NOT NULL AND OLD.first_published_at IS NULL
               AND NEW.first_published_at IS NOT NULL
               AND (to_jsonb(OLD) - 'first_published_at') = (to_jsonb(NEW) - 'first_published_at') THEN
                RETURN NEW;
            END IF;
        END IF;
    END IF;
    RAISE EXCEPTION 'External finance evidence is append-only';
END;
$$ LANGUAGE plpgsql
    """)
    op.execute("""
CREATE FUNCTION insert_external_finance_child() RETURNS trigger AS $$
DECLARE
    parent_sealed TIMESTAMP WITH TIME ZONE;
    parent_published TIMESTAMP WITH TIME ZONE;
BEGIN
    SELECT sealed_at, first_published_at INTO parent_sealed, parent_published
      FROM election_external_finance_generation WHERE id = NEW.generation_id FOR UPDATE;
    IF NOT FOUND OR parent_sealed IS NOT NULL OR parent_published IS NOT NULL THEN
        RAISE EXCEPTION 'External finance generation is sealed';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql
    """)
    for table in ("generation", "report", "payment"):
        operations = (
            "INSERT OR UPDATE OR DELETE"
            if table == "generation"
            else "UPDATE OR DELETE"
        )
        op.execute(
            f"CREATE TRIGGER external_finance_{table}_immutable BEFORE {operations} ON election_external_finance_{table} FOR EACH ROW EXECUTE FUNCTION preserve_external_finance()"
        )
        if table != "generation":
            op.execute(
                f"CREATE TRIGGER external_finance_{table}_insert BEFORE INSERT ON election_external_finance_{table} FOR EACH ROW EXECUTE FUNCTION insert_external_finance_child()"
            )


def downgrade() -> None:
    for table in ("generation", "report", "payment"):
        op.execute(
            f"DROP TRIGGER external_finance_{table}_immutable ON election_external_finance_{table}"
        )
    for table in ("report", "payment"):
        op.execute(
            f"DROP TRIGGER external_finance_{table}_insert ON election_external_finance_{table}"
        )
    op.execute("DROP FUNCTION insert_external_finance_child()")
    op.execute("DROP FUNCTION preserve_external_finance()")
    for table in ("current", "payment", "report", "generation"):
        op.drop_table(f"election_external_finance_{table}")
    # Refuse narrowing if external IDs still exist, rather than truncating history.
    op.execute(
        "ALTER TABLE election_campaign_account_decision ALTER COLUMN authority TYPE VARCHAR(40), ALTER COLUMN registration_number TYPE VARCHAR(20)"
    )
