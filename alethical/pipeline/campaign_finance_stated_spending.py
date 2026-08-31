"""Compare each filing's own stated money out against the payments we hold (#1645).

Net: the money coming **in** to every committee has been checked against the committee's
own filed report since #1433, and 4 separate ways Minnesota's download disagrees with
Minnesota's own filing were found that way. **The money going out had never been
checked** for any committee in any year until 31 August 2026, and that run's 3,643
answers lived only in its terminal output. This module is the same check, made durable
and re-runnable, so a committee's spending figure stops being unverified.

**It asks the Board for nothing.** The money-in check fetches a document per
committee-year, roughly 1,300 requests. #1501's keeper already stored every document
those sweeps read, so this reads them back out of our own store instead. That is not
only politeness: §9.4 measured that the Board serves a document for only about 1 report
in 4 and never promised the route exists, so the copy we took is the reliable one.

**Independent expenditures are a different file, and this is the rule everything else
depends on.** Minnesota publishes what a committee spent for or against someone as its
own download, and the Board's own report summary gives it its own line. A comparison
that looks for those payments in ``cf_expenditure_row`` invents a shortfall wherever a
filer spends independently -- measured across 2024-2026 the 2 downloads share only 16
rows. Read the other way round, our independent-expenditure rows reconcile against the
filing's own independent schedules on 3,597 of 3,604 readable committee-years, which is
what makes the split a property of the source rather than a guess about it (§2.1).

**And the download's ``Amount`` is the schedule's total column, not its paid one.** A
money-out schedule prints paid, in-kind, unpaid and total; the Board's per-filer totals
route reports the paid column. Comparing our rows against the total column agrees on
3,356 of 3,604 readable committee-years and against the paid column on 2,842, so both
figures are read and the self-test runs on the one the route can prove.

**This is not a gate on a release.** Eugene ruled on 12 Aug 2026 that where 2 of
Minnesota's own publications disagree and we cannot derive the truth, we show both
figures and say plainly that they disagree. So this reports **per committee-year**, and
a committee-year that disagrees withholds its own figure while every other committee
publishes normally.

**And the reader proves itself before it may accuse anyone.** Each money-out line the
Board's totals route publishes equals its schedule's paid column, and the route's
``total_expenditures`` equals every money-out schedule's paid column together -- which
is the only thing that proves the schedules the route reports no line for at all, a
candidate committee's transfers to party units among them. A committee-year whose
self-test fails records ``reader_unproven``, which says our reader is wrong and makes no
claim about the data.

Design: ``docs/architecture/campaign-finance-system-design.md`` §9.9 (what has and has
not been reconciled) and §2.1 (what the download's columns mean).
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Callable, Iterable, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from alethical.db.models import CampaignFinanceFilerKind as FilerKind
from alethical.db.models import CampaignFinanceStatedSpendingStatus as Status
from alethical.pipeline import campaign_finance_reader as reader
from alethical.pipeline.campaign_finance_report_document_store import DocumentLibrary
from alethical.pipeline.campaign_finance_report_documents import (
    TOLERANCE,
    SelfTest,
    parse_report_document,
    stated_spending,
)
from alethical.pipeline.campaign_finance_stated_split import DOCUMENT_FIRST_YEAR


@dataclass
class Verdict:
    """One committee-year's answer, in the shape the table stores."""

    registration_number: str
    filing_year: int
    status: Status
    reason: str
    self_test: Optional[str] = None
    report_type: Optional[str] = None
    amendment_index: Optional[int] = None
    cut_off_date: Optional[date] = None
    document_hash: Optional[str] = None
    document_byte_size: Optional[int] = None
    stated_itemized: Optional[Decimal] = None
    stated_itemized_paid: Optional[Decimal] = None
    stated_non_itemized: Optional[Decimal] = None
    ours_itemized: Optional[Decimal] = None


