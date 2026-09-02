"""Re-run both money checks against the release that has just been published (#1922).

Net: every verdict either check writes is keyed to the exact snapshot it judged, so the
instant a new release publishes, every stored verdict stops applying and every committee
page reverts to saying nobody has compared its figures. That scoping is correct -- a
verdict about payments since replaced is not a verdict about the payments on screen --
so the missing piece is the step after: publishing has to re-run the checks.

**Both checks read the *published* release**
(``campaign_finance_reader.live_release``), so neither can run until publication has
committed. There is therefore no version of this that keeps a release private until it
has been checked, and the window where pages read as unchecked is however long the checks
take, whatever this module does. What it can do is make sure the window closes and that
somebody is told when it does not, which is why the run happens inline in the publishing
command and its outcome carries the command's exit code.

Runtime, measured against production: money out read 3,643 stored documents and wrote
4,124 verdicts in about 21 minutes on 1 September 2026, asking the Board for nothing;
money in took 51 minutes for the same 3 filing years on 2 September 2026, because it
fetches each document from the Board at the repo's standard 0.25-second spacing.

Design: ``docs/architecture/campaign-finance-system-design.md`` §4 (Ingestion: snapshot
and replace) and §9.9 (checks this design asks for that were not run).
"""

from __future__ import annotations

import tempfile
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Callable, Iterable, Optional

from sqlalchemy.orm import Session

from alethical.pipeline import campaign_finance_stated_spending as spending
from alethical.pipeline import campaign_finance_stated_split as split
from alethical.pipeline.campaign_finance_report_document_store import (
    DocumentKeeper,
    DocumentLibrary,
)
from alethical.pipeline.raw_file_store import raw_file_store_from_env

MONEY_IN = "money in"
MONEY_OUT = "money out"

# The current year and the 2 before it. Wide enough not to shrink what the checks
# already cover -- the stored verdicts span 3 filing years -- and bounded because the
# Board serves no report document at all before 2023, so an older year can only ever
# record as not checked.
YEARS_BACK = 2


def recheck_years(today: Optional[datetime] = None) -> tuple[int, ...]:
    """Which filing years a publish re-checks unless an operator names others."""
    year = (today or datetime.now(UTC)).year
    return tuple(range(year - YEARS_BACK, year + 1))


@dataclass
class CheckOutcome:
    """What one of the 2 checks did, or why it could not.

    ``error`` is the whole point of this dataclass. A check that raises must not leave
    the publishing command looking successful, so the failure is captured here, printed
    with a banner, and turned into a non-zero exit -- never swallowed.
    """

    name: str
    verdicts: Optional[int] = None
    counts: dict[str, int] = field(default_factory=dict)
    seconds: Optional[float] = None
    error: Optional[str] = None

    @property
    def ran(self) -> bool:
        return self.error is None


@dataclass
class RecheckReport:
    years: tuple[int, ...] = ()
    outcomes: list[CheckOutcome] = field(default_factory=list)

    @property
    def failed(self) -> bool:
        return any(not outcome.ran for outcome in self.outcomes)

    def summary(self) -> str:
        years = ", ".join(str(year) for year in self.years)
        lines = [f"re-checked the published release against filings for {years}:"]
        for outcome in self.outcomes:
            if not outcome.ran:
                continue
            elapsed = (
                f" in {outcome.seconds / 60:.1f} minutes"
                if outcome.seconds is not None
                else ""
            )
            counts = ", ".join(
                f"{count:,} {status.replace('_', ' ')}"
                for status, count in sorted(outcome.counts.items())
            )
            lines.append(
                f"  {outcome.name}: {outcome.verdicts:,} committee-years{elapsed}"
                + (f" ({counts})" if counts else "")
            )
        broken = [outcome for outcome in self.outcomes if not outcome.ran]
        if broken:
            # A banner, and its own exit code at the call site. A publish followed by a
            # check that silently did not run is the exact defect #1922 is about, and a
            # quiet line at the end of a 20-minute run is how it goes unnoticed again.
            lines.append("")
            lines.append("=" * 70)
            lines.append(
                f"NEEDS A PERSON: {len(broken)} of {len(self.outcomes)} money checks "
                "could not run against the release just published, so every committee "
                "page will say nobody has compared its figures until one is run by "
                "hand. No earlier verdict is reused."
            )
            for outcome in broken:
                lines.append(f"  {outcome.name}: {outcome.error}")
            lines.append("  Re-run by hand:")
            lines.append(
                "    PYTHONPATH=. uv run python "
                "scripts/check_campaign_finance_stated_split.py --years " + years
            )
            lines.append(
                "    PYTHONPATH=. uv run python "
                "scripts/check_campaign_finance_stated_spending.py --years " + years
            )
            lines.append("=" * 70)
        return "\n".join(lines)


