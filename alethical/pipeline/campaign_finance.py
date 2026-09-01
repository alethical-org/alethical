"""Load Minnesota's campaign-finance downloads as dated snapshots that replace, not merge.

Net: download the Board's 3 "All" files whole, keep each download's exact bytes,
check the new set against the one already published, and publish by replacing the
previous set entirely. Never merge rows into an existing table.

Why this shape rather than the per-record upsert every other source here uses:
Minnesota publishes **no per-transaction identifier**, and two payments can be
legitimately identical — same donor, same day, same amount. A single official
download contains 20,524 rows identical to another row, one of them repeated 119
times. So no key built from a row's contents can tell a genuine repeat payment
apart from a re-import of the same row, and merging cannot be made correct; it can
only be made careful, which is what failed in the system this replaces (241,258 of
its 954,188 money rows repeat another row's fingerprint). Full reasoning:
``docs/architecture/campaign-finance-system-design.md`` §4 (Ingestion: snapshot and
replace).

The cycle, and the reason each step sits where it does:

1. **Resolve the 3 download links from the landing page, every run.** The numbers
   are signed and all 3 we want are negative, so a ``\\d+`` pattern silently
   resolves a different file.
2. **Stream each download to a temporary file, hashing the response bytes.**
   Nothing in the response says it arrived whole: there is no ``Content-Length``,
   transfer is chunked, and a ``Range`` request is ignored. Worse, a stale download
   number answers **HTTP 200 with a 39 KB HTML error page** typed
   ``application/octet-stream``, so 2 content checks are what catch a wrong file —
   the ``Content-Disposition`` filename and an exact match on the header line.
3. **Parse, type and measure in one streaming pass**, writing no database rows yet.
   This pass also produces the record-set hash the next step needs.
4. **Store the bytes and record the fetch, and commit that, before validating
   anything.** A failure record written inside the transaction that later fails
   rolls back with it, which quietly turns "the bad download is retained" into
   "the bad download is gone".
5. **Compare record sets.** All 3 unchanged means nothing to publish. The run still
   records a fetch observation per dataset, because the record of *what we checked
   and when* grows even when the published data does not.
6. **Validate** against the measurements of the live release's snapshots. A
   snapshot that fails is left ``quarantined`` with its reason and its bytes, and
   nothing is published.
7. **Publish in one transaction**: copy the rows in, name the 3 snapshots as a
   release, take the pointer row with ``FOR UPDATE``, re-check, and move it.
8. **Prune in a separate transaction** afterwards. A crash there leaves extra
   rows, which is harmless and self-correcting.

**"Did the data change" is decided on the records, not on the bytes, because this
source shuffles.** Fetching the same file 3 times seconds apart returns 3 different
sha256 hashes at an identical byte size, holding an identical set of records in a
different order: measured 11 Aug 2026 on the independent-expenditures file (41,130
records, 35,905 of the 41,130 positions differing) and on the contributions file
(583,152 records, 511,066 positions differing). So each snapshot carries an
order-independent hash of its records alongside the hash of the bytes we kept, and
one body is stored per distinct record set rather than per download. Keyed on the
bytes alone, every run would look like a new file, publish a new release, renumber
every row, and prune the set it had just replaced.

Two things a reader of this data must know, and the second one has a limit worth
stating exactly. A request must **resolve one release id and use it for all 3
datasets**: each statement sees the newest committed state, so re-resolving "the
live release" per query can hand back a mixed set. Safest is to resolve the pointer,
the release and the rows in a single statement, or in one explicitly repeatable-read
transaction.

And **the rows of a superseded release survive exactly one further publish**, then
go. That covers a request that resolved a release moments before a publish, which is
the realistic case, because a publish is a person running a command and the 3
downloads alone take about 90 seconds. It does **not** cover 2 publishes landing
inside one request: a reader holding the release from before both of them finds no
rows, and a page that renders that as "this committee has no payments" is exactly the
missing-versus-zero failure `.claude/rules/grounded-answers.md` rule 12 forbids. So
re-resolve rather than caching an id, and treat "0 rows for a release id that exists"
as stale, never as an answer about a person.
"""

from __future__ import annotations

import csv
import gzip
import hashlib
import html
import os
import re
import shutil
import tempfile
import time
import uuid
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any, Iterable, Optional

import requests
from sqlalchemy import delete, func, inspect, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from alethical.db import models as schema
from alethical.pipeline.campaign_finance_filings import filings_context
from alethical.pipeline.campaign_finance_stated_split import stated_split_coverage
from alethical.pipeline.http_text import response_text
from alethical.pipeline.legislator_committee_match import (
    ConfirmedLink,
    FilerRecord,
    RosterMember,
    read_contributions_csv,
    recheck_confirmed_links,
)
from alethical.pipeline.raw_file_store import sha256_of_file

Dataset = schema.CampaignFinanceDataset
SnapshotStatus = schema.CampaignFinanceSnapshotStatus
ReleaseStatus = schema.CampaignFinanceReleaseStatus

LANDING_PAGE = (
    "https://cfb.mn.gov/reports-and-data/self-help/data-downloads/campaign-finance/"
)
USER_AGENT = "Alethical Campaign Finance Ingest/0.1 (+https://alethical.com)"
# The 3 files are 82.6 MB, 67.1 MB and 9.1 MB over a chunked transfer.
DOWNLOAD_TIMEOUT_SECONDS = 600
LANDING_PAGE_TIMEOUT_SECONDS = 60
# The contributions download answered HTTP 500 once on 11 Aug 2026 and succeeded
# on the next attempt from the same unchanged link, so a server error is a retry
# rather than a moved link. The content checks are what tell a genuinely wrong
# file from a bad minute.
MAX_ATTEMPTS = 3
RETRY_PAUSE_SECONDS = 5
COPY_CHUNK_BYTES = 1 << 20

# One key for the whole publish, so two overlapping imports queue instead of
# colliding. Transaction-scoped: production connects through Supabase's
# transaction pooler, where a session-level lock can outlive the client that took
# it and is never safe.
PUBLISH_LOCK_KEY = 610312263010

# How many superseded releases keep their rows after being replaced. One, so a
# request that resolved the previous release a moment before a publish still finds
# its rows instead of an empty page (see prune()). Measured cost on the full
# 11 Aug 2026 set: 241 MB per generation (193 MB of rows, 48 MB of indexes)
# against 8 GB of database disk with about 3 GB already used.
KEEP_SUPERSEDED_GENERATIONS = 1

ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
FOUR_DIGIT_YEAR = re.compile(r"^\d{4}$")
# `-?\d+`, never `\d+`: the download numbers are signed and all 3 we want are
# negative, so a pattern that drops the minus sign resolves a different file.
DOWNLOAD_LINK = re.compile(r'href="([^"]*\?download=(-?\d+))"')
TAG = re.compile(r"<[^>]+>")

MAX_REPORTED_ROW_ERRORS = 5

# The one value in the contributions file's "Receipt type" column that belongs in a
# contribution total. The other 3 -- Miscellaneous, Miscellaneous Income and Loan
# Payable -- are 1.2% of the rows and the filing reports each on its own schedule.
CONTRIBUTION_RECEIPT_TYPE = "Contribution"


# --- What each file looks like ----------------------------------------------
#
# The header line is pinned here as a contract in code rather than taken from the
# previous snapshot, because a header learned from the first import makes one bad
# first import the permanent standard. A test asserts each pinned header line
# parses to exactly this column list, so the two can never drift apart.


@dataclass(frozen=True)
class Column:
    source: str
    attribute: str
    # "text" keeps the value exactly as printed; "money" is numeric(18,4);
    # "date" must be a real calendar date; "year" is the file's own Year claim.
    kind: str = "text"


def _text(*pairs: tuple[str, str]) -> tuple[Column, ...]:
    return tuple(Column(source, attribute) for source, attribute in pairs)


CONTRIBUTION_COLUMNS: tuple[Column, ...] = (
    *_text(
        ("Recipient reg num", "recipient_reg_num"),
        ("Recipient", "recipient"),
        ("Recipient type", "recipient_type"),
        ("Recipient subtype", "recipient_subtype"),
    ),
    Column("Amount", "amount", "money"),
    Column("Receipt date", "receipt_date", "date"),
    Column("Year", "year", "year"),
    *_text(
        ("Contributor", "contributor"),
        ("Contrib Reg Num", "contrib_reg_num"),
        ("Contrib type", "contrib_type"),
        ("Receipt type", "receipt_type"),
        ("In kind?", "in_kind"),
        ("In-kind descr", "in_kind_descr"),
        ("Contrib zip", "contrib_zip"),
        ("Contrib Employer name", "contrib_employer_name"),
    ),
)

EXPENDITURE_COLUMNS: tuple[Column, ...] = (
    *_text(
        ("Committee reg num", "committee_reg_num"),
        ("Committee name", "committee_name"),
        ("Entity type", "entity_type"),
        ("Entity sub-type", "entity_sub_type"),
        ("Vendor name", "vendor_name"),
        ("Vendor city", "vendor_city"),
        ("Vendor state", "vendor_state"),
        ("Vendor zip", "vendor_zip"),
    ),
    Column("Amount", "amount", "money"),
    Column("Unpaid amount", "unpaid_amount", "money"),
    Column("Date", "transaction_date", "date"),
    Column("Purpose", "purpose"),
    Column("Year", "year", "year"),
    *_text(
        ("Type", "type"),
        ("In-kind descr", "in_kind_descr"),
        ("In-kind?", "in_kind"),
        ("Affected committee name", "affected_committee_name"),
        ("Affected committee reg num", "affected_committee_reg_num"),
    ),
)

INDEPENDENT_COLUMNS: tuple[Column, ...] = (
    *_text(
        ("Spender", "spender"),
        ("Spender Reg Num", "spender_reg_num"),
        ("Spender type", "spender_type"),
        ("Spender sub-type", "spender_sub_type"),
        # The file abbreviates these two; the table spells them out so the same
        # fact reads the same way as on the expenditures table.
        ("Affected Comte Name", "affected_committee_name"),
        ("Affected Cmte Reg Num", "affected_committee_reg_num"),
        ("For /Against", "for_against"),
    ),
    Column("Year", "year", "year"),
    Column("Date", "transaction_date", "date"),
    Column("Type", "type"),
    Column("Amount", "amount", "money"),
    Column("Unpaid amount", "unpaid_amount", "money"),
    *_text(
        ("In kind?", "in_kind"),
        ("In kind descr", "in_kind_descr"),
        ("Purpose", "purpose"),
        ("Vendor name", "vendor_name"),
        ("Vendor city", "vendor_city"),
        ("Vendor State", "vendor_state"),
        ("Vendor zip", "vendor_zip"),
    ),
)


@dataclass(frozen=True)
class DatasetSpec:
    dataset: Dataset
    # Matched against the <h1> above each table on the landing page, lowercased.
    heading: str
    # Must appear in the download's Content-Disposition filename.
    disposition_marker: str
    header_line: str
    columns: tuple[Column, ...]
    table: type
    filer_attribute: str
    # The second registration number on a row: who the money came from on a
    # contribution, and which committee a payment was about on the other 2 files.
    # Kept apart from ``filer_attribute`` because the two are different populations
    # and only the filer is a Minnesota registrant by definition — a contributor may
    # be a federal committee the Board's directory has never heard of, so counting
    # both together would make an unknown-number check unreadable.
    counterparty_attribute: Optional[str] = None

    @property
    def key(self) -> str:
        return self.dataset.value

    @property
    def attributes(self) -> tuple[str, ...]:
        return tuple(column.attribute for column in self.columns)


DATASETS: tuple[DatasetSpec, ...] = (
    DatasetSpec(
        dataset=Dataset.contributions,
        heading="itemized contributions received of over $200",
        disposition_marker="Itemized Contributions Received",
        header_line=(
            '"Recipient reg num",Recipient,"Recipient type","Recipient subtype",'
            'Amount,"Receipt date",Year,Contributor,"Contrib Reg Num",'
            '"Contrib type","Receipt type","In kind?","In-kind descr",'
            '"Contrib zip","Contrib Employer name"'
        ),
        columns=CONTRIBUTION_COLUMNS,
        table=schema.CampaignFinanceContributionRow,
        filer_attribute="recipient_reg_num",
        counterparty_attribute="contrib_reg_num",
    ),
    DatasetSpec(
        dataset=Dataset.expenditures,
        heading="itemized general expenditures and contributions made of over $200",
        disposition_marker="Itemized General Expenditures",
        header_line=(
            '"Committee reg num","Committee name","Entity type","Entity sub-type",'
            '"Vendor name","Vendor city","Vendor state","Vendor zip",Amount,'
            '"Unpaid amount",Date,Purpose,Year,Type,"In-kind descr",In-kind?,'
            '"Affected committee name","Affected committee reg num"'
        ),
        columns=EXPENDITURE_COLUMNS,
        table=schema.CampaignFinanceExpenditureRow,
        filer_attribute="committee_reg_num",
        counterparty_attribute="affected_committee_reg_num",
    ),
    DatasetSpec(
        dataset=Dataset.independent_expenditures,
        heading="itemized independent expenditures of over $200",
        disposition_marker="Itemized Independent Expenditures",
        header_line=(
            'Spender,"Spender Reg Num","Spender type","Spender sub-type",'
            '"Affected Comte Name","Affected Cmte Reg Num","For /Against",Year,'
            'Date,Type,Amount,"Unpaid amount","In kind?","In kind descr",Purpose,'
            '"Vendor name","Vendor city","Vendor State","Vendor zip"'
        ),
        columns=INDEPENDENT_COLUMNS,
        table=schema.CampaignFinanceIndependentExpenditureRow,
        filer_attribute="spender_reg_num",
        counterparty_attribute="affected_committee_reg_num",
    ),
)