@dataclass
class StatedSpendingRun:
    """What one pass over the stored documents found, and what it could not reach."""

    years: tuple[int, ...]
    started_at: datetime
    completed_at: Optional[datetime] = None
    verdicts: list[Verdict] = field(default_factory=list)
    documents_read: int = 0
    # Why each unreachable committee-year was unreachable, counted. Named separately
    # from the verdicts because "how much of the population can this check see" is the
    # honest headline and a total of `not_checked` hides which gap it is.
    not_checked_reasons: dict[str, int] = field(default_factory=dict)

    def counts(self) -> dict[str, int]:
        tally: dict[str, int] = {}
        for verdict in self.verdicts:
            tally[verdict.status.value] = tally.get(verdict.status.value, 0) + 1
        return tally

    def reader_accuracy(self) -> tuple[int, int]:
        """How often the reader agreed with figures we already trust, out of how many
        documents where that test could run at all."""
        tested = [
            verdict
            for verdict in self.verdicts
            if verdict.self_test in (SelfTest.passed.value, SelfTest.failed.value)
        ]
        agreed = [v for v in tested if v.self_test == SelfTest.passed.value]
        return len(agreed), len(tested)


# --- Which committee-years to check -------------------------------------------


@dataclass(frozen=True)
class Target:
    """One committee-year to check, and the document that speaks for it."""

    registration_number: str
    filing_year: int
    kind: Optional[FilerKind]
    report_type: Optional[str]
    amendment_index: Optional[int]
    cut_off_date: Optional[date]
    special_election: bool
    skip_reason: Optional[str] = None


# Every committee-year a page could show for these years, from all 3 places one can
# appear: the payments out we hold, the figures the Board reported, and the Board's own
# catalogue of filed reports. Deliberately the union rather than the intersection, for
# the reason the money-in check documents: the catalogue alone carries committee-years
# where the other 2 sources both say nothing and a filing itemizes real money.
#
# **The first source is the expenditures download, where the money-in check reads the
# contributions one**, so this population is not that one: a committee that spent money
# and received none belongs here and not there. On the live release the 2 populations
# are 4,124 and 3,968 committee-years for 2024-2026.
_POPULATION_CTE = """
WITH wanted AS (
    SELECT unnest(CAST(:years AS int[])) AS filing_year
), ours AS (
    SELECT committee_reg_num AS registration_number, year AS filing_year
      FROM cf_expenditure_row
     WHERE snapshot_id = :expenditures
       AND committee_reg_num IS NOT NULL
       AND year IS NOT NULL
       AND (:years IS NULL OR year IN (SELECT filing_year FROM wanted))
     GROUP BY 1, 2
), theirs AS (
    SELECT registration_number, filing_year
      FROM cf_filing
     WHERE snapshot_id = :filings
       AND (:years IS NULL OR filing_year IN (SELECT filing_year FROM wanted))
), catalogued AS (
    SELECT registration_number, filing_year
      FROM cf_filing_report
     WHERE snapshot_id = :filings
       AND (:years IS NULL OR filing_year IN (SELECT filing_year FROM wanted))
     GROUP BY 1, 2
), population AS (
    SELECT registration_number, filing_year FROM ours
    UNION
    SELECT registration_number, filing_year FROM theirs
    UNION
    SELECT registration_number, filing_year FROM catalogued
)
"""

_POPULATION_COUNT_SQL = _POPULATION_CTE + "SELECT count(*) FROM population"

_TARGETS_SQL = (
    _POPULATION_CTE
    + """
SELECT p.registration_number,
       p.filing_year,
       f.kind,
       chosen.report_type,
       chosen.effective_amendment_index,
       chosen.cut_off_date,
       COALESCE(special.present, false) AS special_election
  FROM population p
  LEFT JOIN cf_filer f
    ON f.snapshot_id = :filings AND f.registration_number = p.registration_number
  LEFT JOIN cf_filing filing
    ON filing.snapshot_id = :filings
   AND filing.registration_number = p.registration_number
   AND filing.filing_year = p.filing_year
  LEFT JOIN LATERAL (
      SELECT r.report_type, r.effective_amendment_index, r.cut_off_date
        FROM cf_filing_report r
       WHERE r.snapshot_id = :filings
         AND r.registration_number = p.registration_number
         AND r.filing_year = p.filing_year
         AND r.special_election IS FALSE
         AND (filing.reported_through IS NULL OR r.cut_off_date = filing.reported_through)
       ORDER BY r.cut_off_date DESC NULLS LAST
       LIMIT 1
  ) chosen ON true
  LEFT JOIN LATERAL (
      SELECT true AS present
        FROM cf_filing_report r
       WHERE r.snapshot_id = :filings
         AND r.registration_number = p.registration_number
         AND r.filing_year = p.filing_year
         AND r.special_election IS TRUE
       LIMIT 1
  ) special ON true
 ORDER BY p.registration_number, p.filing_year
"""
)


