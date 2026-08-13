"""Compare each filing's own stated itemized split against the payments we hold (#1433).

Net: the other reconciliation catches our payment rows being **too big** for a
committee's reported total. Nothing catches them being **too few**, because a shortfall
still fits inside the total, and the missing money lands in the derived "no donor named"
figure where it reads as ordinary small-donor money under a real politician's name. The
only record that can see it is the filing's own statement of how much it itemized, and
that statement lives nowhere but inside the report document.

**This is not a gate on a release.** Eugene ruled on 12 Aug 2026 that where 2 of
Minnesota's own publications disagree and we cannot derive the truth, we show both
figures and say plainly that they disagree. So this reports **per committee-year**, and a
committee-year that disagrees withholds its own split while every other committee
publishes normally ([#1329](https://github.com/alethical-org/alethical/issues/1329)). A
million verified payments must not be withheld because 1 committee's figures contradict
each other.

**What it can and cannot cover, stated up front rather than discovered later.** The
Board serves no report document before 2023, serves none for several report kinds inside
the years it does cover, and answers HTTP 200 to every one of those refusals (§9.4). So a
committee-year the route cannot reach is recorded as **not checked**, never as passed —
which is what `docs/architecture/campaign-finance-system-design.md` §9.9 exists to
enforce.

**And the reader proves itself before it may accuse anyone.** Each contributor-type line
the Board's totals route returns equals its `Schedule A1 - <code>` block's itemized plus
non-itemized cash, so the parser's own figures are checked against figures we already
trust. When they disagree the parser is wrong and this records ``reader_unproven``, which
is a different fact from the data disagreeing and must never be rendered as one. §9.4
records 3 parser bugs caught exactly this way, one of which returned zero rows for all 4
filers -- which looks like the data being absent rather than like a bug.

Design: ``docs/architecture/campaign-finance-system-design.md`` §9.4 (Report PDFs are a
fallback, not a route) and §9.5 (the non-itemized figure).
"""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Callable, Iterable, Optional

import requests
from sqlalchemy import text
from sqlalchemy.orm import Session

from alethical.db.models import CampaignFinanceFilerKind as FilerKind
from alethical.db.models import CampaignFinanceStatedSplitStatus as Status
from alethical.pipeline import campaign_finance_reader as reader
from alethical.pipeline.campaign_finance_filings import (
    BOARD_BASE_URL,
    REQUEST_SPACING_SECONDS,
    http_session,
)
from alethical.pipeline.campaign_finance_report_documents import (
    TOLERANCE,
    DocumentOutcome,
    SelfTest,
    fetch_document,
    parse_report_document,
    stated_contributions,
)

# The Board serves no report document before this filing year. Walking year-end reports
# back one year at a time on 2 filers put the boundary here, and a 110-report sample
# returned 0 of 69 for 2022 and earlier (§9.4). A committee-year below it is recorded as
# not checked with that reason, because "we could not look" must never read as "we
# looked and it was fine".
DOCUMENT_FIRST_YEAR = 2023

# The receipt type that is actually a contribution. 1.2% of the rows in the file named
# for itemized contributions are Miscellaneous, Miscellaneous Income or Loan Payable,
# and the filing reports each of those on its own schedule. Comparing without this
# filter made 19 of 202 legislator-years disagree where 3 really do (§2.1), and it is
# 6.57% of party-unit rows against 0.36% of candidate-committee ones.
CONTRIBUTION_RECEIPT_TYPE = "Contribution"


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
    stated_itemized_cash: Optional[Decimal] = None
    stated_non_itemized: Optional[Decimal] = None
    ours_itemized: Optional[Decimal] = None
    ours_itemized_cash: Optional[Decimal] = None


@dataclass
class StatedSplitRun:
    """What one pass over a year's committees found, and what it could not reach."""

    years: tuple[int, ...]
    started_at: datetime
    completed_at: Optional[datetime] = None
    verdicts: list[Verdict] = field(default_factory=list)
    requests_made: int = 0
    # Why each unreachable committee-year was unreachable, counted. Named separately
    # from the verdicts because "how much of the population can this check see" is the
    # honest headline and a total of `not_checked` hides which gap it is.
    not_checked_reasons: dict[str, int] = field(default_factory=dict)
    outcomes: dict[str, int] = field(default_factory=dict)

    def counts(self) -> dict[str, int]:
        tally: dict[str, int] = {}
        for verdict in self.verdicts:
            tally[verdict.status.value] = tally.get(verdict.status.value, 0) + 1
        return tally

    def reader_accuracy(self) -> tuple[int, int]:
        """How often the reader agreed with figures we already trust, out of how many
        documents where that test could run at all.

        This is the measured number §9.4 asks for before the reader may block anything,
        and it is the only honest weight to put on a committee-year whose own self-test
        could not run.
        """
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
    kind: FilerKind
    report_type: Optional[str]
    amendment_index: Optional[int]
    cut_off_date: Optional[date]
    special_election: bool
    has_reported_figures: bool
    skip_reason: Optional[str] = None