SPEC_BY_DATASET: dict[Dataset, DatasetSpec] = {spec.dataset: spec for spec in DATASETS}

RELEASE_SNAPSHOT_COLUMN: dict[Dataset, str] = {
    Dataset.contributions: "contributions_snapshot_id",
    Dataset.expenditures: "expenditures_snapshot_id",
    Dataset.independent_expenditures: "independent_expenditures_snapshot_id",
}


# --- How much movement is too much ------------------------------------------
#
# These bands are a guess and are stated as one. They come from a single day's
# observation: the contributions file held 583,120 rows on 10 August 2026 and
# 583,152 on 11 August, a rise of 0.005%. They tighten once there are a few weeks
# of real day-to-day deltas. Growth quarantines as well as shrinkage, because a
# file duplicated end to end would publish roughly twice the money and it passes
# every check that only watches for a fall.


@dataclass(frozen=True)
class Band:
    shrink: float
    growth: float

    def contains(self, candidate: float, baseline: float) -> bool:
        if baseline <= 0:
            return True
        ratio = candidate / baseline
        return (1 - self.shrink) <= ratio <= (1 + self.growth)


ROW_COUNT_BAND = Band(shrink=0.005, growth=0.05)
BYTE_SIZE_BAND = Band(shrink=0.01, growth=0.08)
AMOUNT_SUM_BAND = Band(shrink=0.01, growth=0.10)
# Rows that repeat another row exactly are ordinary here, so what matters is the
# share of them moving: that is what catches rows being swapped for copies of
# other rows while the count and the total both stay put.
REPEAT_FRACTION_TOLERANCE = 0.01
# Past years are nearly static, so a year losing rows is the sharpest truncation
# signal there is. The floor keeps a year holding a handful of rows from tripping
# on normal noise.
YEAR_ROW_LOSS_FRACTION = 0.01
YEAR_ROW_LOSS_FLOOR = 25


# --- Results ----------------------------------------------------------------


@dataclass
class Check:
    name: str
    # "passed" | "failed" | "not_run" | "overridden" | "reported".
    # "reported" is a check that ran and answers per filer-year rather than for the
    # whole load, so it never blocks: #1433's split comparison is the only one, and
    # Eugene ruled on 12 Aug 2026 that a committee whose 2 official figures disagree
    # withholds its own split while every other committee publishes.
    status: str
    detail: str
    # The filer-years this check found fault with, as "<registration>:<year>". Recorded
    # separately from the prose because a surface has to act on it: §7 says a
    # filer-year that fails this check does not publish its split, and picking that out
    # of a sentence is not something a page can do.
    filer_years: tuple[str, ...] = ()

    @property
    def blocks_publication(self) -> bool:
        return self.status == "failed"

    def as_json(self) -> dict:
        recorded: dict = {
            "name": self.name,
            "status": self.status,
            "detail": self.detail,
        }
        if self.filer_years:
            recorded["filer_years"] = list(self.filer_years)
        return recorded


@dataclass
class Measurements:
    row_count: int = 0
    # A hash over this file's records, sorted, so row order cannot change it. This
    # is what "did the data change" is decided on, because the Board's export is
    # byte-unstable (see the module docstring). Empty until the file parses.
    record_set_hash: str = ""
    column_names: list[str] = field(default_factory=list)
    amount_sum: Decimal = Decimal("0")
    negative_amount_sum: Decimal = Decimal("0")
    blank_date_count: int = 0
    distinct_row_count: int = 0
    distinct_filer_count: int = 0
    rows_by_year: dict[str, int] = field(default_factory=dict)
    blank_counts_by_column: dict[str, int] = field(default_factory=dict)
    malformed_quote_record_count: int = 0
    errors: list[str] = field(default_factory=list)
    # The registration numbers themselves, not just how many, because §4.3's second
    # check needs to ask whether each one names a filer Minnesota has registered.
    # Kept as sets rather than counted, which costs a few thousand short strings
    # against the 583,152 rows already being read.
    filer_numbers: set[str] = field(default_factory=set)
    counterparty_numbers: set[str] = field(default_factory=set)
    # And the same numbers split by the row's year, because the check that reads them
    # can only be asked of recent years. The directory lists *current* registrants, so
    # a filer who deregistered in 2016 is legitimately absent: measured 12 Aug 2026 on
    # the contributions file, 47.9% of 2015's filers are unknown to today's directory
    # against 6.5% of 2025's and 0.7% of 2026's. A check over every year would be
    # reporting how long ago the file starts.
    filer_numbers_by_year: dict[int, set[str]] = field(default_factory=dict)
    # Contributions only: what our itemized rows add up to per filer per year, split
    # by whether the payment was cash or in kind. This is the left-hand side of the
    # reconciliation against the Board's own reported total (#1408), and it is
    # measured during the parse for the same reason everything else here is — the
    # file is read once, before any row is written, so a set can be refused before
    # it lands rather than after.
    #
    # **In-kind is kept apart because the reported figure excludes it.** Measured on
    # 12 Aug 2026 across 389 comparable filer-years: adding in-kind rows in makes our
    # sum exceed the Board's own figure on 24 of them against 15 on cash alone, so
    # folding the two together would manufacture 9 failures out of a difference the
    # filing itself reports separately.
    contribution_cash_by_filer_year: dict[tuple[str, int], Decimal] = field(
        default_factory=dict
    )
    contribution_in_kind_by_filer_year: dict[tuple[str, int], Decimal] = field(
        default_factory=dict
    )
    # The same cash sums, counting only payments dated on or before the date the
    # Board's own figure for that filer-year runs to. **This is the only sum the
    # reconciliation may use**, because the itemized download runs ahead of the
    # figure: filer 18336's 2026 figure covers through 31 March while our rows for it
    # run to 20 July, and $321,870.52 of its cash contributions are dated after the
    # figure's own coverage end. Comparing the year's whole sum against a figure that
    # stops in March is not a failed reconciliation, it is a comparison of two
    # different periods.
    contribution_cash_through_cutoff: dict[tuple[str, int], Decimal] = field(
        default_factory=dict
    )
    contribution_rows_after_cutoff: int = 0
    contribution_cash_after_cutoff: Decimal = Decimal("0")
    contribution_rows_without_a_date: int = 0

    @property
    def repeat_fraction(self) -> float:
        if self.row_count <= 0:
            return 0.0
        return 1 - (self.distinct_row_count / self.row_count)


@dataclass
class FetchedFile:
    spec: DatasetSpec
    download_id: str
    requested_url: str
    final_url: str
    path: str
    byte_size: int
    content_hash: str
    disposition_filename: Optional[str]
    response_headers: dict[str, str]
    started_at: datetime
    completed_at: datetime
    content_error: Optional[str] = None


@dataclass
class DatasetOutcome:
    spec: DatasetSpec
    fetched: FetchedFile
    # Minted before the parse so the COPY file can carry it. Becomes the snapshot's
    # real id when these records are new, and is discarded when they are not.
    candidate_snapshot_id: uuid.UUID = field(default_factory=uuid.uuid4)
    snapshot_id: Optional[uuid.UUID] = None
    measurements: Optional[Measurements] = None
    checks: list[Check] = field(default_factory=list)
    unchanged: bool = False
    reused_rows: bool = False
    copy_path: Optional[str] = None

    @property
    def blocked(self) -> list[Check]:
        return [check for check in self.checks if check.blocks_publication]

    @property
    def copy_file_matches_snapshot(self) -> bool:
        """Whether this run's COPY file can be loaded as it stands.

        It can only when the snapshot is the one this run created. If the records
        matched a snapshot from an earlier run, the row numbers in this file belong
        to a different shuffle of the same records than the bytes we retained, so
        loading them would make a citation point at the wrong line of the kept file.
        """
        return self.snapshot_id == self.candidate_snapshot_id


@dataclass
class LoadReport:
    outcomes: list[DatasetOutcome] = field(default_factory=list)
    release_id: Optional[uuid.UUID] = None
    published: bool = False
    no_change: bool = False
    dry_run: bool = False
    pruned_snapshots: int = 0
    pruned_rows: int = 0
    refusal: Optional[str] = None
    # A person-confirmed legislator-to-committee link (#1354) that no longer agrees with
    # the Board's own data, one already-formatted line each. Never blocks this load and
    # never repairs anything -- a contradiction wants a person's eyes (#1398). Empty on
    # every run until a link is actually confirmed, which is a pass, not a failure.
    committee_link_contradictions: list[str] = field(default_factory=list)

    @property
    def quarantined(self) -> list[DatasetOutcome]:
        return [outcome for outcome in self.outcomes if outcome.blocked]

    def reconciliation_line(self) -> str:
        """What a published set has and has not been checked against, in one line.

        Written for the operator reading the end of a run rather than as a summary of
        the checks above, and it deliberately names the remaining gap every time. A
        released set that reads as fully checked is worse than one that says where it
        stops.
        """
        found = self._check("reported_totals_reconcile")
        if found is None or found.status == "not_run":
            return "not reconciled against Minnesota's own figures: " + (
                found.detail if found else "the check did not run"
            )
        return (
            f"reconciled against Minnesota's own figures ({found.detail}). "
            + self._stated_split_line()
        )

    def _stated_split_line(self) -> str:
        """Whether the half that catches our rows being SHORT has run on these records.

        Named separately because it is the gap this line used to state unconditionally,
        and #1433 built the thing that closes it. The gap is now conditional: it is open
        until someone runs the comparison over this record set, and it is genuinely
        closed after that.
        """
        split = self._check("reported_itemized_split_matches_ours")
        if split is None or split.status == "not_run":
            return (
                "Not yet compared against each filing's own itemized subtotal, so our "
                "rows being SHORT for a committee would still read as small-donor "
                "money: " + (split.detail if split else "the check did not run")
            )
        return f"Compared against each filing's own itemized subtotal: {split.detail}"

    def _check(self, name: str) -> Optional[Check]:
        return next(
            (
                check
                for outcome in self.outcomes
                for check in outcome.checks
                if check.name == name
            ),
            None,
        )

    def summary(self) -> str:
        lines: list[str] = []
        for outcome in self.outcomes:
            measured = outcome.measurements
            rows = f"{measured.row_count:,} rows" if measured else "not parsed"
            state = (
                "unchanged"
                if outcome.unchanged
                else ("quarantined" if outcome.blocked else "ready")
            )
            lines.append(
                f"  {outcome.spec.key}: {state}, {rows}, "
                f"{outcome.fetched.byte_size:,} bytes"
            )
            # The record-set hash in full, because it is what an operator passes to
            # --publish-hashes and a truncated one would silently not match. The byte
            # hash sits beside it as the identity of the download itself.
            lines.append(
                f"      records {measured.record_set_hash or '(unparsed)'}"
                if measured
                else "      records (unparsed)"
            )
            lines.append(f"      bytes   {outcome.fetched.content_hash}")
            for check in outcome.checks:
                if check.status in (
                    "failed",
                    "not_run",
                    "overridden",
                    "reported",
                ):
                    lines.append(f"      {check.status}: {check.name} — {check.detail}")
        if self.refusal:
            lines.append(f"  refused: {self.refusal}")
        elif self.dry_run:
            lines.append("  dry run: nothing was written")
        elif self.no_change:
            lines.append("  no change: the published set already holds these 3 files")
        elif self.published:
            lines.append(f"  published release {self.release_id}")
            lines.append(
                f"  pruned {self.pruned_rows:,} rows from "
                f"{self.pruned_snapshots} superseded snapshot(s)"
            )
            # Said once, at the end, where an operator reads the outcome — not only
            # buried 3 times among the per-file lines above. What it says has changed
            # since #1408: the per-filer reconciliation now runs, so the line reports
            # what it concluded and what is still not compared, rather than announcing
            # a check that did not exist.
            lines.append(f"  {self.reconciliation_line()}")
        else:
            lines.append("  nothing published")
        if self.committee_link_contradictions:
            # Deliberately never gated on `self.refusal`/`self.published` above: a
            # contradiction here says nothing about whether the money data this run
            # published is correct, and it must never be read as the load having failed.
            # It is set apart with its own banner precisely so it is not one more line
            # lost among the ones above it (#1398).
            lines.append("")
            lines.append("=" * 70)
            lines.append(
                f"NEEDS A PERSON: {len(self.committee_link_contradictions)} confirmed "
                "legislator-to-committee link(s) no longer agree with the Board's own "
                "data. Nothing was changed automatically."
            )
            lines.extend(f"  {line}" for line in self.committee_link_contradictions)
            lines.append("=" * 70)
        return "\n".join(lines)


class CampaignFinanceRefusal(RuntimeError):
    """Raised when the run must stop without publishing."""


