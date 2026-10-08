"""Archive FCC political files and page-grounded draft readings."""

from alembic import op

revision = "0067_fcc_political_files"
down_revision = "0066_candidate_lookup"
branch_labels = None
depends_on = None

TABLES = (
    "fcc_source_body",
    "fcc_scan",
    "fcc_observation",
    "fcc_document",
    "fcc_extraction",
    "fcc_page",
    "fcc_expense_link",
)


def upgrade() -> None:
    op.execute("""
        CREATE TABLE fcc_source_body (
        	content_hash VARCHAR(64) NOT NULL,
        	object_key TEXT NOT NULL,
        	byte_size BIGINT NOT NULL,
        	compressed_hash VARCHAR(64) NOT NULL,
        	compressed_byte_size BIGINT NOT NULL,
        	compression VARCHAR(20) NOT NULL,
        	mirrored_at TIMESTAMP WITH TIME ZONE,
        	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
        	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
        	CONSTRAINT pk_fcc_source_body PRIMARY KEY (content_hash)
        )
    """)
    op.execute("""
        CREATE TABLE fcc_scan (
        	started_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
        	finished_at TIMESTAMP WITH TIME ZONE,
        	status VARCHAR(32) NOT NULL,
        	stations JSONB NOT NULL,
        	counts JSONB NOT NULL,
        	id UUID NOT NULL,
        	CONSTRAINT pk_fcc_scan PRIMARY KEY (id)
        )
    """)
    op.execute("""
        CREATE TABLE fcc_observation (
        	scan_id UUID NOT NULL,
        	url TEXT NOT NULL,
        	facility_id VARCHAR(20) NOT NULL,
        	kind VARCHAR(20) NOT NULL,
        	status VARCHAR(32) NOT NULL,
        	observed_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
        	content_hash VARCHAR(64),
        	details JSONB NOT NULL,
        	error TEXT,
        	CONSTRAINT pk_fcc_observation PRIMARY KEY (scan_id, url),
        	CONSTRAINT fk_fcc_observation_scan_id_fcc_scan FOREIGN KEY(scan_id) REFERENCES fcc_scan (id),
        	CONSTRAINT fk_fcc_observation_content_hash_fcc_source_body FOREIGN KEY(content_hash) REFERENCES fcc_source_body (content_hash)
        )
    """)
    op.execute("""
        CREATE INDEX ix_fcc_observation_status ON fcc_observation (scan_id, status)
    """)
    op.execute("""
        CREATE TABLE fcc_document (
        	facility_id VARCHAR(20) NOT NULL,
        	file_id TEXT NOT NULL,
        	content_hash VARCHAR(64) NOT NULL,
        	call_sign VARCHAR(30) NOT NULL,
        	folder_id TEXT NOT NULL,
        	folder_path TEXT NOT NULL,
        	name TEXT NOT NULL,
        	url TEXT NOT NULL,
        	year INTEGER,
        	uploaded_at TEXT,
        	first_seen_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
        	last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
        	last_downloaded_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
        	CONSTRAINT pk_fcc_document PRIMARY KEY (facility_id, file_id, content_hash),
        	CONSTRAINT fk_fcc_document_content_hash_fcc_source_body FOREIGN KEY(content_hash) REFERENCES fcc_source_body (content_hash)
        )
    """)
    op.execute("""
        CREATE INDEX ix_fcc_document_station_year ON fcc_document (facility_id, year)
    """)
    op.execute("""
        CREATE TABLE fcc_extraction (
        	content_hash VARCHAR(64) NOT NULL,
        	version VARCHAR(80) NOT NULL,
        	document_kind VARCHAR(32) NOT NULL,
        	status VARCHAR(32) NOT NULL,
        	facts JSONB NOT NULL,
        errors JSONB NOT NULL,
        attempts JSONB NOT NULL,
        	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
        	CONSTRAINT pk_fcc_extraction PRIMARY KEY (content_hash, version),
        	CONSTRAINT fk_fcc_extraction_content_hash_fcc_source_body FOREIGN KEY(content_hash) REFERENCES fcc_source_body (content_hash)
        )
    """)
    op.execute("""
        CREATE INDEX ix_fcc_extraction_facts ON fcc_extraction USING gin (facts)
    """)
    op.execute("""
        CREATE TABLE fcc_page (
        	content_hash VARCHAR(64) NOT NULL,
        	version VARCHAR(80) NOT NULL,
        	page INTEGER NOT NULL,
        	text TEXT NOT NULL,
        	method VARCHAR(32) NOT NULL,
        	status VARCHAR(32) NOT NULL,
        	error TEXT,
        	CONSTRAINT pk_fcc_page PRIMARY KEY (content_hash, version, page),
        	CONSTRAINT fk_fcc_page_content_hash_fcc_extraction FOREIGN KEY(content_hash, version) REFERENCES fcc_extraction (content_hash, version)
        )
    """)
    op.execute("""
        CREATE INDEX ix_fcc_page_text ON fcc_page USING gin (text gin_trgm_ops)
    """)
    op.execute("""
        CREATE TABLE fcc_expense_link (
        	content_hash VARCHAR(64) NOT NULL,
        	extraction_version VARCHAR(80) NOT NULL,
        	source_dataset VARCHAR(40) NOT NULL,
        	source_snapshot_id UUID NOT NULL,
        	source_content_hash VARCHAR(64) NOT NULL,
        	source_row_number INTEGER NOT NULL,
        	source_row JSONB NOT NULL,
        	status VARCHAR(20) NOT NULL,
        	evidence TEXT NOT NULL,
        	reviewed_by TEXT,
        	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
        	id UUID NOT NULL,
        	CONSTRAINT pk_fcc_expense_link PRIMARY KEY (id),
        CONSTRAINT uq_fcc_expense_link_content_hash_extraction_version_sou_6a92 UNIQUE (content_hash, extraction_version, source_dataset, source_snapshot_id, source_row_number),
        	CONSTRAINT ck_fcc_expense_link_fcc_link_status CHECK (status IN ('suggested', 'accepted', 'rejected')),
        	CONSTRAINT ck_fcc_expense_link_fcc_link_review CHECK (status = 'suggested' OR length(trim(reviewed_by)) > 0 AND reviewed_by IS NOT NULL),
        	CONSTRAINT ck_fcc_expense_link_fcc_link_evidence CHECK (length(trim(evidence)) > 0),
        	CONSTRAINT fk_fcc_expense_link_content_hash_fcc_extraction FOREIGN KEY(content_hash, extraction_version) REFERENCES fcc_extraction (content_hash, version),
        	CONSTRAINT fk_fcc_expense_link_content_hash_fcc_source_body FOREIGN KEY(content_hash) REFERENCES fcc_source_body (content_hash)
        )
    """)
    # These draft readings and reviewer notes have no public database access.
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
            ) <> 7 OR EXISTS (
                SELECT 1 FROM pg_policy p
                JOIN pg_class c ON c.oid = p.polrelid
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public' AND c.relname IN ({table_names})
            ) THEN
                RAISE EXCEPTION 'FCC archive requires RLS enabled and zero policies';
            END IF;
        END $$;
    """)


def downgrade() -> None:
    for name in reversed(TABLES):
        op.drop_table(name)