# Every committee-year a page could show for these years, from all 3 places one can
# appear: the payments we hold, the figures the Board reported, and the Board's own
# catalogue of filed reports. Deliberately the union rather than the intersection.
#
# **The third source is not redundant, and leaving it out drops the sharpest case there
# is.** Filer 18488 has no 2025 payment rows and the Board's totals route serves no 2025
# block for it either, so the first two sources both say nothing -- while its catalogue
# lists a 2025 year-end report whose document itemizes $2,300.00. A union of the first
# two returned 4 committee-years for the 5 filers of #1386 and silently omitted that one.
#
# The effective document is the catalogue report whose cut-off matches the figure's own
# coverage end. Measured on the live snapshot 13 Aug 2026: **3,630 of 3,630 filings
# resolve to exactly one report that way**, which settles §9.4's warning that the totals
# route lags the catalogue -- filer 18336's 2026 figures run through 31 March while its
# catalogue lists reports cut off 31 May and 20 July, and picking the newest catalogued
# report would compare against a period the stored figure does not cover.
_TARGETS_SQL = """
WITH wanted AS (
    SELECT unnest(CAST(:years AS int[])) AS filing_year
), ours AS (
    SELECT recipient_reg_num AS registration_number, year AS filing_year
      FROM cf_contribution_row
     WHERE snapshot_id = :contributions
       AND recipient_reg_num IS NOT NULL
       AND year IN (SELECT filing_year FROM wanted)
       AND receipt_type = :contribution
     GROUP BY 1, 2
), theirs AS (
    SELECT registration_number, filing_year
      FROM cf_filing
     WHERE snapshot_id = :filings
       AND filing_year IN (SELECT filing_year FROM wanted)
), catalogued AS (
    SELECT registration_number, filing_year
      FROM cf_filing_report
     WHERE snapshot_id = :filings
       AND filing_year IN (SELECT filing_year FROM wanted)
     GROUP BY 1, 2
), population AS (
    SELECT registration_number, filing_year FROM ours
    UNION
    SELECT registration_number, filing_year FROM theirs
    UNION
    SELECT registration_number, filing_year FROM catalogued
)
SELECT p.registration_number,
       p.filing_year,
       f.kind,
       chosen.report_type,
       chosen.effective_amendment_index,
       chosen.cut_off_date,
       COALESCE(special.present, false) AS special_election,
       (filing.registration_number IS NOT NULL) AS has_reported_figures
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
            "contributions": release.contributions.snapshot_id,
            "filings": filings_snapshot_id,
            "contribution": CONTRIBUTION_RECEIPT_TYPE,
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
        has_reported_figures,
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
                has_reported_figures=bool(has_reported_figures),
                skip_reason=_skip_reason(
                    filing_year=int(filing_year),
                    kind=kind,
                    report_type=report_type,
                    amendment_index=amendment_index,
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
            "there is no filer kind to build a document request from"
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
            "its figures run to, so there is no document to ask for"
        )
    if amendment_index is None:
        return (
            f"the catalogue carries no amendment record for this {report_type} report, "
            "so we cannot ask for a specific version and asking for the wrong one "
            "would compare against a superseded filing"
        )
    return None


# --- What we hold ---------------------------------------------------------------

_OURS_SQL = """
SELECT COALESCE(SUM(amount), 0) AS total,
       COALESCE(SUM(amount) FILTER (
           WHERE lower(COALESCE(in_kind, '')) <> 'yes'), 0) AS cash,
       COUNT(*) AS rows_held
  FROM cf_contribution_row
 WHERE snapshot_id = :contributions
   AND recipient_reg_num = :registration_number
   AND year = :filing_year
   AND receipt_type = :contribution
   AND (receipt_date IS NULL OR receipt_date <= :cut_off_date)
