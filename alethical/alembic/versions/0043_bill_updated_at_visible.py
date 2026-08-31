"""Stop a bookkeeping-only write from moving a bill's "last changed" date.

Net: ``bill.updated_at`` now means "the last time a field a reader can see
changed", so the sitemap can publish it as the bill page's last-modified date
without the date jumping every time ingestion re-stamps a row it did not change.

Why the column needed help. ``Bill.ingestion_run_id`` is set to a fresh run id on
every ingestion pass (``alethical/pipeline/minnesota.py``, ``bill.ingestion_run_id
= run.id``), and production holds 10,517 distinct run ids for 10,517 bills -- one
run per bill -- so that value necessarily differs on every pass. A differing value
means SQLAlchemy always emits an UPDATE, and ``TimestampMixin.updated_at`` carries
``onupdate=func.now()``, so the column moved on every pass whether or not anything
a reader could see had changed. Measured against production on 2026-08-25: all
10,517 bill rows had ``updated_at`` later than ``latest_action_at``, spread across
only 7 calendar days and 451 distinct seconds -- a bulk-write marker, not a
record-changed date (#1761).

What the trigger does. On UPDATE it compares the whole new row against the old one
with two keys removed, ``updated_at`` itself and ``ingestion_run_id``: any
difference sets ``updated_at`` to now(), no difference restores the old value.
Comparing whole rows rather than listing the columns that matter is deliberate --
a column added later counts as reader-visible until someone decides otherwise, so
the failure direction is a date that moves when it need not, never a date that
silently freezes while the page changes.

It also means an update issued by another trigger moves the date: the AFTER
trigger on ``ai_enrichment`` that copies a regenerated headline into
``bill.short_title`` (alembic 0033) writes plain SQL that never touched
``updated_at``, and now that write registers as the reader-visible change it is.

The name sorts after ``bill_status_signals`` (alembic 0007/0014), which matters:
Postgres fires same-event row triggers in name order, so the status columns are
already recomputed by the time this comparison runs and a status change is seen.

Revision ID: 0043_bill_updated_at_visible
Revises: 0042_bill_summary_request
"""

from alembic import op

# 32 characters is the hard cap on this value: alembic_version.version_num is
# varchar(32), and a longer id fails only at the end of a real upgrade.
revision = "0043_bill_updated_at_visible"
down_revision = "0042_bill_summary_request"
branch_labels = None
depends_on = None

FUNCTION_SQL = """
CREATE OR REPLACE FUNCTION bill_updated_at_for_visible_changes()
RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    IF (to_jsonb(NEW) - 'updated_at' - 'ingestion_run_id')
       IS DISTINCT FROM (to_jsonb(OLD) - 'updated_at' - 'ingestion_run_id') THEN
        NEW.updated_at := now();
    ELSE
        NEW.updated_at := OLD.updated_at;
    END IF;
    RETURN NEW;
END;
$fn$;
"""

TRIGGER_SQL = """
DROP TRIGGER IF EXISTS bill_updated_at_visible_changes ON bill;
CREATE TRIGGER bill_updated_at_visible_changes
    BEFORE UPDATE ON bill
    FOR EACH ROW EXECUTE FUNCTION bill_updated_at_for_visible_changes();
"""


def upgrade() -> None:
    op.execute(FUNCTION_SQL)
    op.execute(TRIGGER_SQL)


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS bill_updated_at_visible_changes ON bill;")
    op.execute("DROP FUNCTION IF EXISTS bill_updated_at_for_visible_changes();")
