"""Whether a committee-year's own filing agrees with the payments out we hold (#1645).

Net: a money page shows what a committee spent. A payment we are **missing** does not go
missing on the page: it makes a committee look like it spent less than it did, under a
real politician's name, with the state's own filing saying otherwise. A payment we hold
that the filing does not itemize is the opposite error and reads just as confidently.
This module is how a page finds out which it is, before it draws anything.

**It answers per committee-year and never for a whole release.** Eugene ruled on 12 Aug
2026 that where 2 of Minnesota's own publications disagree and we cannot derive the
truth, we show both figures and say plainly that they disagree. So a committee whose
figures contradict each other says so on its own page while every other committee's page
draws normally.

**4 answers, and the last 2 are both "no verdict" for reasons that must never be
collapsed.** ``not_checked`` is Minnesota's gap: we hold no copy of the filing's report
document, because the Board serves one for only about 1 report in 4 and answers HTTP 200
to every refusal. ``reader_unproven`` is ours: a document was read and our own reader
disagreed with figures we already trust, so the reader is wrong and no claim is made
about the data at all.

**Read, never computed here.** The answer costs a document read out of our own store, so
it is produced by ``scripts/check_campaign_finance_stated_spending.py`` and stored. A
committee-year with no stored answer is ``NOT_RUN`` -- a fact about us, and not a verdict
about the committee.

**Independent expenditures are in neither figure.** Minnesota publishes what a committee
spent for or against someone as a separate download, so both ``stated_itemized`` and
``ours_itemized`` exclude it and a page that adds the 2 files together is describing
something neither figure counts (§2.1).

Design: ``docs/architecture/campaign-finance-system-design.md`` §9.9 (what has and has
not been reconciled).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Iterable, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from alethical.db.models import CampaignFinanceStatedSpendingStatus as Status
from alethical.pipeline.campaign_finance_reader import Release

#: The committee's own filing itemizes the same money out we hold.
AGREES = Status.agrees.value
#: The 2 official figures differ. Show both and say they do not agree.
DISAGREES = Status.disagrees.value
#: We hold no copy of this committee-year's report document, so the comparison could not
#: be made. Minnesota's gap, not ours, and not a pass.
NOT_CHECKED = Status.not_checked.value
#: A document was read and our own reader could not prove itself against figures we
#: already trust. Ours, not Minnesota's. Never render this as a disagreement.
READER_UNPROVEN = Status.reader_unproven.value
#: Nobody has run the comparison over the payments currently published. A fact about us.
NOT_RUN = "not_run"


@dataclass(frozen=True)
class StatedSpending:
    """One committee-year's answer, with both official figures beside it.

    ``stated_itemized`` is what the committee's own filed report says it itemized paying
    out. ``ours_itemized`` is what the state's bulk download of itemized payments
    actually contains for the same period. They are 2 claims by the same state through 2
    different publications, and this type never reconciles them into one figure: rule 12
    of ``.claude/rules/grounded-answers.md`` requires both on the page.

    ``ours_itemized`` is ``0`` and never ``None`` for a committee-year we hold no rows
    for, because "the filing itemized money out and we hold nothing" is the sharpest case
    this exists for and an absent number would read as a year nobody looked at.

    ``cut_off_date`` is the period the stated figure runs to and must be shown with it: a
    figure covering January to July is not a year's money.

    ``reason`` is always populated, including on ``AGREES``, and is written for a
    developer. The reader-facing wording belongs to the page (rule 3: the data describes
    records, the layout owns the framing).
    """

    reg_num: str
    year: int
    status: str
    reason: str
    stated_itemized: Optional[Decimal] = None
    stated_itemized_paid: Optional[Decimal] = None
    ours_itemized: Optional[Decimal] = None
    stated_non_itemized: Optional[Decimal] = None
    cut_off_date: Optional[date] = None
    report_type: Optional[str] = None
    amendment_index: Optional[int] = None
    self_test: Optional[str] = None
    checked_at: Optional[datetime] = None

    @property
    def difference(self) -> Optional[Decimal]:
        """The filing's figure minus ours. Positive means we are missing money."""
        if self.stated_itemized is None or self.ours_itemized is None:
            return None
        return self.stated_itemized - self.ours_itemized

    @property
    def figures_agree(self) -> bool:
        """Whether the committee's 2 official money-out figures match.

        Only an outright agreement clears it. ``not_checked`` deliberately does **not**:
        what a page then does is a display ruling that belongs to the page, so it reads
        ``status`` and decides for itself rather than having this property decide.
        """
        return self.status == AGREES


_SQL = """
SELECT registration_number, filing_year, status, reason, stated_itemized,
       stated_itemized_paid, ours_itemized, stated_non_itemized, cut_off_date,
       report_type, amendment_index, self_test, checked_at
  FROM cf_stated_spending
 WHERE snapshot_id = :snapshot
   AND registration_number = :reg_num
"""


def stated_spending(
    db: Session,
    release: Release,
    reg_num: str,
    years: Optional[Iterable[int]] = None,
) -> list[StatedSpending]:
    """Every stored answer for one committee, newest year last.

    Scoped to the release's own expenditures snapshot, so an answer about payments that
    have since been replaced is never returned. A year with no stored answer is simply
    absent; use ``stated_spending_for_year`` when a page needs one year and needs the
    difference between "no answer" and "a clean answer" spelled out.
    """
    wanted = {int(year) for year in years} if years is not None else None
    rows = db.execute(
        text(_SQL),
        {"snapshot": release.expenditures.snapshot_id, "reg_num": reg_num},
    ).all()
    found = [
        StatedSpending(
            reg_num=row[0],
            year=int(row[1]),
            status=_status_value(row[2]),
            reason=row[3],
            stated_itemized=row[4],
            stated_itemized_paid=row[5],
            ours_itemized=row[6],
            stated_non_itemized=row[7],
            cut_off_date=row[8],
            report_type=row[9],
            amendment_index=row[10],
            self_test=row[11],
            checked_at=row[12],
        )
        for row in rows
        if wanted is None or int(row[1]) in wanted
    ]
    return sorted(found, key=lambda entry: entry.year)


def stated_spending_for_year(
    db: Session, release: Release, reg_num: str, year: int
) -> StatedSpending:
    """One committee-year's answer, with ``NOT_RUN`` rather than nothing when absent.

    A page always gets an object, because the alternative is a caller treating ``None``
    as a clean result. "Nobody has compared this committee's payments out against its own
    filing" is a real state with its own sentence, and it is a fact about us.
    """
    for entry in stated_spending(db, release, reg_num, years=[year]):
        return entry
    return StatedSpending(
        reg_num=reg_num,
        year=year,
        status=NOT_RUN,
        reason=(
            "nobody has compared this committee's payments out against its own filed "
            "report for this year, so we do not know whether the 2 agree"
        ),
    )


def committee_years_whose_spending_disagrees(
    db: Session, release: Release
) -> frozenset[tuple[str, int]]:
    """Every committee-year of this release whose 2 official money-out figures differ.

    For a caller sweeping a list rather than drawing one committee, so it costs one
    statement instead of one per row.
    """
    rows = db.execute(
        text(
            "SELECT registration_number, filing_year FROM cf_stated_spending "
            " WHERE snapshot_id = :snapshot AND status = 'disagrees'"
        ),
        {"snapshot": release.expenditures.snapshot_id},
    ).all()
    return frozenset((registration, int(year)) for registration, year in rows)


def _status_value(status) -> str:
    return status.value if isinstance(status, Status) else str(status)