"""


def ours_itemized(
    db: Session,
    release: reader.Release,
    registration_number: str,
    filing_year: int,
    cut_off_date: date,
) -> tuple[Decimal, Decimal, int]:
    """The payments we hold for this committee-year, bounded by the filing's period.

    Three rules, each measured and each of which silently breaks the comparison when
    skipped (§2.1):

    * ``Receipt type = 'Contribution'`` only.
    * The file's own ``Year`` column, never the year of a row's date. The two disagree
      on 702 rows across the 3 files, and a filing is scoped by ``Year``.
    * Bounded by the report's cut-off. A year-end report and the calendar year coincide;
      a mid-year one does not, and filer 18336 has $321,870.52 of 2026 contributions
      dated after the period its own figures cover.

    An **undated** row is counted as inside the period, which is deliberately the
    direction that can cause a false disagreement: a false disagreement withholds a split
    loudly and a missed shortfall publishes a wrong figure quietly.
    """
    total, cash, rows_held = db.execute(
        text(_OURS_SQL),
        {
            "contributions": release.contributions.snapshot_id,
            "registration_number": registration_number,
            "filing_year": filing_year,
            "contribution": CONTRIBUTION_RECEIPT_TYPE,
            "cut_off_date": cut_off_date,
        },
    ).one()
    return Decimal(total), Decimal(cash), int(rows_held)


def stored_figures(
    db: Session,
    filings_snapshot_id: uuid.UUID,
    registration_number: str,
    filing_year: int,
) -> dict[str, Decimal]:
    """The contributor-type figures the Board's own totals route reported.

    These are what the reader is proved against. Empty is a real state and is not an
    error: the route serves no 2025 block at all for filer 18488, whose 2025 report
    itemizes $2,300.00.
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
    http: requests.Session,
    release: reader.Release,
    filings_snapshot_id: uuid.UUID,
    target: Target,
    base_url: str = BOARD_BASE_URL,
) -> tuple[Verdict, bool]:
    """Check one committee-year. Returns the verdict and whether a request was made."""
    if target.skip_reason is not None:
        return (
            Verdict(
                registration_number=target.registration_number,
                filing_year=target.filing_year,
                status=Status.not_checked,
                reason=target.skip_reason,
                report_type=target.report_type,
                amendment_index=target.amendment_index,
                cut_off_date=target.cut_off_date,
            ),
            False,
        )
    assert target.kind is not None and target.report_type is not None
    assert target.amendment_index is not None
    response, outcome, note = fetch_document(
        http,
        registration_number=target.registration_number,
        filing_year=target.filing_year,
        kind=target.kind,
        report_type=target.report_type,
        amendment_index=target.amendment_index,
        special_election=False,
        base_url=base_url,
    )
    base = dict(
        registration_number=target.registration_number,
        filing_year=target.filing_year,
        report_type=target.report_type,
        amendment_index=target.amendment_index,
        cut_off_date=target.cut_off_date,
    )
    if outcome is not DocumentOutcome.served:
        return (
            Verdict(status=Status.not_checked, reason=note, **base),
            True,
        )
    document_hash = response.content_hash
    document_byte_size = len(response.body)
    document = parse_report_document(response.body)
    figures = stored_figures(
        db, filings_snapshot_id, target.registration_number, target.filing_year
    )
    stated, errors = stated_contributions(document, target.kind, figures)
    if stated is None:
        return (
            Verdict(
                status=Status.reader_unproven,
                reason="this reader could not read the document it was served: "
                + "; ".join(errors),
                self_test=SelfTest.failed.value,
                document_hash=document_hash,
                document_byte_size=document_byte_size,
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
                document_hash=document_hash,
                document_byte_size=document_byte_size,
                stated_itemized=stated.itemized,
                stated_itemized_cash=stated.itemized_cash,
                stated_non_itemized=stated.non_itemized,
                **base,
            ),
            True,
        )
    cut_off = target.cut_off_date or date(target.filing_year, 12, 31)
    held, held_cash, rows_held = ours_itemized(
        db,
        release,
        target.registration_number,
        target.filing_year,
        cut_off,
    )
    difference = stated.itemized - held
    agrees = abs(difference) <= TOLERANCE
    verdict = Verdict(
        status=Status.agrees if agrees else Status.disagrees,
        reason=_comparison_reason(
            stated_total=stated.itemized,
            stated_cash=stated.itemized_cash,
            held=held,
            held_cash=held_cash,
            rows_held=rows_held,
            difference=difference,
            agrees=agrees,
            self_test=stated.self_test,
            self_test_detail=stated.self_test_detail,
            cut_off=cut_off,
        ),
        self_test=stated.self_test.value,
        document_hash=document_hash,
        document_byte_size=document_byte_size,
        stated_itemized=stated.itemized,
        stated_itemized_cash=stated.itemized_cash,
        stated_non_itemized=stated.non_itemized,
        ours_itemized=held,
        ours_itemized_cash=held_cash,
        **base,
    )
    return verdict, True