# --- Step 1: resolve the links ----------------------------------------------


def _strip_tags(fragment: str) -> str:
    return html.unescape(TAG.sub(" ", fragment)).strip()


@dataclass(frozen=True)
class ResolvedDownload:
    dataset: Dataset
    download_id: str
    url: str


def resolve_downloads(
    http: requests.Session, landing_page: str = LANDING_PAGE
) -> dict[Dataset, ResolvedDownload]:
    """Find each dataset's "All" download on the Board's landing page.

    Resolved from the page's own labels every run — the ``<h1>`` naming the
    dataset and the row whose first cell reads "All" — rather than from a saved
    number or a position. The page offers 23 files, 3 datasets across 8 filer
    categories, and the 3 "All" files contain every row of the other 20.

    Fails loudly when a dataset yields no match or more than one. A renamed
    heading has to break the run: silently resolving a different file is the one
    failure this whole module is built to prevent.
    """
    response = http.get(landing_page, timeout=LANDING_PAGE_TIMEOUT_SECONDS)
    response.raise_for_status()
    page = response_text(response)

    found: dict[Dataset, list[ResolvedDownload]] = {
        spec.dataset: [] for spec in DATASETS
    }
    for section in re.split(r"<h1[^>]*>", page)[1:]:
        heading, _, body = section.partition("</h1>")
        title = _strip_tags(heading).lower()
        matched = [spec for spec in DATASETS if spec.heading in title]
        if not matched:
            continue
        for row in re.findall(r"<tr[^>]*>(.*?)</tr>", body, re.S):
            cells = re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row, re.S)
            if not cells or _strip_tags(cells[0]).lower() != "all":
                continue
            link = DOWNLOAD_LINK.search(row)
            if not link:
                continue
            url = requests.compat.urljoin(landing_page, html.unescape(link.group(1)))
            for spec in matched:
                found[spec.dataset].append(
                    ResolvedDownload(spec.dataset, link.group(2), url)
                )

    resolved: dict[Dataset, ResolvedDownload] = {}
    for spec in DATASETS:
        matches = found[spec.dataset]
        if len(matches) != 1:
            raise CampaignFinanceRefusal(
                f"Expected exactly 1 'All' download for {spec.key} under a heading "
                f"containing {spec.heading!r} on {landing_page}, found "
                f"{len(matches)}. The page's labels have changed, so refusing to "
                "guess which file is which."
            )
        resolved[spec.dataset] = matches[0]
    return resolved


# --- Step 2: fetch, and prove it is the right file ---------------------------


def fetch_download(
    http: requests.Session,
    spec: DatasetSpec,
    resolved: ResolvedDownload,
    directory: str,
) -> FetchedFile:
    """Stream one download to disk, hashing the response bytes as they arrive.

    The hash is of the *bytes*, never of decoded text: the ``content_hash`` helper
    in ``minnesota.py`` takes a ``str`` and must not be reused for file identity.

    Two content checks, because the response itself cannot tell you the file
    arrived: a stale download number answers HTTP 200 with an HTML error page
    typed ``application/octet-stream``, with no ``Content-Length``, over a chunked
    transfer that ignores ``Range``. A failure here is recorded on the returned
    object rather than raised, so the bytes are still retained for diagnosis.
    """
    last_error: Optional[Exception] = None
    for attempt in range(1, MAX_ATTEMPTS + 1):
        started_at = datetime.now(UTC)
        path = os.path.join(directory, f"{spec.key}.csv")
        try:
            response = http.get(
                resolved.url, timeout=DOWNLOAD_TIMEOUT_SECONDS, stream=True
            )
            if response.status_code >= 500:
                response.close()
                raise requests.HTTPError(
                    f"{resolved.url} answered HTTP {response.status_code}"
                )
            response.raise_for_status()
            digest = hashlib.sha256()
            byte_size = 0
            with open(path, "wb") as handle:
                for chunk in response.iter_content(chunk_size=COPY_CHUNK_BYTES):
                    if not chunk:
                        continue
                    digest.update(chunk)
                    byte_size += len(chunk)
                    handle.write(chunk)
            completed_at = datetime.now(UTC)
            headers = {key: value for key, value in response.headers.items()}
            response.close()
        except (requests.RequestException, OSError) as error:
            last_error = error
            if attempt < MAX_ATTEMPTS:
                time.sleep(RETRY_PAUSE_SECONDS)
                continue
            raise CampaignFinanceRefusal(
                f"Could not download {spec.key} from {resolved.url} after "
                f"{MAX_ATTEMPTS} attempts: {error}"
            ) from error

        fetched = FetchedFile(
            spec=spec,
            download_id=resolved.download_id,
            requested_url=resolved.url,
            final_url=response.url,
            path=path,
            byte_size=byte_size,
            content_hash=digest.hexdigest(),
            disposition_filename=_disposition_filename(headers),
            response_headers=headers,
            started_at=started_at,
            completed_at=completed_at,
        )
        fetched.content_error = _content_error(spec, fetched)
        return fetched

    raise CampaignFinanceRefusal(  # pragma: no cover - the loop always returns or raises
        f"Could not download {spec.key}: {last_error}"
    )


def _disposition_filename(headers: dict[str, str]) -> Optional[str]:
    disposition = headers.get("Content-Disposition") or ""
    match = re.search(r'filename="?([^"]+)"?', disposition)
    return match.group(1) if match else None


def _content_error(spec: DatasetSpec, fetched: FetchedFile) -> Optional[str]:
    name = fetched.disposition_filename or ""
    if spec.disposition_marker not in name:
        return (
            f"The download did not name the {spec.key} file "
            f"(Content-Disposition filename: {name!r}). A stale download number "
            "answers HTTP 200 with an HTML error page, so this is refused."
        )
    try:
        # utf-8-sig, so a byte-order mark the Board might add one day is a
        # cosmetic difference rather than a header mismatch. The identity hash is
        # of the raw bytes, so nothing about the file's identity changes here.
        with open(fetched.path, encoding="utf-8-sig", newline="") as handle:
            first_line = handle.readline().rstrip("\r\n")
    except (OSError, UnicodeDecodeError) as error:
        return f"Could not read the first line of the {spec.key} download: {error}"
    if first_line != spec.header_line:
        return (
            f"The {spec.key} download's first line is not the expected column "
            f"header. Got {first_line[:160]!r}"
        )
    return None


# --- Step 5: parse, type and measure in one pass -----------------------------


def _blank(value: str) -> bool:
    return value.strip() == ""


def parse_and_measure(
    spec: DatasetSpec,
    source_path: str,
    snapshot_id: uuid.UUID,
    copy_path: str,
    contribution_cutoffs: Optional[dict[tuple[str, int], date]] = None,
) -> Measurements:
    """Read the file once: type every value, measure it, and write the COPY file.

    ``contribution_cutoffs`` maps a filer-year to the date the Board's own figure for
    it runs to, read from the published filings snapshot (#1408). It is passed in
    rather than applied afterwards so the bounded sums are built in the one streaming
    pass, which keeps the reconciliation a check that runs **before** any row is
    written. Absent, the bounded sums are simply not built and the reconciliation
    reports itself as not run.

    Parsed with Python's **default** ``csv`` reader and nothing else, because the
    Board's files are not valid CSV and every other setting loses real money. It
    escapes an inner double quote with a backslash, which RFC 4180 does not allow
    (``"Amazon.com, 1.5\\" Micro Rod"``), and in the expenditures file the same 2
    characters also appear where the backslash is literal data and the quote
    genuinely closes the field — so no mechanical rule reads both correctly.
    Measured on the 11 Aug 2026 files: ``strict=True`` rejects 18 contribution and
    17 expenditure records of real money, ``escapechar="\\\\"`` damages 608 rows
    across the 3 files to fix 35, and substituting ``\\"`` for ``""`` destroys 42
    expenditure records. The default reader is the only setting that keeps every
    row with every field in its right column. The cost is a stray backslash or
    trailing quote inside one free-text field on 35 records, which never reaches a
    name, amount, date, registration number or zip — so those records are counted,
    not repaired.

    Because of that, a parse error can never be the truncation guard. §4.3's count
    and size bands are all there is.
    """
    measured = Measurements(column_names=[column.source for column in spec.columns])
    fingerprints: list[bytes] = []
    filers = measured.filer_numbers
    expected = len(spec.columns)
    blanks = {column.source: 0 for column in spec.columns}
    years: dict[str, int] = {}
    sources = [column.source for column in spec.columns]
    # Positions in the typed row, which starts with the snapshot id and the record
    # number, so a source column at index i lands at i + 2.
    amount_at = 2 + sources.index("Amount")
    year_at = 2 + next(
        index for index, column in enumerate(spec.columns) if column.kind == "year"
    )
    filer_at = next(
        index
        for index, column in enumerate(spec.columns)
        if column.attribute == spec.filer_attribute
    )
    counterparty_at = _column_index(spec, spec.counterparty_attribute)
    # Contributions only. On the other 2 files there is no receipt type to filter on
    # and no reported contributions figure to compare against, so both stay None and
    # the per-filer-year sums below are simply never built.
    receipt_type_at = _column_index(
        spec, "receipt_type" if spec.dataset is Dataset.contributions else None
    )
    in_kind_at = _column_index(
        spec, "in_kind" if spec.dataset is Dataset.contributions else None
    )
    receipt_date_at = next(
        (
            2 + index
            for index, column in enumerate(spec.columns)
            if column.kind == "date"
        ),
        None,
    )
    date_sources = [column.source for column in spec.columns if column.kind == "date"]

    with (
        open(source_path, encoding="utf-8-sig", newline="") as source,
        open(copy_path, "w", encoding="utf-8", newline="") as destination,
    ):
        writer = csv.writer(destination, lineterminator="\n")
        reader = csv.reader(source)
        try:
            header = next(reader)
        except (StopIteration, csv.Error) as error:
            measured.errors.append(f"could not read the header row: {error}")
            return measured
        if header != sources:
            measured.errors.append(
                f"header columns are {header!r}, not the pinned contract"
            )
            return measured

        row_number = 0
        for raw in _records(reader, measured):
            row_number += 1
            if len(raw) != expected:
                measured.errors.append(
                    f"record {row_number} has {len(raw)} fields, expected {expected}"
                )
                if len(measured.errors) >= MAX_REPORTED_ROW_ERRORS:
                    break
                continue

            typed: list[Any] = [str(snapshot_id), row_number]
            failure: Optional[str] = None
            for column, value in zip(spec.columns, raw):
                if "\x00" in value:
                    failure = f"column {column.source!r} contains a NUL byte"
                    break
                if _blank(value):
                    blanks[column.source] += 1
                    typed.append(None)
                    continue
                try:
                    typed.append(_typed_value(column, value))
                except ValueError as error:
                    failure = f"column {column.source!r}: {error}"
                    break
            if failure is not None:
                measured.errors.append(f"record {row_number} {failure}")
                if len(measured.errors) >= MAX_REPORTED_ROW_ERRORS:
                    break
                continue

            measured.row_count += 1
            writer.writerow(typed)

            amount = typed[amount_at]
            if amount is not None:
                measured.amount_sum += amount
                if amount < 0:
                    measured.negative_amount_sum += amount
            year = typed[year_at]
            if year is not None:
                key = str(year)
                years[key] = years.get(key, 0) + 1
            filer = raw[filer_at].strip()
            if filer:
                filers.add(filer)
                if year is not None:
                    measured.filer_numbers_by_year.setdefault(int(year), set()).add(
                        filer
                    )
            if counterparty_at is not None:
                counterparty = raw[counterparty_at].strip()
                if counterparty:
                    measured.counterparty_numbers.add(counterparty)
            if (
                receipt_type_at is not None
                and in_kind_at is not None
                and filer
                and year is not None
                and amount is not None
                # 1.2% of the rows in a file named for contributions are not
                # contributions -- Miscellaneous, Miscellaneous Income and Loan
                # Payable -- and the filing reports each of those on its own
                # schedule. Comparing without this filter made 19 of 202
                # legislator-years disagree where 3 really do (§2.1, §7).
                and raw[receipt_type_at].strip() == CONTRIBUTION_RECEIPT_TYPE
            ):
                # Cash and in-kind kept apart rather than added together, because
                # they are reported as separate figures and it is measured rather
                # than assumed which of them the reported contributions total holds.
                in_kind = raw[in_kind_at].strip().lower() == "yes"
                bucket = (
                    measured.contribution_in_kind_by_filer_year
                    if in_kind
                    else measured.contribution_cash_by_filer_year
                )
                filer_year = (filer, int(year))
                bucket[filer_year] = bucket.get(filer_year, Decimal("0")) + amount
                if not in_kind and contribution_cutoffs is not None:
                    cutoff = contribution_cutoffs.get(filer_year)
                    if cutoff is not None:
                        received = (
                            typed[receipt_date_at]
                            if receipt_date_at is not None
                            else None
                        )
                        if received is None:
                            # An undated row is counted as inside the period rather
                            # than outside it. Deliberately the direction that can
                            # cause a false failure: a false failure stops a release
                            # loudly and a missed overage publishes a wrong figure
                            # quietly, and §9.4's whole argument is that the quiet
                            # direction is the dangerous one.
                            measured.contribution_rows_without_a_date += 1
                        if received is None or received <= cutoff:
                            through = measured.contribution_cash_through_cutoff
                            through[filer_year] = (
                                through.get(filer_year, Decimal("0")) + amount
                            )
                        else:
                            measured.contribution_rows_after_cutoff += 1
                            measured.contribution_cash_after_cutoff += amount
            # A 16-byte digest per record rather than the record itself: a list of
            # 583,152 tuples of 15 strings costs hundreds of megabytes. Kept with
            # duplicates, because 20,524 records in one real download repeat another
            # record and a set would throw that multiplicity away.
            fingerprints.append(_record_fingerprint(raw))
            # The exact signature of the Board's backslash-escaped quote once the
            # default reader has consumed the closing quote into the value. This
            # definition counts 18 contribution and 17 expenditure records on the
            # 11 Aug 2026 files, which is precisely the set `strict=True` rejects.
            if any("\\" in cell and cell.endswith('"') for cell in raw):
                measured.malformed_quote_record_count += 1

    measured.distinct_row_count = len(set(fingerprints))
    measured.distinct_filer_count = len(measured.filer_numbers)
    measured.rows_by_year = dict(sorted(years.items()))
    measured.blank_counts_by_column = blanks
    measured.blank_date_count = sum(blanks[source] for source in date_sources)
    if not measured.errors:
        # Sorted, so the same records in a different order hash the same. Sorting
        # rather than combining with XOR or addition on purpose: XOR cancels a
        # repeated record against its own copy, and this source publishes 20,524 of
        # those.
        fingerprints.sort()
        digest = hashlib.sha256()
        for fingerprint in fingerprints:
            digest.update(fingerprint)
        measured.record_set_hash = digest.hexdigest()
    return measured