def targets(
    db: Session,
    release: reader.Release,
    filings_snapshot_id: uuid.UUID,
    years: Iterable[int],
) -> list[Target]:
    """Every committee-year to check, with the document that speaks for each.

    A target carrying a ``skip_reason`` is still returned rather than filtered out. The
    population this check *cannot* see is the honest half of its answer, and a filter
    would report a clean pass over whatever was left.
    """
    rows = db.execute(
        text(_TARGETS_SQL),
        {
            "years": list(years),
            "expenditures": release.expenditures.snapshot_id,
            "filings": filings_snapshot_id,
        },
    ).all()
    found: list[Target] = []
    for (
        registration_number,
        filing_year,
        kind,
        report_type,
        amendment_index,
        cut_off_date,
        special_election,
    ) in rows:
        found.append(
            Target(
                registration_number=registration_number,
                filing_year=int(filing_year),
                kind=_as_kind(kind),
                report_type=report_type,
                amendment_index=amendment_index,
                cut_off_date=cut_off_date,
                special_election=bool(special_election),
                skip_reason=_skip_reason(
                    filing_year=int(filing_year),
                    kind=kind,
                    report_type=report_type,
                    amendment_index=amendment_index,
                    cut_off_date=cut_off_date,
                    special_election=bool(special_election),
                ),
            )
        )
    return found


def _as_kind(value) -> Optional[FilerKind]:
    if value is None or isinstance(value, FilerKind):
        return value
    return FilerKind(value)


def _skip_reason(
    *,
    filing_year: int,
    kind,
    report_type: Optional[str],
    amendment_index: Optional[int],
    cut_off_date: Optional[date],
    special_election: bool,
) -> Optional[str]:
    """Why this committee-year cannot be checked, in words an operator can act on."""
    if filing_year < DOCUMENT_FIRST_YEAR:
        return (
            f"the Board serves no report document for {filing_year}; the boundary is "
            f"{DOCUMENT_FIRST_YEAR} and its absence in an older year means the "
            "document is unavailable, never that the filing was never amended"
        )
    if kind is None:
        return (
            "this registration number is in no filer list the Board publishes, so "
            "there is no filer kind to read the money-out schedules by"
        )
    if special_election:
        return (
            "this committee filed a special-election report series for this year. "
            "That series covers part of the year and the regular one covers the rest, "
            "and assembling the pair is not built, so comparing either alone would "
            "invent a gap (§9.5)"
        )
    if report_type is None:
        return (
            "the Board's own catalogue lists no regular report covering the period "
            "its figures run to, so there is no document to read"
        )
    if amendment_index is None:
        return (
            f"the catalogue carries no amendment record for this {report_type} report, "
            "so we cannot say which version to read and reading the wrong one would "
            "compare against a superseded filing"
        )
    if cut_off_date is None:
        return (
            f"the catalogue serves no cut-off date for this {report_type} report, so "
            "our rows cannot be bounded to the period the filing covers. Assuming 31 "
            "December would compare a whole year against a filing that may end in July "
            "and call the difference a gap"
        )
    return None


# --- What we hold ---------------------------------------------------------------

_OURS_SQL = """
SELECT COALESCE(SUM(amount), 0) AS total,
       COUNT(*) AS rows_held
  FROM cf_expenditure_row
 WHERE snapshot_id = :expenditures
   AND committee_reg_num = :registration_number
   AND year = :filing_year
   AND (transaction_date IS NULL OR transaction_date <= :cut_off_date)
"""