def _comparison_reason(
    *,
    stated_total: Decimal,
    stated_cash: Decimal,
    held: Decimal,
    held_cash: Decimal,
    rows_held: int,
    difference: Decimal,
    agrees: bool,
    self_test: SelfTest,
    self_test_detail: str,
    cut_off: date,
) -> str:
    if agrees:
        return (
            f"the filing states {stated_total} of itemized contributions through "
            f"{cut_off} and we hold {rows_held:,} rows totalling {held}. "
            f"Reader check: {self_test_detail}"
        )
    direction = "more than" if difference > 0 else "less than"
    missing = (
        "we hold no rows at all for this committee-year, so every dollar the filing "
        "names would otherwise have been shown as money with no donor named"
        if rows_held == 0
        else f"we hold {rows_held:,} rows totalling {held}"
    )
    cash_note = ""
    if stated_cash - held_cash != difference:
        cash_note = (
            f" Of that, {stated_cash - held_cash} is cash and "
            f"{(stated_total - stated_cash) - (held - held_cash)} is in-kind."
        )
    unproven = ""
    if self_test is SelfTest.not_available:
        unproven = (
            " This reading could not be proved against an already-trusted figure for "
            "this committee-year, because the Board's totals route reports none: "
            + self_test_detail
        )
    return (
        f"the filing states {stated_total} of itemized contributions through {cut_off}, "
        f"which is {abs(difference)} {direction} what we hold; {missing}."
        + cash_note
        + unproven
    )


# --- The run ------------------------------------------------------------------


def run_stated_split_check(
    db: Session,
    *,
    years: Iterable[int],
    only_filers: Optional[Iterable[str]] = None,
    base_url: str = BOARD_BASE_URL,
    http: Optional[requests.Session] = None,
    spacing_seconds: float = REQUEST_SPACING_SECONDS,
    write: bool = True,
    progress: Optional[Callable[[str], None]] = None,
) -> StatedSplitRun:
    """Check every committee-year a page could show for these years.

    **Every one, not a sample.** The failure this guards against is one committee at a
    time -- 3 of 202 sitting-legislator years for 2025, plus 1 party unit -- so a sample
    sized for a random failure rate is the wrong instrument and only checking a committee
    catches that committee (§9.4).

    Requests are spaced like every other call to the Board in this repo: 0.25 seconds,
    which is the pacing that drew no refusal across roughly 1,200 requests in 2 hours on
    11 August 2026. That is an observation about one day and not a rate limit the Board
    has published, so it stays conservative rather than being tuned down.
    """
    years = sorted({int(year) for year in years})
    run = StatedSplitRun(years=tuple(years), started_at=datetime.now(UTC))
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
    # Checked here rather than discovered at the end. A run is about 1,300 requests to
    # the Board over roughly 20 minutes, and the first write is the last thing it does,
    # so a missing table threw all of that away and asked the Board for it twice. Found
    # the hard way on the first production run, 13 Aug 2026.
    if write and not _destination_exists(db):
        raise RuntimeError(
            "this database has no cf_stated_split table to write answers into, so a "
            "20-minute run would be thrown away at its last step. Apply the migrations "
            "(alembic upgrade head), or pass --dry-run to report without writing."
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
    session = http or http_session()
    for index, target in enumerate(population, start=1):
        verdict, asked = check_one(
            db, session, release, snapshot, target, base_url=base_url
        )
        run.verdicts.append(verdict)
        if verdict.status is Status.not_checked:
            key = verdict.reason.split(";")[0][:90]
            run.not_checked_reasons[key] = run.not_checked_reasons.get(key, 0) + 1
        if asked:
            run.requests_made += 1
            if spacing_seconds and index < len(population):
                time.sleep(spacing_seconds)
        if progress and index % 50 == 0:
            progress(f"  {index:,} of {len(population):,}")
    run.completed_at = datetime.now(UTC)
    if write:
        store_verdicts(db, release.contributions.snapshot_id, snapshot, run.verdicts)
    return run


def _live_filings_snapshot_id(db: Session) -> Optional[uuid.UUID]:
    return db.execute(
        text("SELECT snapshot_id FROM cf_filing_current WHERE id = true")
    ).scalar()


def _destination_exists(db: Session) -> bool:
    return bool(db.execute(text("SELECT to_regclass('cf_stated_split')")).scalar())


def store_verdicts(
    db: Session,
    contributions_snapshot_id: uuid.UUID,
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
                "INSERT INTO cf_stated_split ("
                "  snapshot_id, registration_number, filing_year, filings_snapshot_id,"
                "  status, reason, self_test, report_type, amendment_index,"
                "  cut_off_date, document_hash, document_byte_size, stated_itemized,"
                "  stated_itemized_cash, stated_non_itemized, ours_itemized,"
                "  ours_itemized_cash, checked_at"
                ") VALUES ("
                "  :snapshot_id, :registration_number, :filing_year,"
                "  :filings_snapshot_id, :status, :reason, :self_test, :report_type,"
                "  :amendment_index, :cut_off_date, :document_hash,"
                "  :document_byte_size, :stated_itemized, :stated_itemized_cash,"
                "  :stated_non_itemized, :ours_itemized, :ours_itemized_cash,"
                "  :checked_at"
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
                "  stated_itemized_cash = EXCLUDED.stated_itemized_cash,"
                "  stated_non_itemized = EXCLUDED.stated_non_itemized,"
                "  ours_itemized = EXCLUDED.ours_itemized,"
                "  ours_itemized_cash = EXCLUDED.ours_itemized_cash,"
                "  checked_at = EXCLUDED.checked_at"
            ),
            {
                "snapshot_id": contributions_snapshot_id,
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
                "stated_itemized_cash": verdict.stated_itemized_cash,
                "stated_non_itemized": verdict.stated_non_itemized,
                "ours_itemized": verdict.ours_itemized,
                "ours_itemized_cash": verdict.ours_itemized_cash,
                "checked_at": datetime.now(UTC),
            },
        )
        written += 1
    db.commit()
    return written