def _column_index(spec: DatasetSpec, attribute: Optional[str]) -> Optional[int]:
    """Where a named column sits in a raw record, or None when it has none."""
    if attribute is None:
        return None
    return next(
        index
        for index, column in enumerate(spec.columns)
        if column.attribute == attribute
    )


def _record_fingerprint(raw: list[str]) -> bytes:
    """A 16-byte digest of one record, with each field's own length hashed first.

    The length prefix is the whole point. Joining the fields with a separator
    instead lets 2 different records produce identical bytes whenever a field
    contains that separator: ``["A\\x1fB", "C"]`` and ``["A", "B\\x1fC"]`` both
    join to ``A\\x1fB\\x1fC``. Codex found that at max reasoning effort and
    demonstrated the collision, and it is not academic — the parser rejects only
    NUL, so every other control character reaches here as ordinary text. Two
    records colliding would make a changed file look unchanged, which defeats the
    one thing the record-set hash decides.
    """
    digest = hashlib.blake2b(digest_size=16)
    for cell in raw:
        encoded = cell.encode("utf-8", "surrogatepass")
        digest.update(len(encoded).to_bytes(4, "big"))
        digest.update(encoded)
    return digest.digest()


def _records(reader: Any, measured: Measurements) -> Iterable[list[str]]:
    """Yield records, turning a reader-level parse error into a recorded failure."""
    while True:
        try:
            yield next(reader)
        except StopIteration:
            return
        except csv.Error as error:
            measured.errors.append(f"the CSV reader could not continue: {error}")
            return


def _typed_value(column: Column, value: str) -> Any:
    if column.kind == "text":
        # Kept exactly as printed. Trimming would change what the Board published,
        # and a leading zero on a zip is the difference between 2 real places.
        return value
    stripped = value.strip()
    if column.kind == "money":
        try:
            amount = Decimal(stripped)
        except InvalidOperation:
            raise ValueError(f"{stripped!r} is not an amount") from None
        if not amount.is_finite():
            raise ValueError(f"{stripped!r} is not a finite amount")
        scale = -int(amount.as_tuple().exponent)
        if scale > 4:
            # Never rounded. A 5-decimal value means the source changed, and
            # rounding it would silently move real money.
            raise ValueError(
                f"{stripped!r} carries {scale} decimal places; the column holds 4, "
                "and an amount is never rounded to fit"
            )
        return amount
    if column.kind == "date":
        if not ISO_DATE.match(stripped):
            raise ValueError(
                f"{stripped!r} is not an ISO date. Every one of the 1,002,142 rows "
                "measured on 11 Aug 2026 was, so this is a change in the source, "
                "not a row to skip"
            )
        try:
            return date.fromisoformat(stripped)
        except ValueError:
            raise ValueError(f"{stripped!r} is not a real calendar date") from None
    if column.kind == "year":
        if not FOUR_DIGIT_YEAR.match(stripped):
            raise ValueError(f"{stripped!r} is not a 4-digit year")
        return int(stripped)
    raise AssertionError(f"unknown column kind {column.kind!r}")  # pragma: no cover


# --- Step 6: validate -------------------------------------------------------


def validate(
    spec: DatasetSpec,
    fetched: FetchedFile,
    measured: Optional[Measurements],
    baseline: Optional[Any],
    *,
    operator_approved: bool,
    filings: Optional[Any] = None,
    stated_split: Optional[Any] = None,
) -> list[Check]:
    """Compare a candidate against the live release's snapshot for the same file.

    Comparisons are against **recorded measurements**, never against old rows, so
    a superseded set's rows can be pruned without losing the ability to check the
    next download.

    ``filings`` is the published snapshot of Minnesota's own figures and filer
    directory (a ``FilingsContext`` from ``campaign_finance_filings``). Without it the
    2 checks that need the Board's own statements report themselves as not run, with
    the command that fixes that.

    ``stated_split`` is what a previous run of #1433's comparison found for *these*
    records (a ``StatedSplitCoverage``). It is looked up by record-set hash rather than
    recomputed, so it is only present when the same records have already been compared
    against their own filings. Without it that check reports itself not run, with the
    command that fixes that.

    ``operator_approved`` waives the comparison checks only, for an operator who
    has named the exact hashes they reviewed. It never waives a structural check:
    a header that does not match, a record with the wrong number of fields, a date
    that is not a date and an amount that would have to be rounded are not
    judgement calls, and there is no flag that lets one through.
    """
    checks: list[Check] = []

    def add(name: str, ok: bool, detail: str, *, comparison: bool = False) -> None:
        if ok:
            checks.append(Check(name, "passed", detail))
        elif comparison and operator_approved:
            checks.append(
                Check(
                    name,
                    "overridden",
                    f"{detail} — waived by an operator who named this hash",
                )
            )
        else:
            checks.append(Check(name, "failed", detail))

    add(
        "download_is_the_expected_file",
        fetched.content_error is None,
        fetched.content_error or f"named {fetched.disposition_filename!r}",
    )
    if fetched.content_error is not None or measured is None:
        return checks

    add(
        "parses_completely",
        not measured.errors,
        "; ".join(measured.errors[:MAX_REPORTED_ROW_ERRORS])
        or f"{measured.row_count:,} records, every field typed",
    )
    if measured.errors:
        return checks

    add(
        "previous_release_to_compare_against",
        baseline is not None,
        "no published release holds this dataset yet, so there is nothing to "
        "compare against. Review the measurements and publish by naming the 3 "
        "hashes",
        comparison=True,
    )

    if baseline is not None:
        add(
            "row_count_within_band",
            ROW_COUNT_BAND.contains(measured.row_count, baseline.row_count or 0),
            f"{measured.row_count:,} rows against {baseline.row_count:,} published",
            comparison=True,
        )
        add(
            "byte_size_within_band",
            BYTE_SIZE_BAND.contains(fetched.byte_size, baseline.byte_size or 0),
            f"{fetched.byte_size:,} bytes against {baseline.byte_size:,} published",
            comparison=True,
        )
        add(
            "amount_sum_within_band",
            AMOUNT_SUM_BAND.contains(
                float(measured.amount_sum), float(baseline.amount_sum or 0)
            ),
            f"{measured.amount_sum} against {baseline.amount_sum} published",
            comparison=True,
        )
        baseline_repeat = _baseline_repeat_fraction(baseline)
        add(
            "repeat_row_share_within_band",
            baseline_repeat is None
            or abs(measured.repeat_fraction - baseline_repeat)
            <= REPEAT_FRACTION_TOLERANCE,
            f"{measured.repeat_fraction:.4%} of records repeat another record, "
            f"against {baseline_repeat:.4%} published"
            if baseline_repeat is not None
            else "the published snapshot recorded no repeat share",
            comparison=True,
        )
        lost = _years_that_lost_rows(measured, baseline)
        add(
            "no_published_year_lost_rows",
            not lost,
            "; ".join(lost) if lost else f"{len(measured.rows_by_year)} years checked",
            comparison=True,
        )
        gained = _columns_that_gained_blanks(spec, measured, baseline)
        add(
            "no_new_blank_dates_or_amounts",
            not gained,
            "; ".join(gained)
            if gained
            else "every dated and every money column is as full as before",
            comparison=True,
        )

    # The 2 checks §4.3 asks for that read Minnesota's own statements about its filers
    # rather than this file alone. They are the only checks here that watch **one
    # filer's money** instead of the whole file's shape, which is what a file with 2
    # committees' amounts swapped would slip past.
    checks.extend(
        _checks_against_the_board(
            spec, measured, filings, operator_approved=operator_approved
        )
    )
    # And the half that catches our rows being SHORT, which is the direction nothing
    # announces (#1433). It reads a separate pass's stored answers rather than running
    # one here, because one pass is about 1,300 report documents.
    checks.append(_reported_itemized_split(spec, stated_split))
    return checks


def _reported_itemized_split(spec: DatasetSpec, coverage: Optional[Any]) -> Check:
    """Did each committee's own filing agree with the payment rows we hold for it?

    **This never blocks a release, and that is a ruling rather than a convenience**
    (Eugene, 12 Aug 2026): where 2 of Minnesota's own publications disagree and we
    cannot derive the truth, we show both figures and say plainly that they disagree.
    So a committee-year that disagrees withholds its own split while every other
    committee publishes normally, and a million verified payments are not withheld
    because 1 committee contradicts itself. The status is ``reported`` rather than
    ``failed`` for exactly that reason, and the filer-years are named so a surface can
    withhold those and only those.

    ``not_run`` stays honest for a set nobody has checked yet. The comparison is a
    separate command over about 1,300 report documents, so a freshly downloaded set has
    no answers until someone runs it, and the reason names the command.

    **And ``passed`` needs a clean sweep, not merely no disagreements.** An earlier
    version returned ``passed`` whenever nothing disagreed, which made a run that reached
    almost nothing read as a release fully checked against Minnesota's own filings --
    "we could not look" printed as "we looked and it was fine", which is the exact
    failure ``docs/architecture/campaign-finance-system-design.md`` §9.9 exists to
    prevent, arriving from the check meant to enforce it. Found by an automated review
    (Greptile) on [#1495](https://github.com/alethical-org/alethical/pull/1495).

    **And a clean sweep is measured against the population, not against the verdicts on
    file.** The same review found the version after that one: check a single committee
    with ``--only-filers``, have it agree, and a coverage counted from stored rows reads
    1 of 1 agreeing -- which this printed as the whole record set checked and clean while
    1,402 committee-years had never been looked at. In practice ``passed`` is therefore
    unreachable on the real corpus, because our payment rows reach back to 2015 and the
    Board serves no report document before 2023. That is the honest answer rather than a
    defect: §9.9 exists so an unreachable population reads as unreachable.
    """
    name = "reported_itemized_split_matches_ours"
    if spec.dataset is not Dataset.contributions:
        return Check(
            name,
            "not_run",
            "this check compares itemized contributions against a filing's own stated "
            "itemized contributions figure, and this file carries neither",
        )
    if coverage is None:
        return Check(
            name,
            "not_run",
            "no committee-year of this record set has been compared against its own "
            "filing yet. That comparison reads about 1,300 report documents and is a "
            "separate pass: run scripts/check_campaign_finance_stated_split.py. Until "
            "it does, a committee whose filing names money we are missing would show "
            "that money as having had no donor (#1433)",
        )
    population = (
        f"{coverage.population:,}"
        if coverage.population is not None
        else "an unknown number of"
    )
    detail = (
        f"of {population} committee-years this release could be checked for, "
        f"{coverage.agrees:,} agree with their own filing, {coverage.disagrees:,} "
        f"disagree, {coverage.not_checked:,} could not be checked because the Board "
        f"serves no document for them, and {coverage.reader_unproven:,} were read by a "
        "reader that could not prove itself. Checked "
        + (
            coverage.checked_at.isoformat()
            if coverage.checked_at
            else "at an unknown time"
        )
    )
    if coverage.is_a_clean_sweep:
        return Check(name, "passed", detail)
    unfinished = []
    if coverage.disagrees:
        unfinished.append(
            "the filer-years named on this check must not publish a split; they are a "
            "display state and not a release fault"
        )
    unchecked = coverage.without_a_verdict
    if unchecked:
        unfinished.append(
            f"{unchecked:,} committee-years have NO verdict at all, because no run has "
            "covered them yet"
        )
    elif unchecked is None:
        unfinished.append(
            "how many committee-years this release could be checked for could not be "
            "established, so this is not a full sweep"
        )
    if coverage.not_checked:
        unfinished.append(
            f"{coverage.not_checked:,} committee-years were NOT checked, which is not "
            "the same as checked and clean"
        )
    if coverage.reader_unproven:
        unfinished.append(
            f"{coverage.reader_unproven:,} were read by a reader that failed its own "
            "test, so nothing is claimed about their data"
        )
    return Check(
        name,
        "reported",
        detail + ". " + "; ".join(unfinished),
        coverage.disagreeing_filer_years,
    )