def ours_spent(
    db: Session,
    release: reader.Release,
    registration_number: str,
    filing_year: int,
    cut_off_date: date,
) -> tuple[Decimal, int]:
    """The payments out we hold for this committee-year, bounded by the filing's period.

    Three rules, each of which silently breaks the comparison when skipped (§2.1):

    * **No filter on ``type``.** The money-in twin filters to ``Contribution`` because
      the contributions file carries 3 receipt kinds that are not contributions. All 6
      values this file carries are money out, and each maps onto a money-out schedule
      the comparison already counts, so filtering here would drop a whole kind of
      payment -- 87 candidate-committee ``Other Disbursement`` rows worth $229,737.41
      among them.
    * The file's own ``Year`` column, never the year of a row's date, because a filing
      is scoped by ``Year``.
    * Bounded by the report's cut-off. A year-end report and the calendar year coincide;
      a mid-year one does not.

    An **undated** row is counted as inside the period, which is deliberately the
    direction that can cause a false disagreement: a false disagreement is loud and a
    missed one publishes a wrong figure quietly.
    """
    total, rows_held = db.execute(
        text(_OURS_SQL),
        {
            "expenditures": release.expenditures.snapshot_id,
            "registration_number": registration_number,
            "filing_year": filing_year,
            "cut_off_date": cut_off_date,
        },
    ).one()
    return Decimal(total), int(rows_held)


def stored_figures(
    db: Session,
    filings_snapshot_id: uuid.UUID,
    registration_number: str,
    filing_year: int,
) -> dict[str, Decimal]:
    """The money lines the Board's own totals route reported for this filer-year.

    These are what the reader is proved against. Empty is a real state and is not an
    error: the route serves no block at all for some filer-years whose catalogue lists a
    report and whose document itemizes real money.
    """
    rows = db.execute(
        text(
            "SELECT g.line_key, g.amount "
            "  FROM cf_filing f JOIN cf_filing_figure g ON g.filing_id = f.id "
            " WHERE f.snapshot_id = :filings "
            "   AND f.registration_number = :registration_number "
            "   AND f.filing_year = :filing_year"
        ),
        {
            "filings": filings_snapshot_id,
            "registration_number": registration_number,
            "filing_year": filing_year,
        },
    ).all()
    return {line_key: Decimal(amount) for line_key, amount in rows}


# --- One committee-year -------------------------------------------------------


def check_one(
    db: Session,
    library: DocumentLibrary,
    release: reader.Release,
    filings_snapshot_id: uuid.UUID,
    target: Target,
) -> tuple[Verdict, bool]:
    """Check one committee-year. Returns the verdict and whether a document was read."""
    base = dict(
        registration_number=target.registration_number,
        filing_year=target.filing_year,
        report_type=target.report_type,
        amendment_index=target.amendment_index,
        cut_off_date=target.cut_off_date,
    )
    if target.skip_reason is not None:
        return Verdict(
            status=Status.not_checked, reason=target.skip_reason, **base
        ), False
    assert target.kind is not None and target.cut_off_date is not None
    try:
        kept = library.body_for(
            registration_number=target.registration_number,
            filing_year=target.filing_year,
            report_type=target.report_type,
            amendment_index=target.amendment_index,
        )
    except Exception as error:  # noqa: BLE001 - recorded, never allowed to end the run
        # A store that cannot hand back the bytes it vouches for is a fact about us and
        # is recorded as one. Raising here would throw away every verdict already
        # reached in a 13-minute sweep over one unreadable object.
        return (
            Verdict(
                status=Status.not_checked,
                reason=(
                    "the kept document for this filing could not be read back out of "
                    f"our own store: {error}"
                ),
                **base,
            ),
            False,
        )
    if kept is None:
        return (
            Verdict(
                status=Status.not_checked,
                reason=(
                    "we hold no copy of this filing's report document, so there is "
                    "nothing to read. The Board serves a document for only about 1 "
                    "report in 4 (§9.4), so this is Minnesota's gap rather than ours, "
                    "and it is not a pass"
                ),
                **base,
            ),
            False,
        )
    base["document_hash"] = kept.document_hash
    base["document_byte_size"] = kept.byte_size
    document = parse_report_document(kept.body)
    figures = stored_figures(
        db, filings_snapshot_id, target.registration_number, target.filing_year
    )
    stated, errors = stated_spending(document, target.kind, figures)
    if stated is None:
        return (
            Verdict(
                status=Status.reader_unproven,
                reason="this reader could not read the document it holds: "
                + "; ".join(errors),
                self_test=SelfTest.failed.value,
                **base,
            ),
            True,
        )
    if stated.self_test is SelfTest.failed:
        return (
            Verdict(
                status=Status.reader_unproven,
                reason="this reader disagrees with the Board's own totals route, so "
                "the reader is wrong and no claim is made about the data: "
                + stated.self_test_detail,
                self_test=stated.self_test.value,
                stated_itemized=stated.itemized,
                stated_itemized_paid=stated.itemized_paid,
                stated_non_itemized=stated.non_itemized,
                **base,
            ),
            True,
        )
    held, rows_held = ours_spent(
        db,
        release,
        target.registration_number,
        target.filing_year,
        target.cut_off_date,
    )
    difference = stated.itemized - held
    verdict = Verdict(
        status=Status.agrees if abs(difference) <= TOLERANCE else Status.disagrees,
        reason=_comparison_reason(
            stated=stated.itemized,
            stated_paid=stated.itemized_paid,
            independent=stated.independent_itemized,
            held=held,
            rows_held=rows_held,
            difference=difference,
            self_test=stated.self_test,
            self_test_detail=stated.self_test_detail,
            cut_off=target.cut_off_date,
        ),
        self_test=stated.self_test.value,
        stated_itemized=stated.itemized,
        stated_itemized_paid=stated.itemized_paid,
        stated_non_itemized=stated.non_itemized,
        ours_itemized=held,
        **base,
    )
    return verdict, True


