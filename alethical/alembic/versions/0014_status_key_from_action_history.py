"""Classify bill status (chamber-stamped passage + enacted) from action history (#607).

Net: a bill's list-card status was derived from the free-text ``current_status``
field, which can't reliably tell the House from the Senate (so the "Passed Senate"
filter returned nothing) and can't say a bill passed BOTH chambers. This reclassifies
the precomputed ``status_key`` / ``status_rank`` columns from the reliable signal —
chamber-stamped ``bill_action`` rows — and adds a ``passed_both_chambers`` stage.

What changes:
  * ``bill_compute_status_key(bill_id, current_status)`` (new) computes the status
    from cumulative *milestone* signals in the bill's action history (vetoed / signed
    into law / passed a chamber, chamber taken from ``bill_action.chamber_id``), while
    the *current-position* signals (in committee vs proposed) still read the latest
    ``current_status`` text. Passage requires a genuine floor-passage action
    ("Bill was passed" / "Third reading Passed" / "repassed", never "not passed"),
    so committee "to pass" reports and defeated bills no longer count as passed.
  * The BEFORE trigger on ``bill`` now calls this (was: text-only cascade). A NEW
    AFTER trigger on ``bill_action`` recomputes the parent bill's status whenever its
    actions change, so the column can never drift from the action history.
  * ``bill_status_rank_of(key)`` (new) ranks each key for sort=progress, inserting
    ``passed_both_chambers`` above the single-chamber stages.

Load-bearing: ``status_key`` / ``status_rank`` drive the list-card badge, the /bills
status filter, and sort=progress; the Python source of truth (``bill_status_key_expr``
/ ``bill_progress_rank`` in alethical/db/models.py) mirrors this SQL and is pinned by
test_bill_denormalized_signals.py.

Additive and reversible: no new columns, only CREATE OR REPLACE functions + one new
trigger + a zero-cost backfill (derives from data already in the DB). Downgrade
restores the 0007 text-only cascade exactly.
"""

from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "0014_status_key_action_history"
down_revision = "0013_bill_action_committee"
branch_labels = None
depends_on = None