# Money on both sides is numeric(18,4) and the Board prints 2 decimal places, so a
# sub-cent difference is arithmetic rather than a contradiction. Across 1,600 filers a
# cent each is $16, against the wrong figures this check exists to stop.
RECONCILE_TOLERANCE = Decimal("0.01")
# The share of recent-year registration numbers that may be absent from the Board's
# current directory. Filers deregister, so some absence is ordinary: measured 12 Aug
# 2026 on the contributions file, 11.2% of 2024's filers, 6.5% of 2025's and 0.7% of
# 2026's are unknown to today's directory. The ceiling sits at roughly twice the worst
# recent year, which still leaves it far below the near-100% a shifted column would
# produce.
UNKNOWN_FILER_SHARE_CEILING = 0.25


def _checks_against_the_board(
    spec: DatasetSpec,
    measured: Measurements,
    filings: Optional[Any],
    *,
    operator_approved: bool = False,
) -> list[Check]:
    """§4.3's 2 checks that need the Board's own figures and filer directory (#1408).

    Both report ``not_run`` when no filings snapshot is published, because that is the
    truth and it names the command that fixes it. Once one is published they pass or
    fail.
    """
    if filings is None:
        reason = (
            "no filings snapshot is published, so there is no reported total and no "
            "filer directory to check against. Fetch them with "
            "scripts/load_campaign_finance_filings.py"
        )
        return [
            Check("reported_totals_reconcile", "not_run", reason),
            Check("registration_numbers_resolve_to_a_known_filer", "not_run", reason),
        ]
    reconcile = _reported_totals_reconcile(spec, measured, filings)
    # Waivable by an operator who has named the exact hashes, like every other
    # comparison here — and unlike a structural check, which no flag lets through.
    #
    # It has to be, and the first production run is why. It failed on 3 filer-years of
    # 2,342 compared, and all 3 are contradictions inside Minnesota's own published
    # data rather than faults in the download (#1477). Left unwaivable, 3 committees
    # the Board disagrees with itself about would freeze every future refresh of
    # 583,196 payment rows, and a corpus frozen indefinitely is its own harm
    # (`.claude/rules/grounded-answers.md` rule 7, staleness). The filer-years are
    # recorded on the check so a surface can withhold those and only those, which is
    # what §7 asks for: "until a filer-year passes this check, its split is not
    # published".
    if reconcile.status == "failed" and operator_approved:
        reconcile = Check(
            reconcile.name,
            "overridden",
            f"{reconcile.detail} — waived by an operator who named this hash. The "
            "filer-years above must not publish a split until they reconcile",
            reconcile.filer_years,
        )
    return [reconcile, _registrations_resolve(spec, measured, filings)]


def _reported_totals_reconcile(
    spec: DatasetSpec, measured: Measurements, filings: Any
) -> Check:
    """Do our itemized rows fit inside what each filer itself reported taking in?

    **The comparison is bounded by the figure's own coverage end**, because the
    itemized download runs ahead of the figure. Filer 18336's 2026 figure covers
    through 31 March while our rows for it run to 20 July, and $321,870.52 of its cash
    contributions are dated after that. Comparing the year's whole sum against a figure
    that stops in March compares two different periods and calls the difference an
    error.

    **Special-election filer-years are excluded rather than failed.** Such a filer
    files a second report series that this route does not return, so its regular
    figures are a part of the year and not the year: filer 19207's 2025 figure is
    $0.00 against $7,000.00 of real itemized payments, all of them in the special
    series. §7 has those years read "Not reported" until both series are assembled.

    What this catches is our rows being **too big** for the filer's own total, which is
    what a file with 2 committees' amounts swapped would produce. What it cannot catch
    is our rows being too small while still fitting, which needs the filing's own
    stated itemized subtotal and is the separate not-run check above.
    """
    name = "reported_totals_reconcile"
    if spec.dataset is not Dataset.contributions:
        return Check(
            name,
            "not_run",
            "this check compares itemized contributions against a reported "
            "contributions figure, and this file carries neither. The Board publishes "
            "no itemized-expenditure counterpart to reconcile against",
        )
    comparable = {
        filer_year: official
        for filer_year, official in filings.reported_contributions.items()
        if filer_year not in filings.special_election_filer_years
    }
    skipped_special = len(filings.reported_contributions) - len(comparable)
    # Two reasons this check can compare nothing, and they are not the same fact. One
    # says the route cannot speak for these filers at all; the other says we hold no
    # rows inside the period it does speak for. Reporting either as the other sends an
    # operator looking in the wrong place.
    if not comparable:
        return Check(
            name,
            "not_run",
            f"all {skipped_special:,} filer-years with a reported total are "
            "special-election ones, and this route returns only their regular report "
            "series, so none of them can be compared against a whole year of our rows",
        )
    if not measured.contribution_cash_through_cutoff:
        return Check(
            name,
            "not_run",
            f"{len(comparable):,} filer-years can be compared and none of them has an "
            "itemized row in this file dated inside the period their reported total "
            f"covers, so there is nothing to compare ({skipped_special:,} further "
            "special-election filer-years were excluded)",
        )
    compared = 0
    exceeded: list[str] = []
    # **Every filer-year this check could not compare is counted and named**, split by
    # why. Codex found the version that simply skipped them: a filer-year with a
    # reported total and rows in the file, but no row inside the period that total
    # covers, vanished from the comparison while the check reported "passed, 1
    # filer-year compared". The committee whose rows exceeded its total was the one that
    # vanished. A check that says how many it compared and not how many it could not is
    # reporting its own coverage as its result.
    no_rows_at_all: list[tuple[str, int]] = []
    rows_only_outside_the_period: list[tuple[str, int]] = []
    failed_filer_years: list[str] = []
    for filer_year, official in sorted(comparable.items()):
        ours = measured.contribution_cash_through_cutoff.get(filer_year)
        if ours is None:
            # Told apart deliberately. "We hold nothing for this committee" is the case
            # #1433 exists for — the filing may itemize money we are missing entirely.
            # "We hold rows, all of them after the period" is ordinary: the figure
            # covers a part of the year our rows start after.
            if filer_year in measured.contribution_cash_by_filer_year:
                rows_only_outside_the_period.append(filer_year)
            else:
                no_rows_at_all.append(filer_year)
            continue
        compared += 1
        if ours - official > RECONCILE_TOLERANCE:
            registration, year = filer_year
            exceeded.append(
                f"{registration} {year}: our rows total {ours} against a reported "
                f"{official}, over by {ours - official}"
            )
            failed_filer_years.append(f"{registration}:{year}")
    detail = (
        f"{compared:,} of {len(comparable):,} comparable filer-years compared against "
        f"the Board's own figures; {len(no_rows_at_all):,} hold no itemized row of ours "
        f"at all (#1433 is what would catch a filing that itemizes money we lack), "
        f"{len(rows_only_outside_the_period):,} hold rows only outside the period their "
        f"figure covers; {skipped_special:,} special-election filer-years excluded"
    )
    if exceeded:
        return Check(
            name,
            "failed",
            f"{len(exceeded)} filer-year(s) hold more itemized money than the filer "
            "itself reported taking in, which would print as a negative amount of "
            "unnamed money: "
            + "; ".join(exceeded[:MAX_REPORTED_ROW_ERRORS])
            + f". {detail}",
            tuple(failed_filer_years),
        )
    return Check(name, "passed", detail)


def _registrations_resolve(
    spec: DatasetSpec, measured: Measurements, filings: Any
) -> Check:
    """Does every registration number in the years we show name a filer Minnesota lists?

    Asked only of the years the published filings cover, because the directory lists
    *current* registrants and a filer who deregistered in 2016 is legitimately absent
    from it. An unknown number is reported rather than treated as fatal, which is what
    §4.3 asks for — a filer registering between our directory snapshot and this
    download is ordinary. What the ceiling catches is the systematic break: a shifted
    column would make almost every number unknown at once.

    The **contributor** side of a row is deliberately not checked, only counted. A
    contributor can be any person or a committee registered somewhere else entirely,
    and 65.3% of them are unknown to Minnesota's directory as a matter of course, so
    including them would make the number unreadable.
    """
    name = "registration_numbers_resolve_to_a_known_filer"
    years = [int(year) for year in filings.years]
    numbers: set[str] = set()
    for year in years:
        numbers |= measured.filer_numbers_by_year.get(year, set())
    if not numbers:
        return Check(
            name,
            "not_run",
            "this file holds no rows in "
            + (", ".join(str(year) for year in years) or "the published years")
            + ", which are the years the published filings cover",
        )
    unknown = sorted(numbers - filings.known_registrations)
    share = len(unknown) / len(numbers)
    counterparties = len(measured.counterparty_numbers - filings.known_registrations)
    detail = (
        f"{len(unknown):,} of {len(numbers):,} filer registration numbers in "
        f"{', '.join(str(year) for year in years)} are new to the Board's directory of "
        f"{len(filings.known_registrations):,} current registrants ({share:.2%})"
        + (f", first few {', '.join(unknown[:5])}" if unknown else "")
        + f". Separately and not checked: {counterparties:,} counterparty numbers are "
        "not current Minnesota registrants, which is ordinary"
    )
    if share > UNKNOWN_FILER_SHARE_CEILING:
        return Check(
            name,
            "failed",
            f"{detail}. Above the {UNKNOWN_FILER_SHARE_CEILING:.0%} ceiling, which "
            "means either the directory is badly out of date or this file's columns "
            "have moved",
        )
    return Check(name, "passed", detail)


def _baseline_repeat_fraction(baseline: Any) -> Optional[float]:
    if not baseline.row_count or baseline.distinct_row_count is None:
        return None
    return 1 - (baseline.distinct_row_count / baseline.row_count)


def _years_that_lost_rows(measured: Measurements, baseline: Any) -> list[str]:
    published = baseline.rows_by_year or {}
    lost: list[str] = []
    for year, was in sorted(published.items()):
        now = measured.rows_by_year.get(year, 0)
        allowed = max(YEAR_ROW_LOSS_FLOOR, int(was * YEAR_ROW_LOSS_FRACTION))
        if was - now > allowed:
            lost.append(f"{year} fell from {was:,} rows to {now:,}")
    return lost


def _columns_that_gained_blanks(
    spec: DatasetSpec, measured: Measurements, baseline: Any
) -> list[str]:
    """Only dated and money columns, which is what §4.3 asks for.

    Every column's blank count is recorded on the snapshot for an operator to
    read; enforcing all of them would quarantine a set the first time a name or an
    employer arrived empty, which is ordinary.
    """
    published = baseline.blank_counts_by_column or {}
    gained: list[str] = []
    for column in spec.columns:
        if column.kind not in ("date", "money"):
            continue
        was = published.get(column.source)
        now = measured.blank_counts_by_column.get(column.source, 0)
        if was == 0 and now > 0:
            gained.append(f"{column.source} had no blanks and now has {now:,}")
    return gained


# --- Steps 3, 7 and 8: the three transactions -------------------------------


def gzip_to(source_path: str, destination_path: str) -> tuple[str, int]:
    """Compress with ``mtime=0`` and no stored filename, so identical input always
    compresses to identical bytes.

    Both arguments are load-bearing and ``mtime=0`` alone is not enough, which is
    Codex's finding. Without ``mtime=0`` the same file gets a new timestamp in its
    gzip header every run. And ``GzipFile`` also writes the *output file's own
    basename* into that header, so measured here: the same 1,200 bytes written to
    ``a.csv.gz`` and to ``b.csv.gz`` produced 2 different compressed hashes, and
    ``filename=""`` produced one. Today's output name happens to be stable per
    dataset, so this was latent rather than live — but it made the compressed hash
    depend on a local temporary path, which is not a property of the download.
    """
    with (
        open(source_path, "rb") as source,
        open(destination_path, "wb") as raw,
        gzip.GzipFile(fileobj=raw, mode="wb", mtime=0, filename="") as compressed,
    ):
        shutil.copyfileobj(source, compressed, COPY_CHUNK_BYTES)
    return sha256_of_file(destination_path), os.path.getsize(destination_path)


def object_key(spec: DatasetSpec, content_hash: str) -> str:
    return f"campaign-finance/{spec.key}/{content_hash}.csv.gz"


def stated_split_for(db: Session, outcome: DatasetOutcome) -> Optional[Any]:
    """What #1433's comparison found for *these* records, if it has run on them.

    Keyed through ``find_snapshot``, which matches on the record-set hash rather than on
    the bytes. That is the whole reason this can ever be present: a re-download of an
    unchanged file arrives with different bytes and the same records, so the verdicts
    stored against those records still describe them. A genuinely new record set has
    none, and the check says so rather than carrying the previous set's answers over.
    """
    if outcome.spec.dataset is not Dataset.contributions:
        return None
    snapshot = find_snapshot(db, outcome)
    if snapshot is None:
        return None
    return stated_split_coverage(db, snapshot.id)


