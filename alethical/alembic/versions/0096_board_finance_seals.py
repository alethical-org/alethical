"""Seal Board report generations and bind a compact read index outside old IDs."""

from alembic import op

revision = "0096_board_finance_seals"
down_revision = "0095_external_election_finance"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        "ALTER TABLE election_finance_collection ADD COLUMN sealed_at TIMESTAMPTZ, ADD COLUMN report_index JSONB"
    )
    op.execute("""
CREATE FUNCTION board_finance_report_index(identifier VARCHAR) RETURNS JSONB AS $$
 SELECT jsonb_build_object('version', 1, 'reports', COALESCE(jsonb_agg(jsonb_build_object(
   'registration_number', r.registration_number, 'report_key', r.report_key,
   'document_hash', r.document_hash, 'filing', r.payload->'filing',
   'period_start', r.payload->'period_start', 'period_end', r.payload->'period_end',
   'period_basis', r.payload->'period_basis', 'figure_status', r.payload->'figure_status',
   'payload_hash', encode(sha256(convert_to(r.payload::text, 'UTF8')), 'hex')
 ) ORDER BY r.registration_number, r.report_key), '[]'::jsonb))
 FROM election_finance_report r WHERE r.collection_id = identifier
$$ LANGUAGE SQL STABLE
    """)
    op.execute("""
CREATE FUNCTION preserve_board_finance_parent() RETURNS trigger AS $$
BEGIN
 IF TG_OP = 'INSERT' THEN
   IF NEW.sealed_at IS NULL AND NEW.report_index IS NULL AND NEW.first_published_at IS NULL THEN RETURN NEW; END IF;
 ELSIF TG_OP = 'UPDATE' THEN
   IF OLD.sealed_at IS NULL AND NEW.sealed_at IS NOT NULL
      AND OLD.report_index IS NULL
      AND (to_jsonb(OLD) - ARRAY['sealed_at','report_index']) = (to_jsonb(NEW) - ARRAY['sealed_at','report_index'])
      AND NEW.report_index = board_finance_report_index(OLD.id)
      AND jsonb_array_length(NEW.report_index->'reports') = (NEW.coverage->>'reports')::integer THEN
     RETURN NEW;
   END IF;
   IF OLD.sealed_at IS NOT NULL AND OLD.first_published_at IS NULL AND NEW.first_published_at IS NOT NULL
      AND (to_jsonb(OLD) - 'first_published_at') = (to_jsonb(NEW) - 'first_published_at') THEN RETURN NEW; END IF;
 END IF;
 RAISE EXCEPTION 'Board finance generations are immutable';
END;
$$ LANGUAGE plpgsql
    """)
    op.execute("""
CREATE FUNCTION preserve_board_finance_child() RETURNS trigger AS $$
DECLARE parent_sealed TIMESTAMPTZ; parent_published TIMESTAMPTZ;
BEGIN
 IF TG_OP = 'INSERT' THEN
   SELECT sealed_at, first_published_at INTO parent_sealed, parent_published
     FROM election_finance_collection WHERE id = NEW.collection_id FOR UPDATE;
   IF FOUND AND parent_sealed IS NULL AND parent_published IS NULL THEN RETURN NEW; END IF;
 END IF;
 RAISE EXCEPTION 'Board finance reports are immutable or parent is sealed';
END;
$$ LANGUAGE plpgsql
    """)
    op.execute("""
CREATE FUNCTION board_finance_current_guard() RETURNS trigger AS $$
DECLARE parent_sealed TIMESTAMPTZ; parent_published TIMESTAMPTZ;
BEGIN
 SELECT sealed_at, first_published_at INTO parent_sealed, parent_published
   FROM election_finance_collection WHERE id = NEW.collection_id AND election_key = NEW.election_key FOR SHARE;
 IF NOT FOUND OR parent_sealed IS NULL OR parent_published IS NULL THEN RAISE EXCEPTION 'Board finance publication requires a sealed published generation'; END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql
    """)
    op.execute(
        "CREATE TRIGGER board_finance_parent_immutable BEFORE INSERT OR UPDATE OR DELETE ON election_finance_collection FOR EACH ROW EXECUTE FUNCTION preserve_board_finance_parent()"
    )
    op.execute(
        "CREATE TRIGGER board_finance_child_immutable BEFORE INSERT OR UPDATE OR DELETE ON election_finance_report FOR EACH ROW EXECUTE FUNCTION preserve_board_finance_child()"
    )
    op.execute(
        "CREATE TRIGGER board_finance_current_sealed BEFORE INSERT OR UPDATE ON election_finance_current FOR EACH ROW EXECUTE FUNCTION board_finance_current_guard()"
    )


def downgrade():
    op.execute("DROP TRIGGER board_finance_current_sealed ON election_finance_current")
    op.execute("DROP TRIGGER board_finance_child_immutable ON election_finance_report")
    op.execute(
        "DROP TRIGGER board_finance_parent_immutable ON election_finance_collection"
    )
    op.execute("DROP FUNCTION board_finance_current_guard()")
    op.execute("DROP FUNCTION preserve_board_finance_child()")
    op.execute("DROP FUNCTION preserve_board_finance_parent()")
    op.execute("DROP FUNCTION board_finance_report_index(VARCHAR)")
    op.execute(
        "ALTER TABLE election_finance_collection DROP COLUMN report_index, DROP COLUMN sealed_at"
    )