# --- What the download loader's check reads -----------------------------------


@dataclass(frozen=True)
class StatedSplitCoverage:
    """This release's stored verdicts, in the shape the loader's check needs.

    Read once per load rather than queried per committee, because the check sweeps the
    whole population and has no use for a single committee-year.
    """

    checked_at: Optional[datetime]
    agrees: int
    disagrees: int
    not_checked: int
    reader_unproven: int
    disagreeing_filer_years: tuple[str, ...]

    @property
    def total(self) -> int:
        return self.agrees + self.disagrees + self.not_checked + self.reader_unproven


def stated_split_coverage(
    db: Session, contributions_snapshot_id: uuid.UUID
) -> Optional[StatedSplitCoverage]:
    """Every stored verdict for one published set of payments, or None when none exist.

    ``None`` is a real and ordinary state: this check is a separate pass, so a freshly
    loaded download has no verdicts until someone runs it. The loader reports that as
    not run with the command that fixes it, rather than as a pass.
    """
    rows = db.execute(
        text(
            "SELECT status, count(*), max(checked_at) FROM cf_stated_split "
            " WHERE snapshot_id = :snapshot GROUP BY status"
        ),
        {"snapshot": contributions_snapshot_id},
    ).all()
    if not rows:
        return None
    counts = {str(_status_value(status)): int(count) for status, count, _ in rows}
    latest = max(checked_at for _, _, checked_at in rows)
    disagreeing = db.execute(
        text(
            "SELECT registration_number, filing_year FROM cf_stated_split "
            " WHERE snapshot_id = :snapshot AND status = 'disagrees' "
            " ORDER BY registration_number, filing_year"
        ),
        {"snapshot": contributions_snapshot_id},
    ).all()
    return StatedSplitCoverage(
        checked_at=latest,
        agrees=counts.get(Status.agrees.value, 0),
        disagrees=counts.get(Status.disagrees.value, 0),
        not_checked=counts.get(Status.not_checked.value, 0),
        reader_unproven=counts.get(Status.reader_unproven.value, 0),
        disagreeing_filer_years=tuple(
            f"{registration}:{year}" for registration, year in disagreeing
        ),
    )


def _status_value(status) -> str:
    return status.value if isinstance(status, Status) else str(status)


__all__ = [
    "DOCUMENT_FIRST_YEAR",
    "StatedSplitCoverage",
    "StatedSplitRun",
    "Target",
    "Verdict",
    "check_one",
    "ours_itemized",
    "run_stated_split_check",
    "stated_split_coverage",
    "store_verdicts",
    "targets",
]