def _comparison_reason(
    *,
    stated: Decimal,
    stated_paid: Decimal,
    independent: Decimal,
    held: Decimal,
    rows_held: int,
    difference: Decimal,
    self_test: SelfTest,
    self_test_detail: str,
    cut_off: date,
) -> str:
    independent_note = ""
    if independent:
        # Said out loud on every row that has any, agreeing or not. The single largest
        # misreading this check can produce is counting this money on our side, where it
        # cannot be, so a person auditing a row must see that it exists and was left out
        # rather than discovering later that it was never mentioned.
        independent_note = (
            f" The filing also itemizes {independent} of independent expenditures, "
            "which Minnesota publishes in a separate download and which is excluded "
            "from both figures above."
        )
    if abs(difference) <= TOLERANCE:
        return (
            f"the filing states {stated} of itemized money out through {cut_off} and we "
            f"hold {rows_held:,} rows totalling {held}."
            + independent_note
            + f" Reader check: {self_test_detail}"
        )
    direction = "more than" if difference > 0 else "less than"
    missing = (
        "we hold no rows at all for this committee-year, so a page would show this "
        "committee as having spent nothing while its own filing itemizes money"
        if rows_held == 0
        else f"we hold {rows_held:,} rows totalling {held}"
    )
    paid_note = ""
    if stated_paid != stated:
        paid_note = (
            f" Of the filing's figure, {stated_paid} is the paid column and "
            f"{stated - stated_paid} is in-kind and unpaid together."
        )
    unproven = ""
    if self_test is SelfTest.not_available:
        unproven = (
            " This reading could not be proved against an already-trusted figure for "
            "this committee-year, because the Board's totals route reports none: "
            + self_test_detail
        )
    return (
        f"the filing states {stated} of itemized money out through {cut_off}, which is "
        f"{abs(difference)} {direction} what we hold; {missing}."
        + paid_note
        + independent_note
        + unproven
    )


# --- The run ------------------------------------------------------------------


