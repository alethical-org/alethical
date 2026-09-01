"""Let a confirmed legislator-committee match be taken back, and say when, why and who.

Net: a person at Alethical reads Minnesota's records and confirms that a named campaign
account belongs to a named legislator; 242 accounts are confirmed. Nothing could undo one,
and an undo by hand in the database would leave both pages carrying it looking like an
account nobody had ever checked. This makes the withdrawal a state the schema can hold
(#1902), before the January 2027 roster turn makes withdrawals likely.

**A third enum value rather than a flag beside the existing one, and that is the whole
decision.** 6 queries select on ``decision = 'confirmed'`` -- in
``alethical/api/services/legislator_finance.py``,
``alethical/api/services/independent_spending.py``,
``alethical/api/services/campaign_finance_register.py``,
``alethical/pipeline/campaign_finance.py`` and
``scripts/review_legislator_campaign_committees.py`` -- and so does the partial unique index
``uq_legislator_campaign_committee_confirmed_registration``. Moving the row's own decision
to ``withdrawn`` takes it out of every one of them at once, including any written later,
and takes it out of the index so the same registration number can be confirmed again. A
nullable ``withdrawn_at`` beside an unchanged ``confirmed`` would have needed all 6 edited
and the index rebuilt, and any one of them missed is a withdrawn account still published
under a person's name -- the exact leak #1902 is about.

Additive: one enum value, 3 nullable columns and one check constraint every existing row
already satisfies. No existing row is read or written, and the index is not touched.
Round-tripped upgrade -> downgrade -> upgrade against real Postgres.

**The downgrade refuses to run once a withdrawal exists, on purpose.** Postgres cannot drop
an enum value, so going back means recreating the type without ``withdrawn``, and the cast
raises on any row holding it. The alternative is worse in both directions: turning such a
row back into ``confirmed`` republishes an account a person deliberately took back, and
turning it into ``rejected`` records a claim nobody made. A loud failure naming the rows is
the honest outcome, and 0 rows hold this value today.

Revision ID: 0050_committee_link_withdrawal
Revises: 0049_report_document_series
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0050_committee_link_withdrawal"
down_revision = "0049_report_document_series"
branch_labels = None
depends_on = None

TABLE = "legislator_campaign_committee"
ENUM = "committee_link_review_decision"
# Bare suffix: the metadata naming convention prepends ``ck_<table>_``, so passing the
# full name here would produce ``ck_legislator_campaign_committee_ck_legislator_...``,
# truncated to 63 characters with a hash on the end.
CHECK = "withdrawal_is_explained"
INDEX = "uq_legislator_campaign_committee_confirmed_registration"

COLUMNS = (
    ("withdrawn_at", sa.DateTime(timezone=True)),
    ("withdrawal_reason", sa.Text()),
    ("withdrawn_by", sa.String(length=120)),
)

# A withdrawal states when, why and who, or it is not stored. Two details, both measured:
#
# * ``decision::text`` rather than the enum literal, because Postgres forbids *using* a new
#   enum value in the transaction that added it, and a text comparison never touches the
#   type's values.
# * ``~ '[^[:space:]]'`` -- at least one non-whitespace character -- rather than
#   ``btrim(x) <> ''``, because Postgres's ``btrim`` strips spaces only, so a reason of one
#   tab passed the first version of this constraint.
#
# Kept identical to the model's own CheckConstraint so `scripts/check_schema_drift.py` has
# nothing to report.
CHECK_SQL = (
    "decision::text <> 'withdrawn' OR ("
    "withdrawn_at IS NOT NULL "
    "AND withdrawal_reason IS NOT NULL "
    "AND withdrawal_reason ~ '[^[:space:]]' "
    "AND withdrawn_by IS NOT NULL "
    "AND withdrawn_by ~ '[^[:space:]]'"
    ")"
)


def upgrade() -> None:
    # IF NOT EXISTS so a re-run is a no-op rather than an error, matching how every other
    # step here behaves. Safe inside Alembic's transaction on Postgres 12 and above.
    op.execute(f"ALTER TYPE {ENUM} ADD VALUE IF NOT EXISTS 'withdrawn'")
    for name, kind in COLUMNS:
        op.add_column(TABLE, sa.Column(name, kind, nullable=True))
    op.create_check_constraint(CHECK, TABLE, CHECK_SQL)


def downgrade() -> None:
    op.drop_constraint(CHECK, TABLE, type_="check")
    for name, _ in reversed(COLUMNS):
        op.drop_column(TABLE, name)
    # The partial index has to come down first and go back up after, and this is measured
    # rather than precautionary: its predicate is bound to the enum type it was created
    # against, so renaming the type and creating a fresh one under the old name leaves the
    # predicate comparing the new type to the renamed one, and Postgres refuses the column
    # cast with "operator does not exist". Dropping and rebuilding it is also what proves
    # the rebuilt index is the same index -- a unique index that cannot be created because
    # 2 rows now collide is a failure worth hitting here rather than later.
    op.drop_index(INDEX, table_name=TABLE)
    # Recreate the type without 'withdrawn'. The USING cast raises on any row holding it,
    # which is the intended outcome: see the module docstring.
    op.execute(f"ALTER TYPE {ENUM} RENAME TO {ENUM}_with_withdrawn")
    op.execute(f"CREATE TYPE {ENUM} AS ENUM ('confirmed', 'rejected')")
    op.execute(
        f"ALTER TABLE {TABLE} ALTER COLUMN decision TYPE {ENUM} "
        f"USING decision::text::{ENUM}"
    )
    op.execute(f"DROP TYPE {ENUM}_with_withdrawn")
    op.create_index(
        INDEX,
        TABLE,
        ["registration_number"],
        unique=True,
        postgresql_where=sa.text("decision = 'confirmed'"),
    )