def find_snapshot(db: Session, outcome: DatasetOutcome) -> Optional[Any]:
    """The snapshot already holding this download's records, if there is one.

    Matched on the record-set hash, not on the bytes: the Board's export shuffles
    its rows, so the same data arrives with a different byte hash every time. An
    unparseable download has no record set, so those fall back to the bytes.
    """
    measured = outcome.measurements
    if measured is not None and measured.record_set_hash:
        return db.scalars(
            select(schema.CampaignFinanceSnapshot).where(
                schema.CampaignFinanceSnapshot.dataset == outcome.spec.dataset,
                schema.CampaignFinanceSnapshot.record_set_hash
                == measured.record_set_hash,
            )
        ).one_or_none()
    return db.scalars(
        select(schema.CampaignFinanceSnapshot).where(
            schema.CampaignFinanceSnapshot.dataset == outcome.spec.dataset,
            schema.CampaignFinanceSnapshot.content_hash == outcome.fetched.content_hash,
        )
    ).one_or_none()


def record_fetch(
    db: Session,
    outcome: DatasetOutcome,
    store: Any,
    directory: str,
    ingestion_run_id: Optional[uuid.UUID],
) -> tuple[uuid.UUID, bool]:
    """Store the bytes and record the fetch, then commit — before any validation.

    Its own transaction on purpose. A failure record written inside the transaction
    that later fails rolls back with it, which is how "the bad download is retained"
    becomes "the bad download is gone". A download that could not be parsed is
    stored and recorded here too, for the same reason.

    **A body is stored only for records we have not seen before.** Because the
    export shuffles, keeping every download's bytes would mean 7 to 10 GB a year of
    reshuffled copies of identical data. What is kept instead is one body per
    distinct record set, plus a fetch observation per download carrying that
    download's own byte hash and size — so the shuffling stays on the record and
    measurable without paying for it.

    Returns the snapshot id and whether the records were already on file.
    """
    existing = find_snapshot(db, outcome)
    if existing is None:
        # Two runs can reach here with the same new records and both find nothing.
        # The unique index on (dataset, record_set_hash) is what actually decides, so
        # the loser re-reads rather than dying: without this, a second concurrent
        # import ends in an IntegrityError traceback instead of correctly finding that
        # these records are already on file.
        try:
            return _create_snapshot_and_record(
                db, outcome, store, directory, ingestion_run_id
            )
        except IntegrityError:
            db.rollback()
            existing = find_snapshot(db, outcome)
            if existing is None:  # pragma: no cover - the index is what conflicted
                raise
    return _record_observation(db, outcome, existing, ingestion_run_id, reused=True)


def _create_snapshot_and_record(
    db: Session,
    outcome: DatasetOutcome,
    store: Any,
    directory: str,
    ingestion_run_id: Optional[uuid.UUID],
) -> tuple[uuid.UUID, bool]:
    """Create the snapshot for records not on file, store its bytes, record the fetch."""
    spec = outcome.spec
    fetched = outcome.fetched
    measured = outcome.measurements
    snapshot = schema.CampaignFinanceSnapshot(
        # Minted before the parse, so the COPY file this run already wrote carries
        # the right id.
        id=outcome.candidate_snapshot_id,
        dataset=spec.dataset,
        download_id=fetched.download_id,
        source_url=fetched.requested_url,
        content_disposition_filename=fetched.disposition_filename,
        content_hash=fetched.content_hash,
        record_set_hash=(measured.record_set_hash or None) if measured else None,
        byte_size=fetched.byte_size,
        status=SnapshotStatus.quarantined
        if fetched.content_error or (measured and measured.errors)
        else SnapshotStatus.fetched,
        error_text=fetched.content_error,
        validation_json={},
    )
    db.add(snapshot)
    db.flush()
    key = object_key(spec, fetched.content_hash)
    compressed_path = os.path.join(directory, f"{spec.key}.csv.gz")
    compressed_hash, compressed_size = gzip_to(fetched.path, compressed_path)
    # Read back and verify before the row exists. An orphaned object is recoverable;
    # a row pointing at a missing body destroys the evidence it claims to have.
    store.put_and_verify(key, compressed_path, compressed_hash)
    os.remove(compressed_path)
    db.add(
        schema.CampaignFinanceSnapshotBody(
            snapshot_id=snapshot.id,
            object_key=key,
            compressed_hash=compressed_hash,
            compressed_byte_size=compressed_size,
            compression="gzip",
        )
    )
    return _record_observation(db, outcome, snapshot, ingestion_run_id, reused=False)


def _record_observation(
    db: Session,
    outcome: DatasetOutcome,
    snapshot: Any,
    ingestion_run_id: Optional[uuid.UUID],
    *,
    reused: bool,
) -> tuple[uuid.UUID, bool]:
    """Append this download to the record, with its own byte hash and size.

    Every download gets one of these whether or not anything changed, which is what
    makes "all 3 files were confirmed current in the same run" a recorded fact. It is
    also where a reshuffled download's byte hash is kept when its bytes were not.
    """
    fetched = outcome.fetched
    db.add(
        schema.CampaignFinanceFetchObservation(
            snapshot_id=snapshot.id,
            dataset=outcome.spec.dataset,
            ingestion_run_id=ingestion_run_id,
            download_id=fetched.download_id,
            requested_url=fetched.requested_url,
            final_url=fetched.final_url,
            started_at=fetched.started_at,
            completed_at=fetched.completed_at,
            byte_size=fetched.byte_size,
            content_hash=fetched.content_hash,
            response_headers=fetched.response_headers,
            reused_existing_snapshot=reused,
        )
    )
    db.commit()
    return snapshot.id, reused


def live_release(db: Session) -> Optional[Any]:
    """Which release is live, read from the database rather than from memory.

    ``populate_existing=True`` is load-bearing, not tidiness. ``publish()`` moves the
    pointer with a statement rather than through the object, and this repo's session
    factory sets ``expire_on_commit=False``, so a caller that still holds the pointer
    object gets the value it had *before* the publish. That is not cosmetic: with a
    stale pointer, ``prune()`` computes an empty keep-set and **deletes the rows of
    the release that was just published** — proved in
    ``test_prune_reads_the_pointer_from_the_database_not_from_memory``, which reported
    3 snapshots and every row pruned moments after they were published. It normally
    hides because the identity map holds objects weakly, so an unreferenced pointer is
    collected and the next read goes to the database anyway; a defect that depends on
    garbage-collection timing is worse than one that always fires, not better.
    """
    pointer = db.get(schema.CampaignFinanceCurrentRelease, True, populate_existing=True)
    if pointer is None or pointer.release_id is None:
        return None
    return db.get(
        schema.CampaignFinanceRelease, pointer.release_id, populate_existing=True
    )


def baseline_snapshots(db: Session) -> dict[Dataset, Any]:
    """The snapshot per dataset that the live release published, if any."""
    release = live_release(db)
    if release is None:
        return {}
    found: dict[Dataset, Any] = {}
    for dataset, column in RELEASE_SNAPSHOT_COLUMN.items():
        snapshot = db.get(schema.CampaignFinanceSnapshot, getattr(release, column))
        if snapshot is not None:
            found[dataset] = snapshot
    return found


def ensure_pointer_row(db: Session) -> None:
    """Make sure the single pointer row exists, in its own committed transaction.

    ``SELECT ... FOR UPDATE`` locks nothing when there is no row, so without this
    the very first two concurrent imports would not see each other.
    """
    db.execute(
        text(
            "INSERT INTO cf_current_release (id, release_id) VALUES (true, NULL) "
            "ON CONFLICT (id) DO NOTHING"
        )
    )
    db.commit()


def rows_present(db: Session, spec: DatasetSpec, snapshot_id: uuid.UUID) -> int:
    return int(
        db.scalar(
            select(func.count())
            .select_from(spec.table)
            .where(spec.table.snapshot_id == snapshot_id)
        )
        or 0
    )


def copy_rows(db: Session, spec: DatasetSpec, copy_path: str) -> None:
    """Load one file's rows with ``COPY``, inside the caller's transaction.

    The point of ``COPY`` is that the publish transaction stays short enough to hold
    the pointer lock through it. **The 1.6 seconds this docstring used to claim for
    583,152 contribution rows was measured before migration ``0040_cf_name_indexes``
    existed, and it no longer describes anything.** These tables keep their indexes
    across a load -- nothing here drops or rebuilds a table, so the only writes are a
    snapshot-scoped ``DELETE`` and this ``COPY`` -- which means the COPY pays per-row
    index maintenance for every index on the table, in line, inside this transaction.

    Measured on 583,218 real contribution rows, 7 interleaved runs per configuration
    (#1690): pk plus the pre-0040 recipient index, 4.22 s median; all 5 of 0040's name
    indexes as shipped, 20.11 s median. That is a local Postgres on an SSD rather than
    production's network-attached storage, so the ratio transfers and the seconds do
    not. **No production load has run since those indexes landed**, so what the real
    publish transaction now holds is unmeasured; the next load is what settles it.
    """
    columns = ", ".join(
        f'"{name}"' for name in ("snapshot_id", "row_number", *spec.attributes)
    )
    statement = (
        f'COPY "{spec.table.__tablename__}" ({columns}) FROM STDIN WITH (FORMAT csv)'
    )
    connection = db.connection().connection.driver_connection
    with connection.cursor() as cursor, cursor.copy(statement) as copy:
        with open(copy_path, "rb") as handle:
            for chunk in iter(lambda: handle.read(COPY_CHUNK_BYTES), b""):
                copy.write(chunk)


def rows_from_retained_body(
    db: Session,
    outcome: DatasetOutcome,
    snapshot: Any,
    store: Any,
    directory: str,
) -> str:
    """Rebuild a snapshot's COPY file from the bytes we kept, and prove they are them.

    Needed whenever rows must be (re)loaded for a snapshot this run did not create —
    a set whose rows were pruned and is being published again. This run's own
    download holds the same records in a different order, so numbering from it would
    point every citation at the wrong line of the retained file.

    The rebuilt record-set hash is checked against the one recorded on the snapshot,
    which is a full integrity check of the stored object rather than a formality: if
    the body has been altered or truncated in the store, this is where it stops.
    """
    spec = outcome.spec
    body = db.get(schema.CampaignFinanceSnapshotBody, snapshot.id)
    if body is None:
        raise CampaignFinanceRefusal(
            f"{spec.key} snapshot {snapshot.id} has no retained body, so its rows "
            "cannot be rebuilt with the record numbers its citations use."
        )
    compressed_path = os.path.join(directory, f"{spec.key}.retained.csv.gz")
    source_path = os.path.join(directory, f"{spec.key}.retained.csv")
    store.get(body.object_key, compressed_path)
    with gzip.open(compressed_path, "rb") as compressed, open(source_path, "wb") as raw:
        shutil.copyfileobj(compressed, raw, COPY_CHUNK_BYTES)
    copy_path = os.path.join(directory, f"{spec.key}.retained.copy.csv")
    rebuilt = parse_and_measure(spec, source_path, snapshot.id, copy_path)
    if rebuilt.errors or rebuilt.record_set_hash != snapshot.record_set_hash:
        raise CampaignFinanceRefusal(
            f"{spec.key} retained body {body.object_key} no longer reproduces the "
            f"records recorded against snapshot {snapshot.id}. Refusing to publish "
            f"rows we cannot trace: {'; '.join(rebuilt.errors) or 'hash mismatch'}"
        )
    return copy_path