# --- New classifier: milestones from action history, position from current_status --
FUNCTIONS_SQL = """
CREATE OR REPLACE FUNCTION bill_compute_status_key(target uuid, status text)
RETURNS text
LANGUAGE plpgsql STABLE AS $fn$
DECLARE
    s text := lower(coalesce(status, ''));
    has_veto boolean;
    has_enacted boolean;
    passed_house boolean;
    passed_senate boolean;
BEGIN
    -- Cumulative milestone flags scanned once over the bill's action history.
    -- Passage chamber comes from bill_action.chamber_id (the reliable signal),
    -- gated on a genuine floor-passage action_text (never "not passed").
    SELECT
        bool_or(lower(ba.action_text) LIKE '%veto%'),
        bool_or(
            lower(ba.action_text) LIKE '%governor approval%'
         OR lower(ba.action_text) LIKE '%governor''s action approval%'
         OR lower(ba.action_text) LIKE '%chapter number%'
         OR lower(ba.action_text) LIKE '%secretary of state%'
         OR lower(ba.action_text) LIKE '%effective date%'
        ),
        bool_or(
            ch.slug = 'house'
            AND (lower(ba.action_text) LIKE '%bill was passed%'
              OR lower(ba.action_text) LIKE '%third reading passed%'
              OR lower(ba.action_text) LIKE '%repassed%')
            AND lower(ba.action_text) NOT LIKE '%not passed%'
        ),
        bool_or(
            ch.slug = 'senate'
            AND (lower(ba.action_text) LIKE '%bill was passed%'
              OR lower(ba.action_text) LIKE '%third reading passed%'
              OR lower(ba.action_text) LIKE '%repassed%')
            AND lower(ba.action_text) NOT LIKE '%not passed%'
        )
    INTO has_veto, has_enacted, passed_house, passed_senate
    FROM bill_action ba
    LEFT JOIN chamber ch ON ch.id = ba.chamber_id
    WHERE ba.bill_id = target;

    has_veto := coalesce(has_veto, false);
    has_enacted := coalesce(has_enacted, false);
    passed_house := coalesce(passed_house, false);
    passed_senate := coalesce(passed_senate, false);

    IF s LIKE '%veto%' OR has_veto THEN
        RETURN 'vetoed';
    END IF;
    IF has_enacted
       OR s LIKE '%governor approval%'
       OR s LIKE '%governor''s action approval%'
       OR s LIKE '%chapter number%'
       OR s LIKE '%secretary of state%'
       OR s LIKE '%effective date%' THEN
        RETURN 'signed_into_law';
    END IF;
    IF passed_house AND passed_senate THEN
        RETURN 'passed_both_chambers';
    END IF;
    IF passed_senate THEN
        RETURN 'passed_senate';
    END IF;
    IF passed_house THEN
        RETURN 'passed_house';
    END IF;
    IF s LIKE '%referred%' OR s LIKE '%committee%' OR s LIKE '%second reading%' THEN
        RETURN 'in_committee';
    END IF;
    RETURN 'proposed';
END;
$fn$;

CREATE OR REPLACE FUNCTION bill_status_rank_of(key text)
RETURNS smallint
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
    SELECT (CASE key
        WHEN 'signed_into_law' THEN 0
        WHEN 'vetoed' THEN 1
        WHEN 'passed_both_chambers' THEN 2
        WHEN 'passed_senate' THEN 3
        WHEN 'passed_house' THEN 4
        WHEN 'in_committee' THEN 5
        ELSE 6
    END)::smallint
$fn$;

-- BEFORE trigger on bill: recompute both columns from current_status + actions.
-- NEW.id is already populated by the time a BEFORE INSERT trigger runs, and a new
-- bill has no actions yet, so passage/milestone flags are false on insert.
CREATE OR REPLACE FUNCTION bill_set_status_signals()
RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    NEW.status_key := bill_compute_status_key(NEW.id, NEW.current_status);
    NEW.status_rank := bill_status_rank_of(NEW.status_key);
    RETURN NEW;
END;
$fn$;

-- Recompute a single bill's status columns (fires the BEFORE trigger, which does
-- the actual classification, keeping one source of truth).
CREATE OR REPLACE FUNCTION bill_refresh_status_signals(target uuid)
RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE
    st text;
BEGIN
    SELECT current_status INTO st FROM bill WHERE id = target;
    IF NOT FOUND THEN
        RETURN;
    END IF;
    UPDATE bill SET
        status_key = bill_compute_status_key(target, st),
        status_rank = bill_status_rank_of(bill_compute_status_key(target, st))
    WHERE id = target;
END;
$fn$;

-- AFTER trigger on bill_action: passage now depends on the action history, so any
-- action write must refresh the parent bill's status (mirrors the has_summary
-- pattern in 0007). Covers insert / update / delete and a moved bill_id.
CREATE OR REPLACE FUNCTION bill_action_sync_status()
RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.bill_id IS NOT NULL THEN
            PERFORM bill_refresh_status_signals(OLD.bill_id);
        END IF;
        RETURN OLD;
    END IF;
    IF NEW.bill_id IS NOT NULL THEN
        PERFORM bill_refresh_status_signals(NEW.bill_id);
    END IF;
    IF TG_OP = 'UPDATE'
       AND OLD.bill_id IS DISTINCT FROM NEW.bill_id
       AND OLD.bill_id IS NOT NULL THEN
        PERFORM bill_refresh_status_signals(OLD.bill_id);
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

DROP TRIGGER IF EXISTS bill_action_status_signals ON bill_action;
CREATE TRIGGER bill_action_status_signals
    AFTER INSERT OR UPDATE OR DELETE ON bill_action
    FOR EACH ROW EXECUTE FUNCTION bill_action_sync_status();
"""

# Backfill from data already present — zero-cost. The BEFORE trigger recomputes to
# the same values on this UPDATE; setting them explicitly keeps the backfill
# self-documenting and independent of trigger presence.
BACKFILL_SQL = """
UPDATE bill SET
    status_key = bill_compute_status_key(id, current_status),
    status_rank = bill_status_rank_of(bill_compute_status_key(id, current_status));
"""

# --- Downgrade: restore the 0007 text-only cascade (its functions still exist) ----
DOWNGRADE_TRIGGER_SQL = """
DROP TRIGGER IF EXISTS bill_action_status_signals ON bill_action;

CREATE OR REPLACE FUNCTION bill_set_status_signals()
RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    NEW.status_key := bill_derive_status_key(NEW.current_status);
    NEW.status_rank := bill_derive_status_rank(NEW.current_status);
    RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS bill_status_signals ON bill;
CREATE TRIGGER bill_status_signals
    BEFORE INSERT OR UPDATE ON bill
    FOR EACH ROW EXECUTE FUNCTION bill_set_status_signals();
"""

DOWNGRADE_DROP_SQL = """
DROP FUNCTION IF EXISTS bill_action_sync_status();
DROP FUNCTION IF EXISTS bill_refresh_status_signals(uuid);
DROP FUNCTION IF EXISTS bill_compute_status_key(uuid, text);
DROP FUNCTION IF EXISTS bill_status_rank_of(text);
"""

DOWNGRADE_BACKFILL_SQL = """
UPDATE bill SET
    status_key = bill_derive_status_key(current_status),
    status_rank = bill_derive_status_rank(current_status);
"""


def upgrade() -> None:
    op.execute(FUNCTIONS_SQL)
    op.execute(TRIGGERS_SQL)
    op.execute(BACKFILL_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_TRIGGER_SQL)
    op.execute(DOWNGRADE_DROP_SQL)
    op.execute(DOWNGRADE_BACKFILL_SQL)
