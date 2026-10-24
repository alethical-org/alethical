"""Retain verified public identities, election outcomes and official research."""

from alembic import op

revision = "0069_candidate_person_records"
down_revision = "0068_profile_claim_review"
branch_labels = None
depends_on = None

TABLES = (
    "candidate_election",
    "candidate_race_record",
    "candidate_race_member",
    "public_person",
    "person_candidacy",
    "person_service_record",
    "person_research_record",
    "public_record_version",
)


def upgrade() -> None:
    op.execute("""
CREATE TABLE candidate_election (
	id VARCHAR(20) NOT NULL, 
	canonical_key VARCHAR(80) NOT NULL, 
	election_date DATE NOT NULL, 
	stage VARCHAR(20) NOT NULL, 
	public_payload JSONB NOT NULL, 
	CONSTRAINT pk_candidate_election PRIMARY KEY (id), 
	CONSTRAINT ck_candidate_election_valid_stage CHECK (stage IN ('general', 'primary', 'special')), 
	CONSTRAINT uq_candidate_election_id_stage UNIQUE (id, stage), 
	CONSTRAINT uq_candidate_election_canonical_key UNIQUE (canonical_key)
)
    """)
    op.execute("""
CREATE TABLE candidate_race_record (
	id VARCHAR(64) NOT NULL, 
	election_id VARCHAR(20) NOT NULL, 
	stage VARCHAR(20) NOT NULL, 
	jurisdiction_scope VARCHAR(160) NOT NULL, 
	office TEXT NOT NULL, 
	result_status VARCHAR(20) NOT NULL, 
	final BOOLEAN NOT NULL, 
	test_data BOOLEAN NOT NULL, 
	authority_scope VARCHAR(160), 
	result_payload JSONB NOT NULL, 
	CONSTRAINT pk_candidate_race_record PRIMARY KEY (id), 
	CONSTRAINT fk_candidate_race_record_election_id_candidate_election FOREIGN KEY(election_id, stage) REFERENCES candidate_election (id, stage), 
	CONSTRAINT ck_candidate_race_record_valid_result_status CHECK (result_status IN ('pending','unofficial','certified','recount','tie','unavailable')), 
	CONSTRAINT ck_candidate_race_record_final_certified_real CHECK (NOT final OR (result_status = 'certified' AND NOT test_data)), 
	CONSTRAINT ck_candidate_race_record_certified_scope_evidence CHECK (result_status != 'certified' OR (authority_scope IS NOT NULL AND authority_scope = jurisdiction_scope AND NOT test_data AND coalesce(jsonb_array_length(result_payload->'certificationEvidence'), 0) > 0))
)
    """)
    op.execute("""
CREATE TABLE candidate_race_member (
	candidate_id VARCHAR(64) NOT NULL, 
	race_id VARCHAR(64) NOT NULL, 
	identity JSONB NOT NULL, 
	CONSTRAINT pk_candidate_race_member PRIMARY KEY (candidate_id), 
	CONSTRAINT fk_candidate_race_member_candidate_id_candidate_record FOREIGN KEY(candidate_id) REFERENCES candidate_record (id), 
	CONSTRAINT fk_candidate_race_member_race_id_candidate_race_record FOREIGN KEY(race_id) REFERENCES candidate_race_record (id)
)
    """)
    op.execute(
        "CREATE INDEX ix_candidate_race_member_race_id ON candidate_race_member (race_id)"
    )
    op.execute("""
CREATE TABLE public_person (
	name TEXT NOT NULL, 
	legislator_id UUID, 
	identity_evidence JSONB NOT NULL, 
	id UUID NOT NULL, 
	CONSTRAINT pk_public_person PRIMARY KEY (id), 
	CONSTRAINT uq_public_person_legislator_id UNIQUE (legislator_id), 
	CONSTRAINT fk_public_person_legislator_id_legislator FOREIGN KEY(legislator_id) REFERENCES legislator (id) ON DELETE SET NULL
)
    """)
    op.execute("""
CREATE TABLE person_candidacy (
	person_id UUID NOT NULL, 
	candidate_id VARCHAR(64) NOT NULL, 
	identity JSONB NOT NULL, 
	evidence JSONB NOT NULL, 
	CONSTRAINT pk_person_candidacy PRIMARY KEY (person_id, candidate_id), 
	CONSTRAINT fk_person_candidacy_person_id_public_person FOREIGN KEY(person_id) REFERENCES public_person (id), 
	CONSTRAINT fk_person_candidacy_candidate_id_candidate_record FOREIGN KEY(candidate_id) REFERENCES candidate_record (id)
)
    """)
    op.execute("""
CREATE TABLE person_service_record (
	person_id UUID NOT NULL, 
	status VARCHAR(20) NOT NULL, 
	public_payload JSONB NOT NULL, 
	id UUID NOT NULL, 
	CONSTRAINT pk_person_service_record PRIMARY KEY (id), 
	CONSTRAINT ck_person_service_record_valid_service_status CHECK (status IN ('current','elected','former','unknown')), 
	CONSTRAINT fk_person_service_record_person_id_public_person FOREIGN KEY(person_id) REFERENCES public_person (id)
)
    """)
    op.execute(
        "CREATE INDEX ix_person_service_record_person_id ON person_service_record (person_id)"
    )
    op.execute("""
CREATE TABLE person_research_record (
	id VARCHAR(64) NOT NULL, 
	person_id UUID NOT NULL, 
	kind VARCHAR(30) NOT NULL, 
	public_payload JSONB NOT NULL, 
	sort_date DATE NOT NULL, 
	CONSTRAINT pk_person_research_record PRIMARY KEY (id), 
	CONSTRAINT ck_person_research_record_official_research_only CHECK (kind = 'official-record'), 
	CONSTRAINT fk_person_research_record_person_id_public_person FOREIGN KEY(person_id) REFERENCES public_person (id)
)
    """)
    op.execute(
        "CREATE INDEX ix_person_research_record_person_id ON person_research_record (person_id)"
    )
    op.execute("""
CREATE TABLE public_record_version (
	id VARCHAR(64) NOT NULL, 
	record_kind VARCHAR(30) NOT NULL, 
	record_id VARCHAR(80) NOT NULL, 
	source_sha256 VARCHAR(64) NOT NULL, 
	checked_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	public_payload JSONB NOT NULL, 
	CONSTRAINT pk_public_record_version PRIMARY KEY (id), 
	CONSTRAINT ck_public_record_version_public_record_kind CHECK (record_kind IN ('candidate','ballot','race','person','service','research'))
)
    """)
    op.execute(
        "CREATE INDEX ix_public_record_version_record ON public_record_version (record_kind, record_id)"
    )
    for name in TABLES:
        op.execute(f'ALTER TABLE public."{name}" ENABLE ROW LEVEL SECURITY')
    table_names = ", ".join(f"'{name}'" for name in TABLES)
    op.execute(f"""
        DO $$ BEGIN
            IF (
                SELECT count(*) FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public' AND c.relkind = 'r'
                  AND c.relname IN ({table_names}) AND c.relrowsecurity
            ) <> 8 OR EXISTS (
                SELECT 1 FROM pg_policy p
                JOIN pg_class c ON c.oid = p.polrelid
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public' AND c.relname IN ({table_names})
            ) THEN
                RAISE EXCEPTION 'Public person records require RLS enabled and zero policies';
            END IF;
        END $$;
    """)


def downgrade() -> None:
    for name in reversed(TABLES):
        op.drop_table(name)