def publish(
    db: Session,
    outcomes: list[DatasetOutcome],
    *,
    fetch_started_at: datetime,
    fetch_completed_at: datetime,
    ingestion_run_id: Optional[uuid.UUID],
    notes: Optional[str],
    approved_hashes: Optional[set[str]] = None,
    store: Any = None,
    directory: Optional[str] = None,
    filings: Optional[Any] = None,
) -> uuid.UUID:
    """Load the rows and move the live pointer, in one transaction.

    The pointer row is taken with ``FOR UPDATE`` and the live release re-read
    inside the lock, then a candidate whose fetch window opened before the live
    release's is refused. Without that, two overlapping imports let the one that
    *started* first finish last and replace newer data with older data — a "one
    published release" rule limits quantity, not age.

    **The comparison checks are then re-run against the release found inside the
    lock**, because being newer is not the same as having been compared. Codex
    found the gap: 2 runs both read a live release of 100 rows, the first publishes
    105 rows and passes the 5% growth limit, and the second — which started later,
    so the age check waves it through — publishes its 100 rows, a 4.8% fall from
    what is now live, against a limit of 0.5%. Its numbers were never compared with
    anything that was ever published. Re-running here is cheap because every check
    reads recorded measurements rather than rows.
    """
    db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": PUBLISH_LOCK_KEY})
    pointer = db.execute(
        text("SELECT release_id FROM cf_current_release WHERE id = true FOR UPDATE")
    ).one_or_none()
    current_release_id = pointer[0] if pointer is not None else None
    # populate_existing, for the same reason as in live_release(): the fetch window
    # this comparison turns on has to come from the database inside the lock, never
    # from a copy this session read before the lock existed.
    current = (
        db.get(
            schema.CampaignFinanceRelease, current_release_id, populate_existing=True
        )
        if current_release_id
        else None
    )
    if current is not None and current.fetch_started_at > fetch_started_at:
        raise CampaignFinanceRefusal(
            "Refusing to publish: the live release was fetched starting "
            f"{current.fetch_started_at.isoformat()}, after this run started "
            f"{fetch_started_at.isoformat()}. Replacing newer data with older data "
            "is the one thing the pointer row exists to prevent. Re-run to fetch "
            "the current files."
        )
    # **And refuse if the reported totals moved while this run was downloading.**
    # Codex found this at maximum reasoning effort, and it is the one hazard the release
    # lock cannot see: the 2 pipelines take different locks on purpose, so a filings run
    # can publish new figures in the ~90 seconds this one spends downloading. The
    # comparison then holds — it was true against the figures that were live when it
    # ran — while the pair a reader is shown is this run's rows beside figures nobody
    # checked them against. Its reproduction: $90 of rows passed against a $100 figure
    # covering through March, then a new figures snapshot extended the period through
    # April and reported $105 against $110 of rows now inside it, wrong by $5 with every
    # check green. Re-validating here cannot fix it, because the cutoff dates were
    # applied during the parse and a moved cutoff needs the file read again. So the run
    # stops and says so, which costs one re-run and cannot publish a mismatched pair.
    live_filings_snapshot_id = db.scalar(
        text("SELECT snapshot_id FROM cf_filing_current WHERE id = true")
    )
    checked_against = getattr(filings, "snapshot_id", None)
    if live_filings_snapshot_id != checked_against:
        raise CampaignFinanceRefusal(
            "Refusing to publish: the reported-totals snapshot these rows were checked "
            f"against ({checked_against}) is no longer the live one "
            f"({live_filings_snapshot_id}), so a filings run published while this one "
            "was downloading. The rows and the figures beside them would be a pair "
            "nothing has compared. Re-run to check against what is actually published."
        )

    inside_lock: dict[Dataset, Any] = {}
    if current is not None:
        for dataset, column in RELEASE_SNAPSHOT_COLUMN.items():
            baseline = db.get(
                schema.CampaignFinanceSnapshot,
                getattr(current, column),
                populate_existing=True,
            )
            if baseline is not None:
                inside_lock[dataset] = baseline
    for outcome in outcomes:
        measured = outcome.measurements
        rechecked = validate(
            outcome.spec,
            outcome.fetched,
            measured,
            inside_lock.get(outcome.spec.dataset),
            operator_approved=bool(
                measured is not None
                and measured.record_set_hash in (approved_hashes or set())
            ),
            filings=filings,
            stated_split=stated_split_for(db, outcome),
        )
        failed = [check for check in rechecked if check.blocks_publication]
        if failed:
            raise CampaignFinanceRefusal(
                f"Refusing to publish {outcome.spec.key}: it passed its checks against "
                "the set that was live when this run started, and fails them against "
                "the set that is live now, so another import published in between. "
                + "; ".join(f"{check.name}: {check.detail}" for check in failed)
                + ". Re-run to compare against what is actually published."
            )
        outcome.checks = rechecked

    for outcome in outcomes:
        spec = outcome.spec
        snapshot = db.get(schema.CampaignFinanceSnapshot, outcome.snapshot_id)
        if snapshot is None:  # pragma: no cover - written moments ago
            raise CampaignFinanceRefusal(f"{spec.key} snapshot vanished before publish")
        measured = outcome.measurements
        if measured is None or outcome.copy_path is None:  # pragma: no cover
            raise CampaignFinanceRefusal(
                f"{spec.key} reached publication without being parsed"
            )
        # Re-read inside the lock: the snapshot must still hold the records this run
        # validated. Compared on the record-set hash, because the byte hash on the
        # snapshot belongs to whichever download's bytes were kept, which is not
        # this run's when the records were already on file.
        if snapshot.record_set_hash != measured.record_set_hash:  # pragma: no cover
            raise CampaignFinanceRefusal(
                f"{spec.key} snapshot {snapshot.id} no longer holds the records this "
                "run validated"
            )
        # "Already loaded" has to mean the rows are really there. A snapshot left
        # saying loaded with no rows is exactly what pruning could produce, and
        # reusing it would publish a dataset with nothing in it.
        loaded = snapshot.status == SnapshotStatus.loaded and rows_present(
            db, spec, snapshot.id
        ) == (snapshot.row_count or -1)
        if loaded:
            outcome.reused_rows = True
        else:
            source = (
                outcome.copy_path
                if outcome.copy_file_matches_snapshot
                else rows_from_retained_body(
                    db, outcome, snapshot, store, directory or ""
                )
            )
            db.execute(delete(spec.table).where(spec.table.snapshot_id == snapshot.id))
            copy_rows(db, spec, source)
        snapshot.status = SnapshotStatus.loaded
        snapshot.row_count = measured.row_count
        snapshot.column_names = measured.column_names
        snapshot.amount_sum = measured.amount_sum
        snapshot.negative_amount_sum = measured.negative_amount_sum
        snapshot.blank_date_count = measured.blank_date_count
        snapshot.distinct_row_count = measured.distinct_row_count
        snapshot.distinct_filer_count = measured.distinct_filer_count
        snapshot.rows_by_year = measured.rows_by_year
        snapshot.blank_counts_by_column = measured.blank_counts_by_column
        snapshot.malformed_quote_record_count = measured.malformed_quote_record_count
        snapshot.validation_json = {
            "checks": [check.as_json() for check in outcome.checks]
        }
        snapshot.error_text = None

    by_dataset = {outcome.spec.dataset: outcome for outcome in outcomes}
    release = schema.CampaignFinanceRelease(
        contributions_snapshot_id=by_dataset[Dataset.contributions].snapshot_id,
        expenditures_snapshot_id=by_dataset[Dataset.expenditures].snapshot_id,
        independent_expenditures_snapshot_id=by_dataset[
            Dataset.independent_expenditures
        ].snapshot_id,
        status=ReleaseStatus.published,
        fetch_started_at=fetch_started_at,
        fetch_completed_at=fetch_completed_at,
        published_at=datetime.now(UTC),
        ingestion_run_id=ingestion_run_id,
        notes=notes,
        filing_snapshot_id=checked_against,
    )
    db.add(release)
    db.flush()
    if current is not None:
        current.status = ReleaseStatus.superseded
        current.superseded_at = datetime.now(UTC)
    db.execute(
        text("UPDATE cf_current_release SET release_id = :release WHERE id = true"),
        {"release": release.id},
    )
    db.commit()
    return release.id


def prune(db: Session) -> tuple[int, int]:
    """Delete the parsed rows of every snapshot the live release does not name.

    A separate transaction after the publish commits, so a crash here leaves extra
    rows rather than a half-published set. The status change and the delete are in
    the *same* transaction on purpose: a snapshot left saying ``loaded`` with no
    rows would be reused as "unchanged" the next time the Board republishes those
    exact bytes, and would publish a dataset with nothing in it.

    **The release this one just superseded keeps its rows, for one generation.** A
    reader resolves the live release in one statement and queries rows in the next,
    and each statement sees the newest committed state, so deleting the previous set
    the instant a new one lands hands a request that started moments earlier **zero
    rows** — which a page renders as "this committee has no payments", the exact
    missing-versus-zero failure `.claude/rules/grounded-answers.md` rule 12 forbids.
    One spare generation is 241 MB measured on the full 11 Aug 2026 set (193 MB of
    rows plus 48 MB of indexes), against 8 GB of database disk with about 3 GB
    already used, and the *next* publish removes it, so nothing accumulates.

    Only rows are pruned. Every body is kept indefinitely, including every
    quarantined one, because the checks compare recorded measurements rather than
    old rows and the Board keeps no archive of its own.

    **It takes the same lock ``publish()`` takes, and that is what makes it safe
    to run outside the publish transaction.** Codex found the sequence at max
    reasoning effort, and it ends with the live release holding no rows at all:
    run A publishes, commits, and releases the lock; run A reads the pointer here
    and builds its keep-list; run B publishes a newer set and commits; run A's
    next statement sees B's snapshots, because each statement in a Read Committed
    transaction gets a fresh view, and they are absent from the list A already
    built, so A deletes the rows of the set that is live. Holding the publish lock
    for this whole transaction means no publish can commit in that gap, so the
    pointer read below cannot go stale while it is being acted on.
    """
    db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": PUBLISH_LOCK_KEY})
    release = live_release(db)
    keep: set[uuid.UUID] = set()
    if release is not None:
        keep |= {
            getattr(release, column) for column in RELEASE_SNAPSHOT_COLUMN.values()
        }
    for older in db.scalars(
        select(schema.CampaignFinanceRelease)
        .where(schema.CampaignFinanceRelease.status == ReleaseStatus.superseded)
        .order_by(schema.CampaignFinanceRelease.superseded_at.desc())
        .limit(KEEP_SUPERSEDED_GENERATIONS)
    ).all():
        keep |= {getattr(older, column) for column in RELEASE_SNAPSHOT_COLUMN.values()}
    snapshots = 0
    rows = 0
    for spec in DATASETS:
        conditions = [
            schema.CampaignFinanceSnapshot.dataset == spec.dataset,
            schema.CampaignFinanceSnapshot.status == SnapshotStatus.loaded,
        ]
        if keep:
            conditions.append(schema.CampaignFinanceSnapshot.id.notin_(keep))
        stale = db.scalars(
            select(schema.CampaignFinanceSnapshot).where(*conditions)
        ).all()
        for snapshot in stale:
            deleted = db.execute(
                delete(spec.table).where(spec.table.snapshot_id == snapshot.id)
            ).rowcount
            snapshot.status = SnapshotStatus.pruned
            snapshots += 1
            rows += deleted or 0
    db.commit()
    return snapshots, rows


def quarantine(db: Session, outcome: DatasetOutcome) -> None:
    snapshot = db.get(schema.CampaignFinanceSnapshot, outcome.snapshot_id)
    if snapshot is None:  # pragma: no cover
        return
    if snapshot.status != SnapshotStatus.loaded:
        snapshot.status = SnapshotStatus.quarantined
    snapshot.validation_json = {"checks": [check.as_json() for check in outcome.checks]}
    # None, not an empty string, when this file itself passed: the run stopped
    # because a sibling file failed, and this snapshot has no fault to record.
    snapshot.error_text = "; ".join(check.detail for check in outcome.blocked) or None
    measured = outcome.measurements
    if measured is not None and not measured.errors:
        snapshot.row_count = measured.row_count
        snapshot.column_names = measured.column_names
        snapshot.amount_sum = measured.amount_sum
        snapshot.negative_amount_sum = measured.negative_amount_sum
        snapshot.blank_date_count = measured.blank_date_count
        snapshot.distinct_row_count = measured.distinct_row_count
        snapshot.distinct_filer_count = measured.distinct_filer_count
        snapshot.rows_by_year = measured.rows_by_year
        snapshot.blank_counts_by_column = measured.blank_counts_by_column
        snapshot.malformed_quote_record_count = measured.malformed_quote_record_count
    db.commit()


# --- The whole cycle --------------------------------------------------------


# --- Re-checking confirmed committee links, on every load (#1398) -----------
#
# `scripts/review_legislator_campaign_committees.py verify` does this same check by hand.
# This is that check wired into the load itself, so a link stops being re-read only when
# someone remembers to run the script -- it runs every time this loader runs, using data
# already in hand rather than a second fetch of anything: the contributions file this run
# just downloaded, and (when a filings snapshot is published) the Board's registered-filer
# directory that run's sibling pipeline (#1408) already holds in ``cf_filer``.
#
# `legislator_committee_match.py` states its own rule not to touch: it stays free of
# network calls and database access so every rule in it is testable from plain values.
# The 2 small readers below are the seam that keeps that rule intact -- they build the
# same `RosterMember` / `FilerRecord` values `scripts/review_legislator_campaign_committees.py`
# builds from its own engine and its own network call, but from this run's already-open
# session and already-published snapshot instead.


def _read_current_roster(db: Session) -> list[RosterMember]:
    """Sitting legislators as `legislator_committee_match.RosterMember`.

    Same shape as `read_roster()` in `scripts/review_legislator_campaign_committees.py`,
    minus the current-session-years it also returns -- `recheck_confirmed_links` has no
    use for those, only `propose_all` does. Queries this run's own open session rather
    than opening a second connection, because a legislator id only means anything in the
    database this session is already reading and writing.
    """
    rows = db.execute(
        select(
            schema.Legislator.id,
            schema.Legislator.full_name,
            schema.Legislator.first_name,
            schema.Legislator.last_name,
            schema.Chamber.slug,
            schema.District.code,
            schema.LegislatorServicePeriod.party,
        )
        .join(
            schema.LegislatorServicePeriod,
            schema.LegislatorServicePeriod.legislator_id == schema.Legislator.id,
        )
        .join(
            schema.Chamber,
            schema.Chamber.id == schema.LegislatorServicePeriod.chamber_id,
        )
        .join(
            schema.District,
            schema.District.id == schema.LegislatorServicePeriod.district_id,
        )
        .where(schema.LegislatorServicePeriod.is_current.is_(True))
    ).all()
    return [
        RosterMember(
            legislator_id=str(row.id),
            full_name=row.full_name,
            chamber_slug=row.slug,
            first_name=row.first_name,
            last_name=row.last_name,
            district=row.code,
            party=row.party,
        )
        for row in rows
    ]