def run_money_in(
    db: Session,
    *,
    years: Iterable[int],
    store: Any,
    directory: str,
    progress: Callable[[str], None],
    base_url: str = split.BOARD_BASE_URL,
    spacing_seconds: float = split.REQUEST_SPACING_SECONDS,
) -> tuple[int, dict[str, int]]:
    """The money-in check, with a keeper so every document read is kept (#1501)."""
    keeper = DocumentKeeper(db=db, store=store, directory=directory)
    run = split.run_stated_split_check(
        db,
        years=years,
        base_url=base_url,
        spacing_seconds=spacing_seconds,
        keeper=keeper,
        progress=progress,
    )
    if keeper.report.failures:
        # The Board serves no archive, so a document read and not kept is gone. The
        # verdicts are already written by this point, so this is reported rather than
        # raised -- but it is reported, because it is unrecoverable.
        progress(
            f"note: {len(keeper.report.failures)} document(s) were read and could not "
            "be kept; the Board serves no archive, so those bytes are gone."
        )
    return len(run.verdicts), run.counts()


def run_money_out(
    db: Session,
    *,
    years: Iterable[int],
    store: Any,
    directory: str,
    progress: Callable[[str], None],
) -> tuple[int, dict[str, int]]:
    """The money-out check, which reads our own stored documents and asks the Board
    for nothing."""
    library = DocumentLibrary(db=db, store=store, directory=directory)
    run = spending.run_stated_spending_check(
        db, library, years=years, progress=progress
    )
    return len(run.verdicts), run.counts()


def recheck_stated_figures(
    db: Session,
    *,
    years: Optional[Iterable[int]] = None,
    store_factory: Callable[[], Any] = raw_file_store_from_env,
    log: Callable[[str], None] = print,
    money_in: Callable[..., tuple[int, dict[str, int]]] = run_money_in,
    money_out: Callable[..., tuple[int, dict[str, int]]] = run_money_out,
) -> RecheckReport:
    """Run both checks against the live release and report what each one did.

    Neither check's failure stops the other: money out reads our own store and money in
    reads the Board, so the ways they break do not overlap and one working check is
    worth having. Every failure lands in the report, and the caller exits non-zero on
    it.
    """
    chosen = tuple(sorted({int(year) for year in years})) if years else recheck_years()
    report = RecheckReport(years=chosen)
    store: Any = None
    store_error: Optional[str] = None
    try:
        store = store_factory()
    except Exception as error:  # noqa: BLE001 - reported, never swallowed
        store_error = (
            f"the report-document store is unreachable, so neither check can read a "
            f"filing: {error}"
        )
    # Money in first, and the order is load-bearing rather than alphabetical: money in
    # fetches each document from the Board and keeps it (#1501), and money out reads
    # documents back out of that same store. So money in going first is what lets money
    # out see a document filed since the last sweep, in the same publish. The reverse
    # order would leave that committee-year reading as not checked until the next one.
    for name, runner in ((MONEY_IN, money_in), (MONEY_OUT, money_out)):
        if store_error is not None:
            report.outcomes.append(CheckOutcome(name=name, error=store_error))
            continue
        log(f"re-checking {name} for {', '.join(str(year) for year in chosen)}")
        started = datetime.now(UTC)
        try:
            with tempfile.TemporaryDirectory(prefix="cf-recheck-") as directory:
                verdicts, counts = runner(
                    db,
                    years=chosen,
                    store=store,
                    directory=directory,
                    progress=log,
                )
        except Exception as error:  # noqa: BLE001 - reported, never swallowed
            db.rollback()
            report.outcomes.append(CheckOutcome(name=name, error=str(error)))
            continue
        report.outcomes.append(
            CheckOutcome(
                name=name,
                verdicts=verdicts,
                counts=counts,
                seconds=(datetime.now(UTC) - started).total_seconds(),
            )
        )
    return report
