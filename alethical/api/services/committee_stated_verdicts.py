"""Both stored verdicts about one committee, read in one statement.

``cf_stated_spending`` (does the committee's own filed money-out figure agree with
the payment rows we hold) and ``cf_stated_split`` (the same question for money in)
are 2 tables, and a money page asks both about the same committee. Each cost a round
trip to a database in another region, on a legislator's money tab and on a committee
page alike (18 Sep 2026). One ``UNION ALL`` reads both, and inside a pinned request
(``committee_finance.pin_to_one_view``) the answer is remembered, so whichever of the 2
modules asks first pays the trip and the other asks nothing.

Each table keeps its own filters word for word: the spending verdict belongs to the
release's expenditures snapshot, the split verdict to its contributions snapshot, and
both to the current filings copy, so replacing any source retires the old verdict.
"""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.orm import Session

from alethical.pipeline import campaign_finance_filings as filings
from alethical.pipeline.campaign_finance_reader import Release

SPENDING = "spending"
SPLIT = "split"

# ``status`` is a different enum on each table, so both are read as text; the 2
# modules turn the text back into their own status values.
_SQL = text(
    """
    SELECT 'spending' AS verdict, registration_number, filing_year, status::text,
           reason, stated_itemized, stated_itemized_paid, ours_itemized,
           stated_non_itemized, cut_off_date, report_type, amendment_index,
           self_test, checked_at
      FROM cf_stated_spending
     WHERE snapshot_id = :expenditures
       AND filings_snapshot_id = (
           SELECT snapshot_id FROM cf_filing_current WHERE id IS TRUE
       )
       AND registration_number = :reg_num
    UNION ALL
    SELECT 'split', registration_number, filing_year, status::text,
           reason, stated_itemized, NULL::numeric, ours_itemized,
           stated_non_itemized, cut_off_date, report_type, amendment_index,
           self_test, checked_at
      FROM cf_stated_split
     WHERE snapshot_id = :contributions
       AND filings_snapshot_id = (
           SELECT snapshot_id FROM cf_filing_current WHERE id IS TRUE
       )
       AND registration_number = :reg_num
    """
)


def verdict_rows(db: Session, release: Release, reg_num: str) -> dict[str, list]:
    """``{"spending": rows, "split": rows}`` for one committee, every year held.

    Row columns, in order: registration_number, filing_year, status (text), reason,
    stated_itemized, stated_itemized_paid (``None`` on a split row), ours_itemized,
    stated_non_itemized, cut_off_date, report_type, amendment_index, self_test,
    checked_at.
    """
    memo = filings.pinned_memo(db)
    held = memo.setdefault("verdicts", {}) if memo is not None else {}
    key = (release.id, reg_num)
    if key not in held:
        found: dict[str, list] = {SPENDING: [], SPLIT: []}
        for verdict, *columns in db.execute(
            _SQL,
            {
                "expenditures": release.expenditures.snapshot_id,
                "contributions": release.contributions.snapshot_id,
                "reg_num": reg_num,
            },
        ).all():
            found[verdict].append(tuple(columns))
        held[key] = found
    return held[key]
