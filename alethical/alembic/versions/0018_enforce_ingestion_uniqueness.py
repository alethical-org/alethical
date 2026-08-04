"""Make three unique keys actually block the duplicates they were written for (#928).

Net: three ingestion paths assumed the database was stopping a duplicate and it
was not. Two of them hit the same Postgres rule -- **a unique key never blocks two
rows whose value is empty**, because NULL is not considered equal to NULL -- so a
key naming a nullable column protected every row except the ones that needed it.
The third had no key at all, only an index that looked like one.

Verified against production before writing this: **all three keys hold today with
0 violations**, so every statement below succeeds without touching a row. That is
what makes this additive rather than a repair.

sponsorship
    Was ``UNIQUE(bill_id, legislator_id, committee_id, role)``. ``committee_id`` is
    empty on an ordinary legislator authorship, which is most of the table, so the
    key blocked nothing there. Adding ``NULLS NOT DISTINCT`` alone would have been
    too strict in the other direction: one person can author the same bill on both
    chambers' lists, and the official record shows it -- SF 1943 lists
    Hemmingsen-Jaeger as House author 14 *and* Senate author 5. So
    ``source_chamber`` joins the key, and those two rows stay legal while a true
    repeat does not.

legislator_service_period
    ``upsert_service_period`` looks a row up by ``(legislator_id, session_id,
    is_current)`` and inserts when it finds none, but no key said that was unique.
    ``ix_legislator_service_period_legislator_session_current`` names those three
    columns and is **not** unique, which is worse than nothing: it reads like
    protection. A partial unique index now enforces at-most-one current period per
    member per session -- the same shape as
    ``uq_bill_version_one_current_per_bill``.

committee_membership
    ``UNIQUE(committee_id, legislator_id, role)`` where ``role`` is empty on an
    ordinary membership. Same null rule, same hole. ``NULLS NOT DISTINCT`` closes
    it.

Reversible: the downgrade restores each key exactly as it was. Replacing a
constraint is a drop and an add inside one transaction, so the table is never
briefly unprotected.
"""

from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "0018_enforce_ingestion_uniq"
down_revision = "0017_align_models_with_prod"
branch_labels = None
depends_on = None

SPONSORSHIP_UQ = "uq_sponsorship_bill_id_legislator_id_committee_id_role"
# Short and hand-written, matching models.py. The naming convention would generate
# 69 characters for these five columns; Postgres truncates identifiers at 63 and
# SQLAlchemy appends a hash instead, so a generated name would force this file to
# hard-code that hash.
SPONSORSHIP_UQ_NEW = "uq_sponsorship_bill_author_role_chamber"
MEMBERSHIP_UQ = "uq_committee_membership_committee_id_legislator_id_role"
SERVICE_PERIOD_CURRENT_UQ = "uq_legislator_service_period_one_current"


def upgrade() -> None:
    op.execute(f"ALTER TABLE sponsorship DROP CONSTRAINT IF EXISTS {SPONSORSHIP_UQ}")
    op.execute(
        f"ALTER TABLE sponsorship ADD CONSTRAINT {SPONSORSHIP_UQ_NEW} "
        "UNIQUE NULLS NOT DISTINCT "
        "(bill_id, legislator_id, committee_id, role, source_chamber)"
    )

    op.execute(
        f"CREATE UNIQUE INDEX IF NOT EXISTS {SERVICE_PERIOD_CURRENT_UQ} "
        "ON legislator_service_period (legislator_id, session_id) WHERE is_current"
    )

    op.execute(
        f"ALTER TABLE committee_membership DROP CONSTRAINT IF EXISTS {MEMBERSHIP_UQ}"
    )
    op.execute(
        f"ALTER TABLE committee_membership ADD CONSTRAINT {MEMBERSHIP_UQ} "
        "UNIQUE NULLS NOT DISTINCT (committee_id, legislator_id, role)"
    )


def downgrade() -> None:
    op.execute(
        f"ALTER TABLE committee_membership DROP CONSTRAINT IF EXISTS {MEMBERSHIP_UQ}"
    )
    op.execute(
        f"ALTER TABLE committee_membership ADD CONSTRAINT {MEMBERSHIP_UQ} "
        "UNIQUE (committee_id, legislator_id, role)"
    )

    op.execute(f"DROP INDEX IF EXISTS {SERVICE_PERIOD_CURRENT_UQ}")

    op.execute(
        f"ALTER TABLE sponsorship DROP CONSTRAINT IF EXISTS {SPONSORSHIP_UQ_NEW}"
    )
    op.execute(
        f"ALTER TABLE sponsorship ADD CONSTRAINT {SPONSORSHIP_UQ} "
        "UNIQUE (bill_id, legislator_id, committee_id, role)"
    )