def run_stated_spending_check(
    db: Session,
    library: DocumentLibrary,
    *,
    years: Iterable[int],
    only_filers: Optional[Iterable[str]] = None,
    write: bool = True,
    progress: Optional[Callable[[str], None]] = None,
) -> StatedSpendingRun:
    """Check every committee-year a page could show for these years.

    **Every one, not a sample.** The failure this guards against is one committee at a
    time, so a sample sized for a random failure rate is the wrong instrument and only
    checking a committee catches that committee.

    Reads about 3,600 documents out of our own store, which takes roughly 13 minutes and
    costs the Board nothing.
    """
    years = sorted({int(year) for year in years})
    run = StatedSpendingRun(years=tuple(years), started_at=datetime.now(UTC))
    release = reader.live_release(db)
    if release is None:
        raise RuntimeError(
            "no campaign-finance release is published, so there are no payment rows to "
            "compare a filing against. Run scripts/load_campaign_finance.py first."
        )
    snapshot = _live_filings_snapshot_id(db)
    if snapshot is None:
        raise RuntimeError(
            "no filings snapshot is published, so there is no report catalogue naming "
            "which document speaks for a committee-year, and nothing already trusted "
            "to prove this reader against. Run "
            "scripts/load_campaign_finance_filings.py first."
        )
    # Checked here rather than discovered at the end, for the reason the money-in check
    # learned the hard way: the first write is the last thing this does, so a missing
    # table threw a whole run away.
    if write and not _table_exists(db, "cf_stated_spending"):
        raise RuntimeError(
            "this database has no cf_stated_spending table to write answers into, so a "
            "13-minute run would be thrown away at its last step. Apply the migrations "
            "(alembic upgrade head), or pass --dry-run to report without writing."
        )
    if not _table_exists(db, "cf_report_document"):
        raise RuntimeError(
            "this database has no cf_report_document table, so there are no stored "
            "documents to read and every committee-year would record as not checked. "
            "Apply the migrations (alembic upgrade head)."
        )
    wanted = {str(filer) for filer in only_filers} if only_filers else None
    population = [
        target
        for target in targets(db, release, snapshot, years)
        if wanted is None or target.registration_number in wanted
    ]
    if progress:
        progress(
            f"{len(population):,} committee-years to check across "
            f"{', '.join(str(year) for year in years)}"
        )
    for index, target in enumerate(population, start=1):
        verdict, read_one = check_one(db, library, release, snapshot, target)
        run.verdicts.append(verdict)
        if verdict.status is Status.not_checked:
            key = verdict.reason.split(";")[0][:60]
            run.not_checked_reasons[key] = run.not_checked_reasons.get(key, 0) + 1
        if read_one:
            run.documents_read += 1
        if progress and index % 100 == 0:
            progress(f"  {index:,} of {len(population):,}")
    run.completed_at = datetime.now(UTC)
    if write:
        store_verdicts(db, release.expenditures.snapshot_id, snapshot, run.verdicts)
    return run


def _live_filings_snapshot_id(db: Session) -> Optional[uuid.UUID]:
    return db.execute(
        text("SELECT snapshot_id FROM cf_filing_current WHERE id = true")
    ).scalar()


def _table_exists(db: Session, table_name: str) -> bool:
    return bool(
        db.execute(
            text("SELECT to_regclass(:table_name)"), {"table_name": table_name}
        ).scalar()
    )


def store_verdicts(
    db: Session,
    expenditures_snapshot_id: uuid.UUID,
    filings_snapshot_id: uuid.UUID,
    verdicts: Iterable[Verdict],
) -> int:
    """Write this run's verdicts, replacing any earlier ones for the same rows.

    Replaced rather than appended because a verdict is a statement about the payments
    published *now*. Two verdicts for one committee-year would leave a page choosing
    between them, and the older one is always the wrong choice.
    """
    written = 0
    for verdict in verdicts:
        db.execute(
            text(
                "INSERT INTO cf_stated_spending ("
                "  snapshot_id, registration_number, filing_year, filings_snapshot_id,"
                "  status, reason, self_test, report_type, amendment_index,"
                "  cut_off_date, document_hash, document_byte_size, stated_itemized,"
                "  stated_itemized_paid, stated_non_itemized, ours_itemized, checked_at"
                ") VALUES ("
                "  :snapshot_id, :registration_number, :filing_year,"
                "  :filings_snapshot_id, :status, :reason, :self_test, :report_type,"
                "  :amendment_index, :cut_off_date, :document_hash,"
                "  :document_byte_size, :stated_itemized, :stated_itemized_paid,"
                "  :stated_non_itemized, :ours_itemized, :checked_at"
                ") ON CONFLICT (snapshot_id, registration_number, filing_year) "
                "DO UPDATE SET"
                "  filings_snapshot_id = EXCLUDED.filings_snapshot_id,"
                "  status = EXCLUDED.status, reason = EXCLUDED.reason,"
                "  self_test = EXCLUDED.self_test,"
                "  report_type = EXCLUDED.report_type,"
                "  amendment_index = EXCLUDED.amendment_index,"
                "  cut_off_date = EXCLUDED.cut_off_date,"
                "  document_hash = EXCLUDED.document_hash,"
                "  document_byte_size = EXCLUDED.document_byte_size,"
                "  stated_itemized = EXCLUDED.stated_itemized,"
                "  stated_itemized_paid = EXCLUDED.stated_itemized_paid,"
                "  stated_non_itemized = EXCLUDED.stated_non_itemized,"
                "  ours_itemized = EXCLUDED.ours_itemized,"
                "  checked_at = EXCLUDED.checked_at"
            ),
            {
                "snapshot_id": expenditures_snapshot_id,
                "registration_number": verdict.registration_number,
                "filing_year": verdict.filing_year,
                "filings_snapshot_id": filings_snapshot_id,
                "status": verdict.status.value,
                "reason": verdict.reason,
                "self_test": verdict.self_test,
                "report_type": verdict.report_type,
                "amendment_index": verdict.amendment_index,
                "cut_off_date": verdict.cut_off_date,
                "document_hash": verdict.document_hash,
                "document_byte_size": verdict.document_byte_size,
                "stated_itemized": verdict.stated_itemized,
                "stated_itemized_paid": verdict.stated_itemized_paid,
                "stated_non_itemized": verdict.stated_non_itemized,
                "ours_itemized": verdict.ours_itemized,
                "checked_at": datetime.now(UTC),
            },
        )
        written += 1
    db.commit()
    return written


