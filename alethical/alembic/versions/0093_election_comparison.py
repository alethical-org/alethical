"""Retain election results, scoped financial evidence and account review history."""

from alembic import op

revision = "0093_election_comparison"
down_revision = "0092_mail_file_reuse"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
CREATE TABLE election_result_source (
	content_hash VARCHAR(64) NOT NULL, 
	object_key TEXT NOT NULL, 
	byte_size BIGINT NOT NULL, 
	compressed_hash VARCHAR(64) NOT NULL, 
	compressed_byte_size BIGINT NOT NULL, 
	compression VARCHAR(20) NOT NULL, 
	mirrored_at TIMESTAMP WITH TIME ZONE, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	CONSTRAINT pk_election_result_source PRIMARY KEY (content_hash)
)
    """)
    op.execute("""
CREATE TABLE election_comparison_snapshot (
	id VARCHAR(64) NOT NULL, 
	election_key VARCHAR(80) NOT NULL, 
	election_date DATE NOT NULL, 
	stage VARCHAR(20) NOT NULL, 
	fetched_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	first_published_at TIMESTAMP WITH TIME ZONE, 
	sources JSONB NOT NULL, 
	coverage JSONB NOT NULL, 
	CONSTRAINT pk_election_comparison_snapshot PRIMARY KEY (id), 
	CONSTRAINT uq_election_comparison_snapshot_id_election_key UNIQUE (id, election_key), 
	CONSTRAINT ck_election_comparison_snapshot_valid_stage CHECK (stage IN ('general','primary','special'))
)
    """)
    op.execute("""
CREATE INDEX ix_election_comparison_snapshot_election_key ON election_comparison_snapshot (election_key)
    """)
    op.execute("""
CREATE TABLE election_comparison_current (
	election_key VARCHAR(80) NOT NULL, 
	snapshot_id VARCHAR(64) NOT NULL, 
	CONSTRAINT pk_election_comparison_current PRIMARY KEY (election_key), 
	CONSTRAINT fk_election_comparison_current_snapshot_id_election_com_4053 FOREIGN KEY(snapshot_id, election_key) REFERENCES election_comparison_snapshot (id, election_key)
)
    """)
    op.execute("""
CREATE TABLE election_comparison_race (
	snapshot_id VARCHAR(64) NOT NULL, 
	id VARCHAR(64) NOT NULL, 
	label TEXT NOT NULL, 
	office_id VARCHAR(40) NOT NULL, 
	jurisdiction TEXT NOT NULL, 
	result_status VARCHAR(20) NOT NULL, 
	payload JSONB NOT NULL, 
	CONSTRAINT pk_election_comparison_race PRIMARY KEY (snapshot_id, id), 
	CONSTRAINT ck_election_comparison_race_valid_status CHECK (result_status IN ('pending','unofficial','certified','recount','tie','unavailable')), 
	CONSTRAINT ck_election_comparison_race_certification_evidence CHECK (result_status != 'certified' OR coalesce(jsonb_array_length(payload->'certificationEvidence'),0)>0), 
	CONSTRAINT fk_election_comparison_race_snapshot_id_election_compar_b0bc FOREIGN KEY(snapshot_id) REFERENCES election_comparison_snapshot (id)
)
    """)
    op.execute("""
CREATE TABLE election_comparison_precinct (
	snapshot_id VARCHAR(64) NOT NULL, 
	race_id VARCHAR(64) NOT NULL, 
	key VARCHAR(80) NOT NULL, 
	name TEXT NOT NULL, 
	county VARCHAR(20) NOT NULL, 
	payload JSONB NOT NULL, 
	CONSTRAINT pk_election_comparison_precinct PRIMARY KEY (snapshot_id, race_id, key), 
	CONSTRAINT fk_election_comparison_precinct_snapshot_id_election_co_f8bf FOREIGN KEY(snapshot_id, race_id) REFERENCES election_comparison_race (snapshot_id, id)
)
    """)
    op.execute("""
CREATE TABLE election_finance_collection (
	id VARCHAR(64) NOT NULL, 
	election_key VARCHAR(80) NOT NULL, 
	copied_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	first_published_at TIMESTAMP WITH TIME ZONE, 
	sources JSONB NOT NULL, 
	coverage JSONB NOT NULL, 
	CONSTRAINT pk_election_finance_collection PRIMARY KEY (id), 
	CONSTRAINT uq_election_finance_collection_id_election_key UNIQUE (id, election_key)
)
    """)
    op.execute("""
