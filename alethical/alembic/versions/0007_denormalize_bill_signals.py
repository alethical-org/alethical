"""Denormalize per-request derived signals onto bill (#505).

Adds three columns to ``bill`` and maintains them with DB triggers so they can
never drift from their source data — the correctness requirement of #505:

  * ``has_current_summary`` (bool) — true iff a current, non-empty
    ``bill_summary`` enrichment exists. Equals the ``current_bill_summary_
    enrichment_bill_ids`` semi-join exactly. Maintained by an AFTER trigger on
    ``ai_enrichment`` that recomputes the flag for the affected bill on every
    insert/update/delete, so it covers every write path (existing and future).

  * ``status_key`` (text) / ``status_rank`` (smallint) — the list-card status
    classification and its legislative-progress rank, precomputed from
    ``current_status`` via the exact cascade in ``bill_status_key_expr`` /
    ``bill_progress_rank`` (the Python source of truth). Maintained by a BEFORE
    trigger on ``bill`` that sets both from ``current_status`` on every write.

The cascade lives in ONE SQL definition (``bill_derive_status_key``), used by
both the trigger and the backfill; ``bill_derive_status_rank`` is derived from
it, so the two columns can never disagree with each other. An equivalence test
(alethical/tests/test_bill_denormalized_signals.py) pins the SQL cascade against
the Python expressions so the two sides can never silently drift either.

Backfill is zero-cost — both columns derive from data already in the DB.

Additive and reversible: nullable/defaulted columns + triggers + one index, all
dropped cleanly on downgrade.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
# Keep the revision id <= 32 chars — alembic_version.version_num is varchar(32).
revision = "0007_denormalize_bill_signals"
down_revision = "0006_widen_legislator_term"
branch_labels = None
depends_on = None

PROGRESS_INDEX = "ix_bill_session_progress"

# One SQL definition of the status cascade, mirroring ``bill_status_key_expr``
# (alethical/db/models.py). ``bill_derive_status_rank`` is derived from it and
# the rank map mirrors ``_STATUS_KEY_RANK``. test_bill_denormalized_signals.py
# asserts these classify identically to the Python expressions over the corpus.
FUNCTIONS_SQL = """
CREATE OR REPLACE FUNCTION bill_derive_status_key(status text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
    SELECT CASE
        WHEN lower(coalesce(status, '')) LIKE '%veto%' THEN 'vetoed'
        WHEN lower(coalesce(status, '')) LIKE '%governor%'
          OR lower(coalesce(status, '')) LIKE '%chapter number%'
          OR lower(coalesce(status, '')) LIKE '%secretary of state%'
          OR lower(coalesce(status, '')) LIKE '%effective date%'
            THEN 'signed_into_law'
        WHEN lower(coalesce(status, '')) LIKE '%senate%'
         AND lower(coalesce(status, '')) LIKE '%pass%' THEN 'passed_senate'
        WHEN lower(coalesce(status, '')) LIKE '%pass%' THEN 'passed_house'
        WHEN lower(coalesce(status, '')) LIKE '%referred%'
          OR lower(coalesce(status, '')) LIKE '%committee%'
          OR lower(coalesce(status, '')) LIKE '%second reading%'
            THEN 'in_committee'
        ELSE 'proposed'
    END
$fn$;

CREATE OR REPLACE FUNCTION bill_derive_status_rank(status text)
RETURNS smallint
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
    SELECT (CASE bill_derive_status_key(status)
        WHEN 'signed_into_law' THEN 0
        WHEN 'vetoed' THEN 1
        WHEN 'passed_senate' THEN 2
        WHEN 'passed_house' THEN 3
        WHEN 'in_committee' THEN 4
        ELSE 5
    END)::smallint
$fn$;

CREATE OR REPLACE FUNCTION bill_compute_has_current_summary(target uuid)
RETURNS boolean
LANGUAGE sql STABLE AS $fn$
    SELECT EXISTS (
        SELECT 1 FROM ai_enrichment
        WHERE bill_id = target
          AND enrichment_type = 'bill_summary'::enrichment_type
          AND is_current
          AND nullif(btrim(content_json ->> 'summary'), '') IS NOT NULL
    )
$fn$;

CREATE OR REPLACE FUNCTION bill_set_status_signals()
RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    NEW.status_key := bill_derive_status_key(NEW.current_status);
    NEW.status_rank := bill_derive_status_rank(NEW.current_status);
    RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION ai_enrichment_sync_has_summary()
RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.bill_id IS NOT NULL THEN
            UPDATE bill
               SET has_current_summary = bill_compute_has_current_summary(OLD.bill_id)
             WHERE id = OLD.bill_id;
        END IF;
        RETURN OLD;
    END IF;
    IF NEW.bill_id IS NOT NULL THEN
        UPDATE bill
           SET has_current_summary = bill_compute_has_current_summary(NEW.bill_id)
         WHERE id = NEW.bill_id;
    END IF;
    IF TG_OP = 'UPDATE'
       AND OLD.bill_id IS DISTINCT FROM NEW.bill_id
       AND OLD.bill_id IS NOT NULL THEN
        UPDATE bill
           SET has_current_summary = bill_compute_has_current_summary(OLD.bill_id)
         WHERE id = OLD.bill_id;
    END IF;
    RETURN NEW;
END;
$fn$;
"""

TRIGGERS_SQL = """
DROP TRIGGER IF EXISTS bill_status_signals ON bill;
CREATE TRIGGER bill_status_signals
    BEFORE INSERT OR UPDATE ON bill
    FOR EACH ROW EXECUTE FUNCTION bill_set_status_signals();

DROP TRIGGER IF EXISTS ai_enrichment_has_summary ON ai_enrichment;
CREATE TRIGGER ai_enrichment_has_summary
    AFTER INSERT OR UPDATE OR DELETE ON ai_enrichment
    FOR EACH ROW EXECUTE FUNCTION ai_enrichment_sync_has_summary();
"""

# Backfill from data already present — zero-cost. The BEFORE trigger also sets
# status_key/status_rank on this UPDATE (to the same derived values); setting
# them explicitly keeps the backfill self-documenting and independent.
BACKFILL_SQL = """
UPDATE bill SET
    has_current_summary = bill_compute_has_current_summary(id),
    status_key = bill_derive_status_key(current_status),
    status_rank = bill_derive_status_rank(current_status);
"""

DROP_SQL = """
DROP TRIGGER IF EXISTS bill_status_signals ON bill;
DROP TRIGGER IF EXISTS ai_enrichment_has_summary ON ai_enrichment;
DROP FUNCTION IF EXISTS bill_set_status_signals();
DROP FUNCTION IF EXISTS ai_enrichment_sync_has_summary();
DROP FUNCTION IF EXISTS bill_derive_status_rank(text);
DROP FUNCTION IF EXISTS bill_compute_has_current_summary(uuid);
DROP FUNCTION IF EXISTS bill_derive_status_key(text);
"""


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    # On a fresh database the 0001 baseline builds every current model via
    # metadata.create_all, so these columns and the index already exist by the
    # time 0007 runs (they're declared on the Bill model). Add them only where
    # genuinely missing — a database migrated before this revision (e.g. prod).
    # Same coexistence guard as 0003/0004.
    existing_columns = {c["name"] for c in inspector.get_columns("bill")}
    if "has_current_summary" not in existing_columns:
        op.add_column(
            "bill",
            sa.Column(
                "has_current_summary",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("false"),
            ),
        )
    if "status_key" not in existing_columns:
        op.add_column(
            "bill", sa.Column("status_key", sa.String(length=50), nullable=True)
        )
    if "status_rank" not in existing_columns:
        op.add_column(
            "bill", sa.Column("status_rank", sa.SmallInteger(), nullable=True)
        )

    # Functions and triggers are never part of metadata.create_all, so always
    # (re)create them. CREATE OR REPLACE / DROP-then-CREATE make this idempotent.
    op.execute(FUNCTIONS_SQL)
    op.execute(TRIGGERS_SQL)

    # Backfill existing rows (no-op on a fresh empty database).
    op.execute(BACKFILL_SQL)

    existing_indexes = {ix["name"] for ix in inspector.get_indexes("bill")}
    if PROGRESS_INDEX not in existing_indexes:
        op.create_index(
            PROGRESS_INDEX,
            "bill",
            [
                "session_id",
                "status_rank",
                sa.text("latest_action_at DESC NULLS LAST"),
                "file_number",
                "id",
            ],
            postgresql_where=sa.text("has_current_summary"),
        )


def downgrade() -> None:
    op.execute(f"DROP INDEX IF EXISTS {PROGRESS_INDEX}")
    op.execute(DROP_SQL)
    op.drop_column("bill", "status_rank")
    op.drop_column("bill", "status_key")
    op.drop_column("bill", "has_current_summary")