# --- How much of the population carries an answer -----------------------------


@dataclass(frozen=True)
class StatedSpendingCoverage:
    """This release's stored verdicts, measured against the population they should cover.

    ``population`` is the whole set of committee-years this release *could* be checked
    for, across every year, and it is the reason this type exists rather than a bare
    count of rows. **A verdict count alone cannot tell a clean sweep from a scoped run**
    -- check one committee with ``--only-filers``, have it agree, and a coverage built
    from stored rows reports 1 of 1 agreeing.

    ``None`` for ``population`` means it could not be established, which is not zero and
    must never read as a full sweep.
    """

    checked_at: Optional[datetime]
    agrees: int
    disagrees: int
    not_checked: int
    reader_unproven: int
    population: Optional[int] = None

    @property
    def total(self) -> int:
        """How many committee-years carry a verdict of any kind."""
        return self.agrees + self.disagrees + self.not_checked + self.reader_unproven

    @property
    def without_a_verdict(self) -> Optional[int]:
        """How many of the population nobody has looked at, or None when unknown."""
        if self.population is None:
            return None
        return max(self.population - self.total, 0)


def stated_spending_coverage(
    db: Session, expenditures_snapshot_id: uuid.UUID
) -> Optional[StatedSpendingCoverage]:
    """Every stored verdict for one published set of payments, or None when none exist.

    ``None`` is a real and ordinary state: this check is a separate pass, so a freshly
    loaded download has no verdicts until someone runs it.
    """
    rows = db.execute(
        text(
            "SELECT status, count(*), max(checked_at) FROM cf_stated_spending "
            " WHERE snapshot_id = :snapshot GROUP BY status"
        ),
        {"snapshot": expenditures_snapshot_id},
    ).all()
    if not rows:
        return None
    counts = {str(_status_value(status)): int(count) for status, count, _ in rows}
    return StatedSpendingCoverage(
        population=population_size(db, expenditures_snapshot_id),
        checked_at=max(checked_at for _, _, checked_at in rows),
        agrees=counts.get(Status.agrees.value, 0),
        disagrees=counts.get(Status.disagrees.value, 0),
        not_checked=counts.get(Status.not_checked.value, 0),
        reader_unproven=counts.get(Status.reader_unproven.value, 0),
    )


def population_size(db: Session, expenditures_snapshot_id: uuid.UUID) -> Optional[int]:
    """How many committee-years this release could be checked for, across every year.

    ``None`` when no filings snapshot is published, because 2 of the 3 sources that
    define the population live in it. Unknown is not zero.
    """
    filings = _live_filings_snapshot_id(db)
    if filings is None:
        return None
    return int(
        db.execute(
            text(_POPULATION_COUNT_SQL),
            {
                "years": None,
                "expenditures": expenditures_snapshot_id,
                "filings": filings,
            },
        ).scalar()
        or 0
    )


def _status_value(status) -> str:
    return status.value if isinstance(status, Status) else str(status)


__all__ = [
    "StatedSpendingCoverage",
    "StatedSpendingRun",
    "Target",
    "Verdict",
    "check_one",
    "ours_spent",
    "population_size",
    "run_stated_spending_check",
    "stated_spending_coverage",
    "store_verdicts",
    "targets",
]