CREATE TABLE election_finance_report (
	collection_id VARCHAR(64) NOT NULL, 
	registration_number VARCHAR(20) NOT NULL, 
	report_key VARCHAR(64) NOT NULL, 
	document_hash VARCHAR(64), 
	payload JSONB NOT NULL, 
	CONSTRAINT pk_election_finance_report PRIMARY KEY (collection_id, registration_number, report_key), 
	CONSTRAINT fk_election_finance_report_collection_id_election_finan_673c FOREIGN KEY(collection_id) REFERENCES election_finance_collection (id), 
	CONSTRAINT fk_election_finance_report_document_hash_cf_report_document FOREIGN KEY(document_hash) REFERENCES cf_report_document (document_hash)
)
    """)
    op.execute("""
CREATE TABLE election_finance_current (
	election_key VARCHAR(80) NOT NULL, 
	collection_id VARCHAR(64) NOT NULL, 
	CONSTRAINT pk_election_finance_current PRIMARY KEY (election_key), 
	CONSTRAINT fk_election_finance_current_collection_id_election_fina_8309 FOREIGN KEY(collection_id, election_key) REFERENCES election_finance_collection (id, election_key)
)
    """)
    op.execute("""
CREATE TABLE election_campaign_account_decision (
	id BIGSERIAL NOT NULL, 
	request_key VARCHAR(64) NOT NULL, 
	previous_decision_id BIGINT, 
	compatible_decision_ids JSONB NOT NULL, 
	authority VARCHAR(40) NOT NULL, 
	election_key VARCHAR(80) NOT NULL, 
	race_id VARCHAR(64) NOT NULL, 
	candidate_id VARCHAR(64) NOT NULL, 
	registration_number VARCHAR(20) NOT NULL, 
	decision VARCHAR(20) NOT NULL, 
	period_start DATE NOT NULL, 
	period_end DATE NOT NULL, 
	identity JSONB NOT NULL, 
	evidence JSONB NOT NULL, 
	reason TEXT NOT NULL, 
	reviewed_by TEXT NOT NULL, 
	reviewed_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	CONSTRAINT pk_election_campaign_account_decision PRIMARY KEY (id), 
	CONSTRAINT ck_election_campaign_account_decision_valid_decision CHECK (decision IN ('confirmed','rejected','withdrawn')), 
	CONSTRAINT ck_election_campaign_account_decision_ordered_period CHECK (period_start <= period_end), 
	CONSTRAINT ck_election_campaign_account_decision_has_evidence CHECK (jsonb_array_length(evidence) > 0), 
	CONSTRAINT uq_election_campaign_account_decision_request_key UNIQUE (request_key), 
	CONSTRAINT uq_election_campaign_account_decision_previous_decision_id UNIQUE (previous_decision_id), 
	CONSTRAINT fk_election_campaign_account_decision_previous_decision_3698 FOREIGN KEY(previous_decision_id) REFERENCES election_campaign_account_decision (id)
)
    """)
    op.execute("""
CREATE INDEX ix_election_campaign_account_candidate ON election_campaign_account_decision (election_key, race_id, candidate_id, id)
    """)
    op.execute("""
CREATE FUNCTION preserve_election_account_decision() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Account review decisions are append-only';
END;
$$ LANGUAGE plpgsql
    """)
    op.execute("""
CREATE TRIGGER election_account_decision_append_only
BEFORE UPDATE OR DELETE ON election_campaign_account_decision
FOR EACH ROW EXECUTE FUNCTION preserve_election_account_decision()
    """)


def downgrade() -> None:
    op.execute(
        "DROP TRIGGER election_account_decision_append_only ON election_campaign_account_decision"
    )
    op.execute("DROP FUNCTION preserve_election_account_decision()")
    for table in (
        "election_campaign_account_decision",
        "election_finance_current",
        "election_finance_report",
        "election_finance_collection",
        "election_comparison_precinct",
        "election_comparison_race",
        "election_comparison_current",
        "election_comparison_snapshot",
        "election_result_source",
    ):
        op.drop_table(table)