def _read_filer_directory(
    db: Session, snapshot_id: uuid.UUID
) -> dict[str, FilerRecord]:
    """The Board's registered-filer directory, read out of this run's own filings
    snapshot (#1408) rather than fetched again from the Board.
    """
    rows = db.scalars(
        select(schema.CampaignFinanceFiler).where(
            schema.CampaignFinanceFiler.snapshot_id == snapshot_id
        )
    ).all()
    return {
        row.registration_number: FilerRecord(
            registration_number=row.registration_number,
            committee_name=row.name,
            candidate_name=row.candidate_name or "",
            office=row.office,
            district=row.district,
            party=row.party,
            is_incumbent=row.is_incumbent,
            is_terminated=row.termination_date is not None,
        )
        for row in rows
    }


def verify_confirmed_committee_links(
    db: Session,
    contributions_path: str,
    filings: Optional[Any],
    *,
    log=print,
) -> list[str]:
    """Re-check every person-confirmed legislator-committee link (#1354), on this load.

    **Why this exists.** A confirmed link is what puts money on a legislator's page, and
    a wrong one publishes another person's money under a real politician's name -- the
    worst error this product can make, and one nothing downstream would ever catch on its
    own (`docs/architecture/campaign-finance-system-design.md` §5.1: the financial totals
    route carries no registration number, no committee name and no filer identifier of
    any kind). A committee can rename or close after a person confirmed it, so the check
    has to run again later, not just once.

    **What it checks and what it does not.** Compares every *confirmed* link against the
    Board's registered-filer directory, which party's units pay the committee, and the
    committee's own published name. It reports and never repairs: a rename or closure is
    a legitimate event, not necessarily a mistake, and deciding which stays a person's
    job. It never blocks this load and never touches `report.refusal` -- the money data
    this run publishes is correct whether or not a committee got renamed, and refusing to
    publish real payment rows over an unrelated identity question would be the wrong
    trade. Zero confirmed links (true for every run until the first review sitting lands)
    is a pass: there is nothing yet for a person to have gotten wrong.

    Returns already-formatted lines, one per contradiction, empty when every confirmed
    link still agrees or there is nothing to check. The caller is responsible for making
    a non-empty result reach a person -- printing it here is not that (see
    `scripts/load_campaign_finance.py`).
    """
    if not inspect(db.get_bind()).has_table(
        schema.LegislatorCampaignCommittee.__tablename__
    ):
        return []
    rows = db.scalars(
        select(schema.LegislatorCampaignCommittee).where(
            schema.LegislatorCampaignCommittee.decision
            == schema.CommitteeLinkReviewDecision.confirmed
        )
    ).all()
    if not rows:
        log("committee links: no confirmed links yet, so there is nothing to re-check.")
        return []

    members_by_id = {
        member.legislator_id: member for member in _read_current_roster(db)
    }
    committees, party_by_registration = read_contributions_csv(contributions_path)
    committees_by_registration = {
        committee.registration_number: committee for committee in committees
    }
    filers_by_registration = (
        _read_filer_directory(db, filings.snapshot_id) if filings is not None else {}
    )

    problems = recheck_confirmed_links(
        [
            ConfirmedLink(
                legislator_id=str(row.legislator_id),
                registration_number=row.registration_number,
                committee_name_as_reviewed=row.committee_name_as_reviewed,
                reviewed_by=row.reviewed_by,
            )
            for row in rows
        ],
        members_by_id,
        committees_by_registration,
        party_by_registration=party_by_registration,
        filers_by_registration=filers_by_registration,
    )
    log(
        f"committee links: re-checked {len(rows)} confirmed link(s) against the "
        "Board's registered-filer directory, which party's money pays each committee, "
        "and each committee's own published name."
    )
    if not problems:
        log("committee links: every one still agrees with both sources.")
        return []

    names = {
        member.legislator_id: member.full_name for member in members_by_id.values()
    }
    return [
        f"{names.get(link.legislator_id, link.legislator_id)} -- "
        f"{link.registration_number} {link.committee_name_as_reviewed!r} / {problem} / "
        f"confirmed by {link.reviewed_by}"
        for link, problem in problems
    ]


def load_campaign_finance(
    db: Session,
    *,
    http: Optional[requests.Session] = None,
    store: Any = None,
    dry_run: bool = False,
    publish_hashes: Optional[Iterable[str]] = None,
    landing_page: str = LANDING_PAGE,
    log=print,
) -> LoadReport:
    """Run the whole cycle once and report what happened.

    ``publish_hashes`` is how an operator publishes a set the comparison checks
    quarantined, including the very first import, which has nothing to compare
    against. All 3 record-set hashes must be named, so a set cannot be waved through
    by accident, and they are recorded on the release. Structural checks are never
    waived by it. Record-set hashes rather than byte hashes because the export
    shuffles: a byte hash an operator read off one run may not exist by the next one,
    while the record-set hash survives as long as the data does.

    One consequence of parsing before storing: a crash *during* the parse loses that
    download's bytes. A parse *failure* does not — the file is stored and recorded as
    quarantined, which is what §4.3 asks for. The trade buys not keeping 7 to 10 GB a
    year of reshuffled copies of identical data, and the irreplaceable case, a
    published set, is always stored before it is published.

    Also re-checks every person-confirmed legislator-committee link (#1354) against
    this run's own data, whether or not this run ends up publishing anything new — see
    ``verify_confirmed_committee_links``. A contradiction never blocks this load and is
    reported on ``LoadReport.committee_link_contradictions``, never in ``refusal``.
    """
    http = http or _http_session()
    approved = {value.strip().lower() for value in (publish_hashes or []) if value}
    report = LoadReport(dry_run=dry_run)

    with tempfile.TemporaryDirectory(prefix="alethical-cf-") as directory:
        resolved = resolve_downloads(http, landing_page)
        log(f"resolved 3 downloads from {landing_page}")

        ingestion_run_id = None
        if not dry_run:
            ensure_pointer_row(db)
            run = schema.IngestionRun(
                adapter="minnesota_campaign_finance",
                target_type="campaign_finance_release",
                status=schema.IngestionStatus.running,
                stats={},
            )
            db.add(run)
            db.commit()
            ingestion_run_id = run.id
            store = store or _store_from_env()

        # Read before the downloads, so the same published figures bound the parse and
        # the checks. A filings run publishing mid-download would otherwise leave the
        # cutoffs and the comparison disagreeing about which period was measured.
        filings = filings_context(db)
        if filings is None:
            log(
                "note: no filings snapshot is published, so the 2 checks that compare "
                "against Minnesota's own figures cannot run"
            )
        else:
            log(
                f"comparing against filings snapshot {filings.snapshot_id} "
                f"({len(filings.reported_contributions):,} filer-years with a reported "
                f"total, {len(filings.known_registrations):,} registered filers)"
            )
        cutoffs = filings.contribution_cutoffs() if filings is not None else None

        fetch_started_at = datetime.now(UTC)
        for spec in DATASETS:
            fetched = fetch_download(http, spec, resolved[spec.dataset], directory)
            log(
                f"{spec.key}: {fetched.byte_size:,} bytes, "
                f"sha256 {fetched.content_hash[:12]}"
                + (f" — {fetched.content_error}" if fetched.content_error else "")
            )
            report.outcomes.append(DatasetOutcome(spec=spec, fetched=fetched))
        fetch_completed_at = datetime.now(UTC)

        for outcome in report.outcomes:
            spec = outcome.spec
            if outcome.fetched.content_error is not None:
                continue
            outcome.copy_path = os.path.join(directory, f"{spec.key}.copy.csv")
            outcome.measurements = parse_and_measure(
                spec,
                outcome.fetched.path,
                outcome.candidate_snapshot_id,
                outcome.copy_path,
                contribution_cutoffs=cutoffs,
            )
            measured = outcome.measurements
            log(
                f"{spec.key}: {measured.row_count:,} records, "
                f"total {measured.amount_sum}, "
                f"{measured.distinct_row_count:,} distinct, "
                f"{measured.malformed_quote_record_count} with the source's quote "
                f"escape, records {measured.record_set_hash[:12] or 'unparsed'}"
            )

        # Re-check every person-confirmed legislator-committee link (#1354) against this
        # run's own data, whatever else this run goes on to decide about the money. Placed
        # here rather than after publish because it runs on *every* load, not only ones
        # that end up publishing something new -- the data it needs is already in hand the
        # moment the contributions file parses, and a legislator no longer sitting is a
        # fact about our own roster, not about whether the Board's file changed (#1398).
        contributions_outcome = next(
            (
                outcome
                for outcome in report.outcomes
                if outcome.spec.dataset is Dataset.contributions
            ),
            None,
        )
        if (
            contributions_outcome is not None
            and contributions_outcome.fetched.content_error is None
            and contributions_outcome.measurements is not None
            and not contributions_outcome.measurements.errors
        ):
            report.committee_link_contradictions = verify_confirmed_committee_links(
                db, contributions_outcome.fetched.path, filings, log=log
            )
        else:
            log(
                "committee links: the contributions download did not parse, so "
                "confirmed links were not re-checked this run."
            )

        if not dry_run:
            for outcome in report.outcomes:
                outcome.snapshot_id, reused = record_fetch(
                    db, outcome, store, directory, ingestion_run_id
                )
                if reused:
                    log(f"{outcome.spec.key}: these records were already on file")

        # Read even on a dry run: a dry run's whole point is to show what the real
        # checks would say, and every one of them compares against the live
        # release's recorded measurements.
        baselines = baseline_snapshots(db)
        for outcome in report.outcomes:
            baseline = baselines.get(outcome.spec.dataset)
            measured = outcome.measurements
            outcome.unchanged = bool(
                baseline is not None
                and measured is not None
                and measured.record_set_hash
                and baseline.record_set_hash == measured.record_set_hash
            )

        if not dry_run and all(outcome.unchanged for outcome in report.outcomes):
            usable = all(
                baselines[outcome.spec.dataset].status == SnapshotStatus.loaded
                and rows_present(db, outcome.spec, baselines[outcome.spec.dataset].id)
                == (baselines[outcome.spec.dataset].row_count or -1)
                for outcome in report.outcomes
            )
            if usable:
                report.no_change = True
                _finish_run(db, ingestion_run_id, report)
                log("all 3 files hold the records already published")
                return report

        for outcome in report.outcomes:
            measured = outcome.measurements
            outcome.checks = validate(
                outcome.spec,
                outcome.fetched,
                measured,
                baselines.get(outcome.spec.dataset),
                operator_approved=bool(
                    measured is not None and measured.record_set_hash in approved
                ),
                filings=filings,
                stated_split=stated_split_for(db, outcome),
            )

        blocked = [outcome for outcome in report.outcomes if outcome.blocked]
        if blocked:
            if approved and len(approved) != 3:
                log(
                    "note: --publish-hashes needs all 3 hashes, and waives only the "
                    "comparison checks"
                )
            if not dry_run:
                for outcome in report.outcomes:
                    quarantine(db, outcome)
                _finish_run(db, ingestion_run_id, report)
            report.refusal = (
                "quarantined "
                + ", ".join(outcome.spec.key for outcome in blocked)
                + ". Nothing was published and the previous set is still live."
            )
            return report

        if dry_run:
            return report

        notes = (
            "published by an operator naming the reviewed hashes: "
            + ", ".join(sorted(approved))
            if approved
            else None
        )
        report.release_id = publish(
            db,
            report.outcomes,
            fetch_started_at=fetch_started_at,
            fetch_completed_at=fetch_completed_at,
            ingestion_run_id=ingestion_run_id,
            notes=notes,
            approved_hashes=approved,
            store=store,
            directory=directory,
            filings=filings,
        )
        report.published = True
        report.pruned_snapshots, report.pruned_rows = prune(db)
        _finish_run(db, ingestion_run_id, report)
        return report


def _finish_run(db: Session, run_id: Optional[uuid.UUID], report: LoadReport) -> None:
    if run_id is None:
        return
    run = db.get(schema.IngestionRun, run_id)
    if run is None:  # pragma: no cover
        return
    run.status = (
        schema.IngestionStatus.succeeded
        if report.refusal is None
        else schema.IngestionStatus.failed
    )
    run.finished_at = datetime.now(UTC)
    run.stats = {
        "published": report.published,
        "no_change": report.no_change,
        "release_id": str(report.release_id) if report.release_id else None,
        "quarantined": [outcome.spec.key for outcome in report.quarantined],
        "rows": {
            outcome.spec.key: (
                outcome.measurements.row_count if outcome.measurements else None
            )
            for outcome in report.outcomes
        },
    }
    db.commit()


def _http_session() -> requests.Session:
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})
    return session


def _store_from_env():
    from alethical.pipeline.raw_file_store import raw_file_store_from_env

    return raw_file_store_from_env()
