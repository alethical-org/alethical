"""Denormalize each bill's plain-language headline onto ``bill`` so search reads it.

Every bill card, bill page and Ask answer shows the AI-written plain-language
headline (``short_title``) instead of the bill's official legal title. Keyword
search read only ``bill.title`` and ``bill.description``, so searching the words
a reader can actually see returned nothing: the exact headline "Repeal of
Political Contribution Refund Program" matched no bill, while SF 3458 — whose
card shows precisely that — sat in the corpus. Its official title says
"repealing the political contribution refund program", which shares every word
except "of", and "of" appears nowhere in it.

``short_title`` lives inside ``ai_enrichment.content_json``, a TOASTed JSONB
column, so searching it in place would mean detoasting the enrichment table on
every request — the exact cost #505 removed by denormalizing
``has_current_summary``. This copies the headline onto ``bill`` the same way, via
an AFTER trigger on ``ai_enrichment`` that recomputes the column for the affected
bill on every insert/update/delete, so it covers every write path and can never
drift. A trigram GIN index (matching the ones 0011 added for title/description)
serves the substring, fuzzy and relevance-ranking branches of the search.

Additive and reversible: one nullable column, one function, one trigger, one
index, all dropped cleanly on downgrade. The backfill derives from data already
in the database, so it costs nothing and needs no external call.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
# Keep the revision id <= 32 chars — alembic_version.version_num is varchar(32).
revision = "0033_bill_short_title"
down_revision = "0032_campaign_finance_filings"
branch_labels = None
depends_on = None

SHORT_TITLE_INDEX = "ix_bill_short_title_trgm"

# The one SQL definition of "this bill's displayed headline", mirroring
# ``short_title`` in ``ai_analysis_payload_for_enrichment``
# (alethical/api/serializers.py): the current bill_summary enrichment's
# ``short_title``, blank-normalized to NULL. At most one row can match —
# ix_ai_enrichment_bill_summary_current_unique enforces one current summary per
# bill — so the LIMIT is a formality, not a tie-break.
FUNCTIONS_SQL = """
CREATE OR REPLACE FUNCTION bill_compute_short_title(target uuid)
RETURNS text
LANGUAGE sql STABLE AS $fn$
    SELECT nullif(btrim(content_json ->> 'short_title'), '')
      FROM ai_enrichment
     WHERE bill_id = target
       AND enrichment_type = 'bill_summary'::enrichment_type
       AND is_current
     LIMIT 1
$fn$;

CREATE OR REPLACE FUNCTION ai_enrichment_sync_bill_short_title()
RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.bill_id IS NOT NULL THEN
            UPDATE bill
               SET short_title = bill_compute_short_title(OLD.bill_id)
             WHERE id = OLD.bill_id;
        END IF;
        RETURN OLD;
    END IF;
    IF NEW.bill_id IS NOT NULL THEN
        UPDATE bill
           SET short_title = bill_compute_short_title(NEW.bill_id)
         WHERE id = NEW.bill_id;
    END IF;
    IF TG_OP = 'UPDATE'
       AND OLD.bill_id IS DISTINCT FROM NEW.bill_id
       AND OLD.bill_id IS NOT NULL THEN
        UPDATE bill
           SET short_title = bill_compute_short_title(OLD.bill_id)
         WHERE id = OLD.bill_id;
    END IF;
    RETURN NEW;
END;
$fn$;
"""

# A trigger of its own rather than folding this into 0007's
# ``ai_enrichment_sync_has_summary``: keeping that function's body untouched
# makes this revision purely additive, so its downgrade cannot leave 0007's
# column half-maintained. The extra UPDATE per enrichment write is paid only by
# the human-triggered enrichment pipeline, never by a read.
TRIGGERS_SQL = """
DROP TRIGGER IF EXISTS ai_enrichment_short_title ON ai_enrichment;
CREATE TRIGGER ai_enrichment_short_title
    AFTER INSERT OR UPDATE OR DELETE ON ai_enrichment
    FOR EACH ROW EXECUTE FUNCTION ai_enrichment_sync_bill_short_title();
"""

BACKFILL_SQL = "UPDATE bill SET short_title = bill_compute_short_title(id)"

DROP_SQL = """
DROP TRIGGER IF EXISTS ai_enrichment_short_title ON ai_enrichment;
DROP FUNCTION IF EXISTS ai_enrichment_sync_bill_short_title();
DROP FUNCTION IF EXISTS bill_compute_short_title(uuid);
"""


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    # On a fresh database the 0001 baseline builds every current model via
    # metadata.create_all, so the column already exists by the time this runs
    # (it's declared on the Bill model). Add it only where genuinely missing — a
    # database migrated before this revision (e.g. production). Same coexistence
    # guard as 0003/0004/0007.
    existing_columns = {c["name"] for c in inspector.get_columns("bill")}
    if "short_title" not in existing_columns:
        op.add_column("bill", sa.Column("short_title", sa.Text(), nullable=True))

    # Functions and triggers are never part of metadata.create_all, so always
    # (re)create them. CREATE OR REPLACE / DROP-then-CREATE make this idempotent.
    op.execute(FUNCTIONS_SQL)
    op.execute(TRIGGERS_SQL)
    op.execute(BACKFILL_SQL)

    existing_indexes = {ix["name"] for ix in inspector.get_indexes("bill")}
    if SHORT_TITLE_INDEX not in existing_indexes:
        # Built non-concurrently, like 0011's trigram indexes: on this corpus
        # (~10k bills, one short headline each) the build is sub-second, so the
        # brief lock during the deploy migration is acceptable.
        op.create_index(
            SHORT_TITLE_INDEX,
            "bill",
            ["short_title"],
            postgresql_using="gin",
            postgresql_ops={"short_title": "gin_trgm_ops"},
        )


def downgrade() -> None:
    op.execute(f"DROP INDEX IF EXISTS {SHORT_TITLE_INDEX}")
    op.execute(DROP_SQL)
    op.drop_column("bill", "short_title")
