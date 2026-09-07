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

from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from alethical.api.services.independent_spending import (
    REPORTED,
    UNAVAILABLE,
    CommitteeSpending,
    spending_for_committee,
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

    ``fetched_at`` is the single freshness date §7 requires, and it is **not** the
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

    Issued as a statement rather than set on the engine or the session, deliberately.
    Production connects through Supabase's transaction pooler, where a *session*
    setting can outlive the client that set it and reach another request on the same
    backend connection -- the same hazard that makes a session-level advisory lock
    unsafe in ``alethical/pipeline/campaign_finance.py``. ``SET TRANSACTION`` is scoped
    to this transaction by definition and ends with it. Verified against production's
    pooler on 12 Aug 2026: the default is ``read committed``, this makes it
    ``repeatable read``, and the next transaction on that pooled connection is back to
    ``read committed``.

    Must be the first statement in the transaction; Postgres refuses it once a
    statement has run, so callers call it before resolving anything.
    """
    db.execute(text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ"))


def current_release(db: Session) -> Release | None:
    """The published release and its 3 snapshots, resolved in one statement.

    #1330's resolver, not a second one: it reads the pointer, the release and all 3
    snapshots together, carries each snapshot's published row count so staleness can
    be told from emptiness, and refuses outright when a published release names a
    snapshot that is no longer loaded.

    ``None`` means nothing is published, which is a fact about us and a real state on
    a fresh database.
    """
    return reader.live_release(db)


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
    """
    source_url = release.contributions.source_url
    reported_total, reported_through = _reported_contributions(
        db, registration_number, year, reported
    )
    # The Board's own calendars print a start against this period end; a filer-year
    # the totals copy speaks for is never a special-election one, so the printed
    # start applies where one exists. ``None`` stays the covers-through state.
    period_start = (
        printed_period_start_for_end(reported_through)
        if reported_through is not None
        else None
    )
    try:
        years = reader.money_in(db, release, registration_number, years=[year])
    except ReleaseNoLongerHeld:
        return MoneyIn(UNAVAILABLE, None, None, (), None, None, None, source_url)

    found = next((entry for entry in years if entry.year == year), None)
    if found is None:
        return MoneyIn(
            _empty_state(db, release, Dataset.contributions, year),
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
            _empty_state(db, release, Dataset.contributions, year),
            None,
            None,
            others,
            reported_total,
            reported_through,
            period_start,
            source_url,
        )
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
    for entry in reader.expenditure_in_kind(
        db, release, registration_number, years=[year]
    ):
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
        years = reader.money_out(db, release, registration_number, years=[year])
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
    # nobody has filed for.
    if not _covers_year(db, release, Dataset.independent_expenditures, year):
        return IndependentSpendingAbout(UNAVAILABLE, None, source_url)
    spending = spending_for_committee(
        db,
        registration_number=committee.registration_number,
        committee_name=committee.name,
        year=year,
        snapshot_id=release.independent_expenditures.snapshot_id,
    )
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
