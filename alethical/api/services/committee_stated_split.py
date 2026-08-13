"""Whether a committee-year's own filing agrees with the payments we hold (#1433).

Net: a money page works out "how much of this committee's money came from donors too
small to name" by subtracting the payments we hold from the committee's official total.
So a payment we are **missing** does not go missing on the page. It moves into that
figure and reads as ordinary small-donor money, which is a false claim about donations
Minnesota itself named, under a real politician's name. This module is how a page finds
out, before it draws anything.

**It answers per committee-year and never for a whole release.** Eugene ruled on 12 Aug
2026 that where 2 of Minnesota's own publications disagree and we cannot derive the
truth, we show both figures and say plainly that they disagree. So a committee whose
figures contradict each other withholds its own split while every other committee's page
draws normally ([#1329](https://github.com/alethical-org/alethical/issues/1329)).

**4 answers, and the last 2 are both "no verdict" for reasons that must never be
collapsed.** ``not_checked`` is Minnesota's gap: the Board serves no report document
before 2023, serves none for several report kinds inside the years it does cover, and
answers HTTP 200 to every one of those refusals. ``reader_unproven`` is ours: a document
was served and our own reader disagreed with figures we already trust, so the reader is
wrong and no claim is made about the data at all. Rendering them the same would let a
broken reader of ours accuse a named politician's filing of contradicting itself.

**Read, never computed here.** The answer costs a request to the Board and a document to
read, so it is produced by ``scripts/check_campaign_finance_stated_split.py`` and stored.
A committee-year with no stored answer is ``NOT_RUN`` -- a fact about us, and not a
verdict about the committee.

Keyed on the registration number, matching ``committee_finance.py`` and
``committee_filing_schedule.py``: Minnesota identifies a campaign committee by a number
and never says whose it is, so this needs none of
[#1354](https://github.com/alethical-org/alethical/issues/1354)'s human confirmations to
be correct.

Design: ``docs/architecture/campaign-finance-system-design.md`` §9.4 (Report PDFs are a
fallback, not a route).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Iterable, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from alethical.db.models import CampaignFinanceStatedSplitStatus as Status
from alethical.pipeline.campaign_finance_reader import Release

#: The committee's own filing states the same itemized figure we hold. A page may draw
#: the split.
AGREES = Status.agrees.value
#: The 2 official figures differ. No split, no composition bar: show both and say they
#: do not agree.
DISAGREES = Status.disagrees.value
#: The Board serves no document for this committee-year, so the comparison could not be
#: made. Minnesota's gap, not ours, and not a pass.
NOT_CHECKED = Status.not_checked.value
#: A document was read and our own reader could not prove itself against figures we
#: already trust. Ours, not Minnesota's. Never render this as a disagreement.
READER_UNPROVEN = Status.reader_unproven.value
#: Nobody has run the comparison over the payments currently published. A fact about us.
NOT_RUN = "not_run"


@dataclass(frozen=True)
class StatedSplit:
    """One committee-year's answer, with both official figures beside it.

    ``stated_itemized`` is what the committee's own filed report says it named donors
    for. ``ours_itemized`` is what the state's bulk download of named payments actually
    contains for the same period. They are 2 claims by the same state through 2 different
    publications, and this type never reconciles them into one figure: rule 12 of
    ``.claude/rules/grounded-answers.md`` requires both on the page.

    ``ours_itemized`` is ``0`` and never ``None`` for a committee-year we hold no rows
    for, because "the filing named $2,300.00 and we hold nothing" is the sharpest case
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
    def may_show_a_split(self) -> bool:
        """Whether a page may divide this committee's money into named and unnamed.

        Only an outright agreement clears it. ``not_checked`` deliberately does **not**:
        that is a display ruling and it belongs to
        [#1329](https://github.com/alethical-org/alethical/issues/1329), so a page that
        wants the other treatment reads ``status`` and decides for itself rather than
        having this property decide for it.
        """
        return self.status == AGREES


_SQL = """
SELECT registration_number, filing_year, status, reason, stated_itemized,
       ours_itemized, stated_non_itemized, cut_off_date, report_type,
       amendment_index, self_test, checked_at
  FROM cf_stated_split
 WHERE snapshot_id = :snapshot
   AND registration_number = :reg_num
"""


def stated_split(
    db: Session,
    release: Release,
    reg_num: str,
    years: Optional[Iterable[int]] = None,
) -> list[StatedSplit]:
    """Every stored answer for one committee, newest year last.

    Scoped to the release's own contributions snapshot, so an answer about payments that
    have since been replaced is never returned. A year with no stored answer is simply
    absent; use ``stated_split_for_year`` when a page needs one year and needs the
    difference between "no answer" and "a clean answer" spelled out.
    """
    wanted = {int(year) for year in years} if years is not None else None
    rows = db.execute(
        text(_SQL),
        {"snapshot": release.contributions.snapshot_id, "reg_num": reg_num},
    ).all()
    found = [
        StatedSplit(
            reg_num=row[0],
            year=int(row[1]),
            status=_status_value(row[2]),
            reason=row[3],
            stated_itemized=row[4],
            ours_itemized=row[5],
            stated_non_itemized=row[6],
            cut_off_date=row[7],
            report_type=row[8],
            amendment_index=row[9],
            self_test=row[10],
            checked_at=row[11],
        )
        for row in rows
        if wanted is None or int(row[1]) in wanted
    ]
    return sorted(found, key=lambda entry: entry.year)


def stated_split_for_year(
    db: Session, release: Release, reg_num: str, year: int
) -> StatedSplit:
    """One committee-year's answer, with ``NOT_RUN`` rather than nothing when absent.

    A page always gets an object, because the alternative is a caller treating ``None``
    as a clean result. "Nobody has compared this committee against its own filing" is a
    real state with its own sentence, and it is a fact about us.
    """
    for entry in stated_split(db, release, reg_num, years=[year]):
        return entry
    return StatedSplit(
        reg_num=reg_num,
        year=year,
        status=NOT_RUN,
        reason=(
            "nobody has compared this committee's payments against its own filed "
            "report for this year, so we do not know whether the 2 agree"
        ),
    )


def committee_years_that_must_not_show_a_split(
    db: Session, release: Release
) -> frozenset[tuple[str, int]]:
    """Every committee-year of this release whose 2 official figures disagree.

    For a caller sweeping a list rather than drawing one committee -- a search result, a
    party's caucus roll-up -- so it costs one statement instead of one per row.

    Deliberately only ``disagrees``. The other refusal a page has to make comes from
    ``campaign_finance_reader.filer_years_that_must_not_show_a_split``, which catches the
    opposite direction: our rows exceeding the committee's own reported total. Both are
    real, they are caught by different evidence, and a page needs both.
    """
    rows = db.execute(
        text(
            "SELECT registration_number, filing_year FROM cf_stated_split "
            " WHERE snapshot_id = :snapshot AND status = 'disagrees'"
        ),
        {"snapshot": release.contributions.snapshot_id},
    ).all()
    return frozenset((registration, int(year)) for registration, year in rows)


def _status_value(status) -> str:
    return status.value if isinstance(status, Status) else str(status)
