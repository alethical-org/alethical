"""One committee's money, over HTTP, keyed on its registration number (#1442).

Minnesota identifies a campaign committee by a registration number and never says
whose it is. That number needs no human confirmation, so everything here is
answerable today, while a *legislator's* money waits on someone confirming which
committee is theirs (``docs/architecture/campaign-finance-system-design.md`` §5,
Identity). This is deliberately the committee-shaped layer underneath that
confirmation: hand it a number and a year and it reports what the state's own
downloads say, with no legislator anywhere in the path.

**This module does not sum any money itself.** Every figure comes from
``alethical/pipeline/campaign_finance_reader.py`` (#1330), which merged while this
was being built and is the single home for the 4 source behaviours that make a
plausible-looking query silently wrong. A second implementation of those rules is
exactly how one copy gets fixed and the other does not, so what lives here is only
the part a *page* needs and a command-line reader does not:

* **Who a registration number belongs to**, resolved across all 3 downloads. The
  reader answers "which filers are the parties and caucuses"; a page has a number in
  its URL and needs a name for it, including for the 341 committees that appear only
  as the target of someone else's independent spending.
* **A state per block instead of an exception.** The reader raises when a release's
  rows have gone, which is right for a script that should stop. A page has 3 blocks
  and they fail independently: one stale download must not blank the other two.
* **Whether an empty answer is about the committee or about us.** The reader
  deliberately leaves absence to its caller, so deciding what absence *means* is this
  layer's job, and it is the whole of rule 12 on this surface.
* **Independent spending aimed AT this committee**, which is a different question
  from the reader's ``independent_spending_by`` (money this filer *spent*). It comes
  from #1332's own service so its honesty rules also exist once.

**Every figure is a sum of itemized rows, and none of them is a committee's total.**
Minnesota names a donor only once their giving passes $200 in aggregate within a
calendar year (Minnesota Statutes 10A.20 subd. 3(c)), so the payments we can list
never add up to what a committee reported raising -- measured at 36.5% of the 2024
total and 41.3% of 2025 going unnamed (§9.5). So every field says ``itemized`` in its
own name and there is deliberately no field a caller could mistake for a grand total.
Rule 12's *other* number now exists: #1408 stores each filer's own reported figure and
``reported_contributions`` serves it with the date it runs to, so a page can show both.
It is a separate claim by a separate source and the two are never added together.

Three things this layer refuses to do, each because the alternative states something
no filing supports (``.claude/rules/grounded-answers.md`` rule 12).

**It never renders "we hold no rows" as a zero.** A committee-year with no itemized
rows is ``NOT_REPORTED``, never ``0``. Senator Omar Fateh's Senate committee (18488)
filed $2,300.00 of itemized contributions for 2025 that the bulk download does not
carry, so a page reading absence as zero would print "$0 raised" over a real filing.
218 committee-years in the live release hold receipts of which **not one** is a
contribution, which is why the contribution figure's state is decided by the
contribution rows alone rather than by whether the committee appears at all.

**It never reads our own gaps as an answer.** Three of them, all ours, all
``UNAVAILABLE``: a release whose rows have been replaced twice; a year the downloads
do not reach at all, since they stop at the present while the route accepts 2100; and
a committee-year holding a row with no amount, where the total cannot be computed and
is withheld rather than understated.

**It never mixes two releases, across the whole request rather than only at its
start.** One release is resolved once and passed to every read, and the request pins
itself to one instant of the database, because rows survive exactly one further
publish and 2 publishes landing *between* statements would otherwise take the named
release's rows away halfway through.

Measurements are against production release ``3f2bdf90`` on 12 Aug 2026. Counts are
evidence, never assertions (§8).
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, aliased

from alethical.api.services.independent_spending import (
    REPORTED,
    UNAVAILABLE,
    CommitteeSpending,
    spending_for_committee_if_year_covered,
)
from alethical.api.services.committee_stated_spending import (
    stated_spending_for_year,
)
from alethical.db.schema import load_schema
from alethical.pipeline import campaign_finance_filings as filings
from alethical.pipeline import campaign_finance_reader as reader
from alethical.pipeline.campaign_finance_filing_calendars import (
    printed_period_start_for_end,
)
from alethical.pipeline.campaign_finance_filings import ReportedTotalsContext

schema = load_schema()
CampaignFinanceContributionRow = schema.CampaignFinanceContributionRow
CampaignFinanceExpenditureRow = schema.CampaignFinanceExpenditureRow
CampaignFinanceIndependentExpenditureRow = (
    schema.CampaignFinanceIndependentExpenditureRow
)

Dataset = schema.CampaignFinanceDataset
Release = reader.Release
ReleaseNoLongerHeld = reader.ReleaseNoLongerHeld

#: We hold no itemized rows for this committee-year, in a year the download covers.
#: The committee may well have raised or spent money: the downloads carry only
#: payments over $200, so absence here is silence, not a zero. ``REPORTED`` and
#: ``UNAVAILABLE`` come from ``independent_spending`` rather than being restated, so
#: the services cannot drift into two vocabularies for the same three answers.
NOT_REPORTED = "not_reported"

_ROW_MODEL = {
    Dataset.contributions: CampaignFinanceContributionRow,
    Dataset.expenditures: CampaignFinanceExpenditureRow,
    Dataset.independent_expenditures: CampaignFinanceIndependentExpenditureRow,
}


@dataclass(frozen=True)
class Committee:
    """Who the registration number belongs to, as the download itself names them.

    ``entity_type`` is the Board's code for the kind of filer -- ``PCC`` a candidate's
    principal campaign committee, ``PTU`` a party unit (``CAU`` a caucus), ``PCF`` a
    political committee or fund. It is ``None`` for the 283 committees reachable only
    through the independent-expenditure file, which are local candidates the state
    does not register and which carry a negative registration number the Board
    assigns internally.
    """

    registration_number: str
    name: str
    entity_type: str | None
    entity_sub_type: str | None


@dataclass(frozen=True)
class ReceiptTypeTotal:
    """One ``Receipt type`` the committee reported, spelled as the source spells it."""

    receipt_type: str
    total: Decimal
    payments: int


@dataclass(frozen=True)
class ExpenditureTypeTotal:
    """One ``Type`` of payment out, spelled as the source spells it."""

    expenditure_type: str
    total: Decimal
    payments: int


@dataclass(frozen=True)
class MoneyIn:
    """Itemized receipts for one committee-year, plus the filer's own reported total.

    ``state`` describes the **contribution** figure alone. A committee-year can hold a
    loan and no contributions, and 218 of them do, so deciding this from "are there
    any rows" would print a zero over a real filing.

    ``other_receipts`` is everything the file reports that is not a contribution --
    ``Miscellaneous``, ``Miscellaneous Income``, ``Loan Payable``. It is not part of
    ``itemized_contribution_total`` and must never be added to it: the filing carries
    those on separate schedules and the Board's own totals exclude them (§2.1).

    ``reported_total`` is rule 12's second number, from the filer's own report rather
    than from the download, and ``reported_through`` is the date it runs to. Both are
    ``None`` when no filings snapshot is published, which is a fact about us. They are
    never added to the itemized figure: they are separate claims by separate sources.

    **The figure is the filing's Cash column, not its Total column.** The Board's
    totals route serves each contribution line as cash: filer 60084's 2025 year-end
    prints "Total Contributions Received: Cash 0.00, In-kind 3,868.19, Total 3,868.19"
    and the route serves ``Contributions received 0.00`` for it. A committee whose
    donations were all goods and services therefore reports a cash line of $0 beside
    itemized in-kind rows, and that $0 is not the filer's total, so ``money_in``
    withholds it (``None``) rather than serving a zero the filing's own Total column
    contradicts. 16 committee-years across 2024 to 2026 on the live release,
    11 Sep 2026.
    """

    state: str
    itemized_contribution_total: Decimal | None
    itemized_contribution_payments: int | None
    other_receipts: tuple[ReceiptTypeTotal, ...]
    reported_total: Decimal | None
    reported_through: date | None
    #: The period start the Board's own transcribed disclosure calendars print
    #: against this filing's period end, or ``None`` — never an assumed 1 January
    #: (§7). Only derived for a filer-year the totals copy can speak for, which
    #: already excludes special-election filers, whose period does not open where
    #: the calendars say.
    reported_period_start: date | None
    source_url: str | None


@dataclass(frozen=True)
class MoneyOut:
    """Itemized payments out for one committee-year, split by the source's own labels.

    ``itemized_payment_total`` sums **every** row whatever its ``Type``. Nothing is
    filtered, which is how a party unit's ``General Expenditure`` rows and a candidate
    committee's ``Campaign Expenditure`` rows both land in the figure; ``by_type``
    carries the source's own breakdown so a surface can show the composition without
    this layer deciding what counts. The amount is the filing's *total* column, not its
    paid column, and unpaid amounts are not netted off (§2.1).
    """

    state: str
    itemized_payment_total: Decimal | None
    itemized_payments: int | None
    by_type: tuple[ExpenditureTypeTotal, ...]
    #: How much of ``itemized_payment_total`` was goods and services rather than
    #: money, from the payments file's own ``In-kind?`` column. The money-out twin
    #: of ``NamedMoneySplit.named_in_kind_total``, and the figure that lets a card
    #: name an amount where it previously named only the mechanism
    #: ([#1894](https://github.com/alethical-org/alethical/issues/1894)).
    #:
    #: ``None`` means we cannot speak for this filer-year's payment rows at all,
    #: which is every state but ``REPORTED``. Under ``REPORTED`` we hold the rows
    #: and every one of them carries a ``Yes`` or ``No``, so a filer-year with no
    #: in-kind row is a measured ``0`` rather than silence -- the one place absence
    #: does mean zero here, and only because the column is never blank.
    in_kind_total: Decimal | None
    #: The filing's own "Total expenditures" figure -- rule 12's second number for
    #: money out, a separate claim by a separate source, never added to or
    #: subtracted from the itemized sum. ``None`` when no filings snapshot is
    #: published or the totals copy cannot speak for this filer-year.
    reported_total: Decimal | None
    reported_through: date | None
    source_url: str | None
    #: Whether this committee-year's own filed report was compared against the
    #: payment rows we hold, and what the comparison said
    #: ([#1650](https://github.com/alethical-org/alethical/issues/1650)). The
    #: money-out twin of ``NamedMoneySplit.stated_split_state``, and the reason it
    #: is a field rather than a page's inference: nothing else on this block can
    #: tell a figure that was checked against the filing from one that was not.
    #:
    #: 5 values, from ``committee_stated_spending``. ``agrees`` is the only one that
    #: lets a page treat the itemized figure as checked. ``disagrees`` means the 2
    #: publications state different amounts and the page must say so rather than
    #: explain the gap away. ``not_checked`` is Minnesota's gap, ``reader_unproven``
    #: is ours, and ``not_run`` means nobody has looked -- 3 different reasons for
    #: the same absence of a verdict, and none of them is a pass.
    stated_spending_state: str


@dataclass(frozen=True)
class IndependentSpendingAbout:
    """What others spent about this committee, from #1332's shared query.

    Unlike money in and money out, a committee absent from this file reads as a
    measured ``0`` rather than ``NOT_REPORTED``. The two cases genuinely differ: an
    absent *filer* may simply have raised money nobody had to name, while a committee
    nobody filed an independent expenditure about had no independent spending
    reported over $200, which is a finding.
    """

    state: str
    spending: CommitteeSpending | None
    source_url: str | None


@dataclass(frozen=True)
class CommitteeFinance:
    """Everything one committee's page may show for one year, from one release.

    ``fetched_at`` dates the payment files, and it is **not** the
    period the money covers: the period is per filing, always earlier, and stated by
    ``money_in.reported_through`` where a filing supplies it. No surface may hardcode
    1 January as a period start -- filer 19223 reports from 11 July 2025 -- and this
    layer states no period of its own so nothing downstream can inherit one from it.
    """

    committee: Committee
    year: int
    release_id: UUID
    fetched_at: datetime
    money_in: MoneyIn
    money_out: MoneyOut
    independent_spending: IndependentSpendingAbout


def filings_copied_at(
    db: Session, registration_number: str | None = None
) -> datetime | None:
    """End of the published filing source's own fetch window, never its publish date.

    The same current-snapshot pointer selects the report totals. A newer unpublished
    run, a report's receipt date, and the payment release cannot date those figures.
    No current filing source means no date, even when payment files are available.
    Call inside the request's pinned database view so the figures and date agree.
    The same resolver every figure used, so inside a pinned request it costs no trip.

    With a ``registration_number``, the date is that filer's own: a committee the
    Board's register no longer lists is retained from an earlier copy (D1, #2344) and
    its figures were read on that earlier day, so that is the day they carry. The same
    register read the rest of the page makes (``filer_records``), so it costs no trip.
    """
    snapshot = filings.live_filings_snapshot(db)
    if snapshot is None:
        return None
    if registration_number is not None:
        filer = filings.filer_records(db, [registration_number]).get(
            registration_number
        )
        if filer is not None and getattr(filer, "captured_at", None) is not None:
            return filer.captured_at
    return snapshot.fetch_completed_at


def pin_to_one_view(db: Session) -> None:
    """Make every later statement in this request see one instant of the database.

    Resolving the release once is not enough on its own. The rows of a replaced set
    survive exactly one further publish, so if 2 publishes land *between* this
    request's statements, the release we already named loses its rows halfway through:
    money in reads a real figure and money out then finds nothing.

    ``REPEATABLE READ`` closes it, and is one of the 2 shapes
    ``docs/product-onboarding/data-ingestion-onboarding.md`` section H names as safe
    (the other being a single statement, which 3 datasets cannot be). Every statement
    then reads the instant this transaction began, so a publish landing mid-request is
    invisible to it and cannot turn a figure into an absence.

    Set for this connection through ``execution_options`` rather than on the engine
    or the session, deliberately. Production connects through Supabase's transaction
    pooler, where a *session* setting can outlive the client that set it and reach
    another request on the same backend connection -- the same hazard that makes a
    session-level advisory lock unsafe in ``alethical/pipeline/campaign_finance.py``.
    An isolation level set this way is carried by psycopg inside the ``BEGIN`` it
    sends for this transaction (``BEGIN ISOLATION LEVEL REPEATABLE READ``), which is
    scoped to the transaction by definition and ends with it, and SQLAlchemy puts the
    connection back to the engine's default when the request returns it to the pool.
    A ``SET TRANSACTION`` statement says the same thing and costs a round trip of its
    own on every money read, about 35 ms from Railway. Verified against production's
    pooler on 17 Sep 2026: inside the transaction ``SHOW transaction_isolation``
    reports ``repeatable read`` with no ``SET TRANSACTION`` statement sent, the
    pointer read twice inside it is stable, and the next transaction on the same
    pooled connection and a fresh checkout both report ``read committed``.

    Must run before any statement in the transaction: once the session holds a
    connection the option is ignored with a warning, so callers call it before
    resolving anything. ``alethical/tests/test_committee_finance.py`` reads the level
    while a request's own transaction is still open, and
    ``alethical/tests/test_money_read_costs.py`` pins that pinning sends no statement.

    Once pinned, the live register is resolved once per request rather than once per
    caller (``campaign_finance_filings.mark_pinned_read``).
    """
    db.connection(execution_options={"isolation_level": "REPEATABLE READ"})
    filings.mark_pinned_read(db)


def current_release(db: Session) -> Release | None:
    """The published release and its 3 snapshots, resolved in one statement.

    #1330's resolver, not a second one: it reads the pointer, the release and all 3
    snapshots together, carries each snapshot's published row count so staleness can
    be told from emptiness, and refuses outright when a published release names a
    snapshot that is no longer loaded.

    Inside a request pinned by ``pin_to_one_view`` and before anything else has been
    read, the same statement also answers 2 questions every money read asks next:
    which filings snapshot is live (``filings.live_filings_snapshot``), and which
    filer-years the release's own checks refuse a split for
    (``withheld_filer_years``). Both rode on statements of their own, 2 round trips
    to a database in another region on every money page (18 Sep 2026). The filings
    pointer is outer-joined, so a release with no register beside it still resolves,
    and the register's absence is remembered exactly as its own read would report it.

    ``None`` means nothing is published, which is a fact about us and a real state on
    a fresh database.
    """
    memo = filings.pinned_memo(db)
    if memo is None or "snapshot" in memo:
        return reader.live_release(db)
    release_model = schema.CampaignFinanceRelease
    pointer = schema.CampaignFinanceCurrentRelease
    contributions = aliased(schema.CampaignFinanceSnapshot)
    expenditures = aliased(schema.CampaignFinanceSnapshot)
    independent = aliased(schema.CampaignFinanceSnapshot)
    filing_pointer = schema.CampaignFinanceFilingCurrentSnapshot
    filing_snapshot = schema.CampaignFinanceFilingSnapshot
    row = db.execute(
        select(
            release_model.id,
            release_model.fetch_completed_at,
            contributions.id,
            contributions.source_url,
            contributions.row_count,
            contributions.status,
            expenditures.id,
            expenditures.source_url,
            expenditures.row_count,
            expenditures.status,
            independent.id,
            independent.source_url,
            independent.row_count,
            independent.status,
            contributions.validation_json,
            filing_snapshot,
        )
        .select_from(pointer)
        .join(release_model, release_model.id == pointer.release_id)
        .join(
            contributions, contributions.id == release_model.contributions_snapshot_id
        )
        .join(expenditures, expenditures.id == release_model.expenditures_snapshot_id)
        .join(
            independent,
            independent.id == release_model.independent_expenditures_snapshot_id,
        )
        .outerjoin(filing_pointer, filing_pointer.id.is_(True))
        .outerjoin(filing_snapshot, filing_snapshot.id == filing_pointer.snapshot_id)
        .where(pointer.id.is_(True))
        .execution_options(populate_existing=True)
    ).one_or_none()
    if row is None:
        return None
    *release_columns, checks, snapshot = row
    memo["snapshot"] = snapshot
    memo["withheld_filer_years"] = reader.withheld_filer_years_from_checks(checks)
    return reader.release_from_row(release_columns)


def withheld_filer_years(db: Session, release: Release) -> frozenset[tuple[str, int]]:
    """``reader.filer_years_that_must_not_show_a_split``, read once per pinned request.

    The pinned release read already carries the answer; outside a pinned request, or
    where that read did not run first, this asks the reader and remembers nothing.
    """
    memo = filings.pinned_memo(db)
    if memo is not None and "withheld_filer_years" in memo:
        return memo["withheld_filer_years"]
    withheld = reader.filer_years_that_must_not_show_a_split(db, release)
    if memo is not None:
        memo["withheld_filer_years"] = withheld
    return withheld


def money_rows(
    db: Session, release: Release, registration_number: str, years: list[int]
) -> reader.MoneyRows:
    """One committee's money rows for ``years``, read once per pinned request.

    ``reader.money_rows`` folds the 4 per-committee-year aggregates into 1 statement;
    this remembers its answer for the rest of the request, so the money-in card, the
    money-out card, the in-kind figure, the all-in-kind check and the split's dates and
    cash all draw from the one read. Keyed on the release, the committee and the exact
    years asked, so a caller asking about a different span reads again rather than
    getting a partial answer.
    """
    wanted = tuple(sorted({int(year) for year in years}))
    memo = filings.pinned_memo(db)
    held = memo.setdefault("money_rows", {}) if memo is not None else {}
    key = (release.id, registration_number, wanted)
    if key not in held:
        held[key] = reader.money_rows(db, release, registration_number, wanted)
    return held[key]


def contribution_facts(
    db: Session, release: Release, registration_number: str, years: list[int]
) -> dict[int, reader.ContributionFacts]:
    """The contribution dates and cash per year, off the same read as the cards."""
    return money_rows(db, release, registration_number, years).contribution_facts


def _money_in_rows(
    db: Session, release: Release, registration_number: str, year: int
) -> tuple[reader.MoneyIn, ...]:
    """``reader.money_in`` for one year, off the shared read, refusals included."""
    rows = money_rows(db, release, registration_number, [year]).money_in
    if not rows:
        reader._refuse_if_rows_are_gone(db, release, Dataset.contributions)
    return rows


def _money_out_rows(
    db: Session, release: Release, registration_number: str, year: int
) -> tuple[reader.MoneyOut, ...]:
    """``reader.money_out`` for one year, off the shared read, refusals included."""
    rows = money_rows(db, release, registration_number, [year]).money_out
    if not rows:
        reader._refuse_if_rows_are_gone(db, release, Dataset.expenditures)
    return rows


def _covers_year(db: Session, release: Release, dataset: Dataset, year: int) -> bool:
    """Whether this download holds any row at all for ``year``, from any committee.

    The question the reader deliberately leaves to its caller, and the difference
    decides whether an empty answer is about the committee or about us. The downloads
    cover 2015 to the present while this endpoint accepts years to 2100, so without
    this a request for a year the files do not reach returns a **confident zero**:
    measured on the live release, every dataset holds rows for 2015 through 2026 and
    none beyond, so asking for 2027 today would report "no independent spending was
    reported about this committee", as a finding, about a year nobody has filed for.
    2027 is months away, and a page defaulting to "this year" reaches it on 1 January.

    Asked only when a committee's own rows come back empty, so the ordinary populated
    request costs nothing: rows for that committee in that year already prove the year
    is covered.
    """
    model = _ROW_MODEL[dataset]
    return (
        db.scalar(
            select(model.row_number)
            .where(
                model.snapshot_id == release.file_for(dataset).snapshot_id,
                model.year == year,
            )
            .limit(1)
        )
        is not None
    )


def _empty_state(db: Session, release: Release, dataset: Dataset, year: int) -> str:
    """What an empty result means: silence about the committee, or a gap in our data."""
    if _covers_year(db, release, dataset, year):
        return NOT_REPORTED
    return UNAVAILABLE


def find_committee(
    db: Session, release: Release, registration_number: str
) -> Committee | None:
    """Who this registration number is, or ``None`` if it is nowhere in the release.

    Looked up across all 3 datasets, because a committee can be missing from any one
    of them: 333 filers in the live release appear only in the expenditures download,
    72 only in contributions, and 341 committees appear only as the *target* of
    someone else's independent spending and have no state filings of their own.

    The expenditures file is preferred where a committee appears in more than one,
    because it names the most filers and carries the filer kind; the
    independent-expenditure file is last because it names an affected committee
    without saying what kind of filer it is. This is a display preference only: name
    and kind are stable per registration number within a snapshot, measured across all
    2,783 and 3,044 filers of the live release with zero disagreements.

    The Board's registered-filer directory is the authority on whether a committee
    exists, and this does not read it (§9.7), so ``None`` means "no records here" and
    a caller must not phrase it as "no such committee".
    """
    lookups = (
        (
            Dataset.expenditures,
            CampaignFinanceExpenditureRow.committee_reg_num,
            (
                CampaignFinanceExpenditureRow.committee_name,
                CampaignFinanceExpenditureRow.entity_type,
                CampaignFinanceExpenditureRow.entity_sub_type,
            ),
        ),
        (
            Dataset.contributions,
            CampaignFinanceContributionRow.recipient_reg_num,
            (
                CampaignFinanceContributionRow.recipient,
                CampaignFinanceContributionRow.recipient_type,
                CampaignFinanceContributionRow.recipient_subtype,
            ),
        ),
        (
            Dataset.independent_expenditures,
            CampaignFinanceIndependentExpenditureRow.affected_committee_reg_num,
            (CampaignFinanceIndependentExpenditureRow.affected_committee_name,),
        ),
    )
    for dataset, key_column, columns in lookups:
        row = db.execute(
            select(*columns)
            .where(
                _ROW_MODEL[dataset].snapshot_id
                == release.file_for(dataset).snapshot_id,
                key_column == registration_number,
            )
            .limit(1)
        ).first()
        if row is not None:
            return Committee(
                registration_number,
                row[0] or "",
                row[1] if len(row) > 1 else None,
                row[2] if len(row) > 2 else None,
            )
    # Nothing found anywhere. Before calling that a gap in our records, make the
    # reader check whether the rows are simply gone: a release whose snapshots
    # published rows and now hold none has been replaced twice, and answering "no such
    # registration number" on the strength of our own pruning is the same
    # missing-versus-zero failure one level up (#1330's `_refuse_if_rows_are_gone`).
    for dataset in _ROW_MODEL:
        reader._refuse_if_rows_are_gone(db, release, dataset)
    return None


def money_in(
    db: Session,
    release: Release,
    *,
    registration_number: str,
    year: int,
    reported: ReportedTotalsContext | None = None,
) -> MoneyIn:
    """Itemized receipts for one committee in one year, plus its own reported total.

    The sums come from #1330's reader, which scopes on the file's own ``Year`` column
    rather than the year of a row's date -- separate claims that disagree on 702 rows
    across the 3 files -- and keeps only ``Receipt type = 'Contribution'`` in the
    contribution figure while returning the rest under their own labels.

    ``reported`` is this committee-year's filed figures where the caller has already
    read them, so a page showing money in and money out reads them once rather than
    twice (#1966). Left out, they are read here for this one committee and year.

    The reads live here and the meaning of what they return lives in
    ``fold_money_in``, so a caller holding several years' rows at once (the year
    buttons of a legislator's money tab) reaches the same states by the same rules.
    """
    reported_total, reported_through = _reported_contributions(
        db, registration_number, year, reported
    )
    try:
        years = _money_in_rows(db, release, registration_number, year)
    except ReleaseNoLongerHeld:
        return fold_money_in(
            None,
            release=release,
            year=year,
            rows_gone=True,
            reported_total=reported_total,
            reported_through=reported_through,
            covers_year=lambda: False,
            every_named_contribution_is_in_kind=lambda: False,
        )
    return fold_money_in(
        next((entry for entry in years if entry.year == year), None),
        release=release,
        year=year,
        rows_gone=False,
        reported_total=reported_total,
        reported_through=reported_through,
        # Both asked only on the branch that needs the answer, so the ordinary
        # populated request pays for neither.
        covers_year=lambda: _covers_year(db, release, Dataset.contributions, year),
        every_named_contribution_is_in_kind=lambda: (
            _every_named_contribution_is_in_kind(db, release, registration_number, year)
        ),
    )


def fold_money_in(
    found: reader.MoneyIn | None,
    *,
    release: Release,
    year: int,
    rows_gone: bool,
    reported_total: Decimal | None,
    reported_through: date | None,
    covers_year: Callable[[], bool],
    every_named_contribution_is_in_kind: Callable[[], bool],
) -> MoneyIn:
    """What one committee-year's contribution rows mean, given what was read.

    ``found`` is the reader's answer for the year, or ``None`` where it returned no
    row; ``rows_gone`` is the reader having refused because the release's rows have
    been replaced out from under it. The 2 callables answer the questions a page asks
    only on some branches -- whether the download holds any row for the year at all,
    and whether every contribution row held was goods rather than money -- so a
    caller with one year asks the database lazily and a caller with 12 answers from
    what it already holds. Every state and every figure here is decided by exactly the
    rules ``money_in`` applies, because this is where ``money_in`` applies them.
    """
    source_url = release.contributions.source_url
    if rows_gone:
        return MoneyIn(UNAVAILABLE, None, None, (), None, None, None, source_url)
    # The Board's own calendars print a start against this period end; a filer-year
    # the totals copy speaks for is never a special-election one, so the printed
    # start applies where one exists. ``None`` stays the covers-through state.
    period_start = (
        printed_period_start_for_end(reported_through)
        if reported_through is not None
        else None
    )
    if found is None:
        return MoneyIn(
            NOT_REPORTED if covers_year() else UNAVAILABLE,
            None,
            None,
            (),
            reported_total,
            reported_through,
            period_start,
            source_url,
        )

    others = tuple(
        ReceiptTypeTotal(bucket.label, bucket.total, bucket.rows)
        for bucket in found.other_receipts
    )
    contributions = found.contributions
    if contributions.rows_missing_an_amount:
        # We hold this committee's rows and cannot add them up, which is a gap in our
        # copy rather than silence from the committee. `_empty_state` would call it
        # `NOT_REPORTED`, because the year is plainly covered -- by these very rows --
        # and a page would then say this committee reported no itemized contributions
        # when it did. Found by an automated review (Greptile) after the code and this
        # module's own docstring had disagreed about it.
        return MoneyIn(
            UNAVAILABLE,
            None,
            None,
            others,
            reported_total,
            reported_through,
            period_start,
            source_url,
        )
    if contributions.rows == 0:
        return MoneyIn(
            NOT_REPORTED if covers_year() else UNAVAILABLE,
            None,
            None,
            others,
            reported_total,
            reported_through,
            period_start,
            source_url,
        )
    if reported_total == 0 and every_named_contribution_is_in_kind():
        # The Board's line is the filing's Cash column, and this filing's cash was
        # $0 because everything it took in was goods and services: filer 60084's 2025
        # year-end states "Total Contributions Received: Cash 0.00, In-kind 3,868.19,
        # Total 3,868.19". Served, that $0 sat under "Total contributions" on a live
        # page, directly above $3,868 of itemized donations, which is a zero the
        # filing's own Total column contradicts and not the verified zero rule 12
        # allows. 16 committee-years across 2024 to 2026, 11 Sep 2026. A cash line
        # above zero beside in-kind rows is still a real cash figure and is served;
        # a cash line of $0 beside *cash* rows is a contradiction between the 2
        # publications and stays served so the split can refuse it for that reason.
        reported_total, reported_through, period_start = None, None, None
    return MoneyIn(
        REPORTED,
        contributions.total,
        contributions.rows,
        others,
        reported_total,
        reported_through,
        period_start,
        source_url,
    )


def _every_named_contribution_is_in_kind(
    db: Session, release: Release, registration_number: str, year: int
) -> bool:
    """Whether none of the contribution rows we hold for this filer-year was cash.

    **Only ever called once the caller knows it holds this filer-year's contribution
    rows**, and only when the filing's cash line is $0, so the extra read runs on the
    16 committee-years it applies to rather than on every page (#1966). ``in_kind``
    is ``Yes`` or ``No`` on every row of the live release, so "we hold rows and no cash
    row is among them" is a measurement, the same reading ``_in_kind_out`` makes.
    """
    facts = contribution_facts(db, release, registration_number, [year]).get(year)
    return facts is None or facts.cash_rows == 0


def _filed_figure(
    db: Session,
    registration_number: str,
    year: int,
    reported: ReportedTotalsContext | None,
    totals: str,
) -> tuple[Decimal | None, date | None]:
    """One filer-year's own filed figure and the date it runs to, or ``None`` twice.

    Rule 12's second number, for whichever side ``totals`` names. ``None`` when no
    filings snapshot is published, and also when the Board's totals route cannot speak
    for this filer-year, which happens for a special-election filer whose second report
    series the route does not return. §9.5 is explicit that those read "Not reported"
    rather than being compared, so a filer-year the copy cannot speak for must never
    reach a page as a figure.

    Reads only this committee and this year (``reported_totals_for``), or reuses the
    read the caller already made. Never the statewide sweep: answering about 1
    committee by building every filing in Minnesota is what made a committee page wait
    (#1966).
    """
    if reported is None:
        reported = filings.reported_totals_for(db, [registration_number], years=[year])
    if reported is None:
        return None, None
    filer_year = (registration_number, year)
    if filer_year in reported.special_election_filer_years:
        return None, None
    total = getattr(reported, totals).get(filer_year)
    if total is None:
        return None, None
    return total, reported.reported_through.get(filer_year)


def _reported_contributions(
    db: Session,
    registration_number: str,
    year: int,
    reported: ReportedTotalsContext | None = None,
) -> tuple[Decimal | None, date | None]:
    """The filer's own reported contribution figure, or ``None`` twice."""
    return _filed_figure(
        db, registration_number, year, reported, "reported_contributions"
    )


def _reported_expenditures(
    db: Session,
    registration_number: str,
    year: int,
    reported: ReportedTotalsContext | None = None,
) -> tuple[Decimal | None, date | None]:
    """The filer's own reported money-out total, or ``None`` twice.

    The same rule as ``_reported_contributions``, off the same filing.
    """
    return _filed_figure(
        db, registration_number, year, reported, "reported_expenditures"
    )


def _in_kind_out(
    db: Session, release: Release, registration_number: str, year: int
) -> Decimal:
    """How much of this filer-year's itemized money out was goods and services.

    **Only ever called once the caller knows it holds this filer-year's payment
    rows**, which is why a year the reader does not return reads as ``0`` here
    rather than as ``None``. Every payment row in the live release carries a ``Yes``
    or a ``No`` in the source's own ``In-kind?`` column, so "we hold 40 rows and
    none of them is in kind" is a measurement rather than silence. Called anywhere
    else this would manufacture a zero out of an absent filer-year, which is the
    thing `.claude/rules/grounded-answers.md` rule 12 forbids.

    The honest limit: a row whose ``In-kind?`` is blank counts as not-in-kind, the
    same reading ``contribution_cash`` takes on the other side. No such row exists
    in the live release, and the error it could cause is a figure too small, which
    a surface prints as nothing rather than as a wrong amount.
    """
    for entry in money_rows(db, release, registration_number, [year]).in_kind_out:
        if entry.year == year:
            return entry.total
    return Decimal("0")


def money_out(
    db: Session,
    release: Release,
    *,
    registration_number: str,
    year: int,
    reported: ReportedTotalsContext | None = None,
) -> MoneyOut:
    """Itemized payments out for one committee in one year.

    Every row counts. #1330's reader takes no label filter at all, which is how the
    trap is made unreachable rather than merely avoided: the same spending is labelled
    ``Campaign Expenditure`` by a candidate committee and ``General Expenditure`` by a
    party unit, so any single-label filter reports one kind of filer as having spent
    nothing (§2.1).

    ``reported`` is the same already-read filed figures ``money_in`` takes, and for the
    same reason: both numbers come off one filing, so one read serves both (#1966).
    """
    source_url = release.expenditures.source_url
    reported_total, reported_through = _reported_expenditures(
        db, registration_number, year, reported
    )
    # Read on every path, including the ones that carry no figure. A committee-year
    # we hold no rows for is exactly the case the check is sharpest about -- 17 of
    # the 208 disagreements in the live release hold nothing at all while the filing
    # itemizes money out -- so a state that skipped the lookup would drop the verdict
    # precisely where it matters most.
    checked = stated_spending_for_year(db, release, registration_number, year).status
    try:
        years = _money_out_rows(db, release, registration_number, year)
    except ReleaseNoLongerHeld:
        return MoneyOut(
            UNAVAILABLE,
            None,
            None,
            (),
            None,
            reported_total,
            reported_through,
            source_url,
            checked,
        )

    found = next((entry for entry in years if entry.year == year), None)
    if found is not None and any(
        bucket.rows_missing_an_amount for bucket in found.by_label
    ):
        # Rows we hold and cannot total: our gap, not the committee's silence.
        return MoneyOut(
            UNAVAILABLE,
            None,
            None,
            (),
            None,
            reported_total,
            reported_through,
            source_url,
            checked,
        )
    if found is None:
        return MoneyOut(
            _empty_state(db, release, Dataset.expenditures, year),
            None,
            None,
            (),
            None,
            reported_total,
            reported_through,
            source_url,
            checked,
        )
    return MoneyOut(
        REPORTED,
        found.total,
        found.rows,
        tuple(
            ExpenditureTypeTotal(bucket.label, bucket.total, bucket.rows)
            for bucket in found.by_label
        ),
        _in_kind_out(db, release, registration_number, year),
        reported_total,
        reported_through,
        source_url,
        checked,
    )


def independent_spending_about(
    db: Session, release: Release, *, committee: Committee, year: int
) -> IndependentSpendingAbout:
    """What others spent about this committee, through #1332's query.

    Deliberately the same query a legislator's profile runs, handed a registration
    number directly instead of one a person confirmed. Writing a second query here
    would put the honesty rules #1332 mutation-checked in two places, where only one
    of them would get fixed.

    This is money aimed **at** this committee, which is a different question from the
    reader's ``independent_spending_by`` -- money this filer *spent* about someone
    else. Both are real and they must not be confused: for the parties and caucuses
    the first is empty and the second is not.
    """
    source_url = release.independent_expenditures.source_url
    # The one block whose empty answer is a real 0, which is why it needs the year
    # check hardest: a 0 here is a published finding, so a year the download does not
    # reach would state "nobody spent anything about this committee" about a year
    # nobody has filed for. The check rides on the same statement as the figures
    # rather than costing a trip of its own, and ``None`` is the download not
    # reaching the year.
    spending = spending_for_committee_if_year_covered(
        db,
        registration_number=committee.registration_number,
        committee_name=committee.name,
        year=year,
        snapshot_id=release.independent_expenditures.snapshot_id,
    )
    if spending is None:
        return IndependentSpendingAbout(UNAVAILABLE, None, source_url)
    if spending.rows_missing_an_amount:
        # Rows we hold about this committee and cannot total: our gap, not a finding
        # about the committee. The same refusal `money_in` and `money_out` make, and
        # it matters more here, because this is the one block whose empty answer is a
        # real 0 -- so a short figure would read as a published finding (#1454).
        return IndependentSpendingAbout(UNAVAILABLE, None, source_url)
    return IndependentSpendingAbout(REPORTED, spending, source_url)


def committee_finance(
    db: Session, release: Release, *, registration_number: str, year: int
) -> CommitteeFinance | None:
    """One committee's money for one year, or ``None`` if we hold no record of it."""
    committee = find_committee(db, release, registration_number)
    if committee is None:
        return None
    # One narrowed read of this committee-year's own filing, shared by both cards:
    # money in and money out are 2 lines of the same filed report, so reading it twice
    # bought nothing and cost a second trip (#1966).
    reported = filings.reported_totals_for(db, [registration_number], years=[year])
    return CommitteeFinance(
        committee=committee,
        year=year,
        release_id=release.id,
        fetched_at=release.fetched_at,
        money_in=money_in(
            db,
            release,
            registration_number=registration_number,
            year=year,
            reported=reported,
        ),
        money_out=money_out(
            db,
            release,
            registration_number=registration_number,
            year=year,
            reported=reported,
        ),
        independent_spending=independent_spending_about(
            db, release, committee=committee, year=year
        ),
    )
