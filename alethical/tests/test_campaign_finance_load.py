"""What the campaign-finance loader must guarantee about Minnesota's downloads (#1328).

Every test here stands in for a way this import could publish something false, and
each one names the failure it prevents. The two that matter most:

* **Running the same import twice changes nothing.** That is the whole reason for
  replacing whole sets instead of merging rows: the system this replaces merged, and
  241,258 of its 954,188 money rows ended up repeating another row's fingerprint.
* **A bad download is kept and never published.** A half-download that looks like
  real data is the failure most likely to go unnoticed, and the Board's own error
  page arrives as HTTP 200.

Fixtures are tiny hand-written CSVs, never the real 583,152 rows: §8 of
`docs/architecture/campaign-finance-system-design.md` is explicit that every count
in that document is a measurement of one day and never a requirement to assert. What
the fixtures *do* reproduce verbatim are the source's awkward shapes — its
backslash-escaped quotes, a newline inside a quoted field, 4-decimal amounts, a zip
with a leading zero, two identical payments, and a registration number whose type
contradicts its numeric band.

The Board is faked by a local HTTP server rather than by stubbing ``requests``, so
the real download path runs: the landing page is parsed, the negative download
number is resolved from it, ``Content-Disposition`` is read off a real response, and
the body arrives over a real socket.

Needs the local Postgres on port 54329.
"""

from __future__ import annotations

import hashlib
import threading
from dataclasses import dataclass, field
from decimal import Decimal
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Iterator, Optional
from urllib.parse import parse_qs, urlparse

import pytest
from sqlalchemy import select, text

from alethical.db import models
from alethical.db.session import get_session_factory
from alethical.pipeline import campaign_finance as cf

Dataset = models.CampaignFinanceDataset
SnapshotStatus = models.CampaignFinanceSnapshotStatus
ReleaseStatus = models.CampaignFinanceReleaseStatus

# The real numbers, negative on purpose: a `\d+` pattern drops the minus sign and
# resolves a different file, so the fixtures keep the trap in place.
DOWNLOAD_IDS = {
    Dataset.contributions: "-2113865252",
    Dataset.expenditures: "-1890073264",
    Dataset.independent_expenditures: "-617535497",
}

CONTRIBUTION_ROWS = [
    '19200,"Olson, Rick Senate Committee",PCC,,250.0000,2025-07-10,2025,'
    '"Smith, Jane",,Individual,Contribution,No,,0212,Retired',
    # Two legitimately identical payments: same donor, same day, same amount. Both
    # must survive, because the state publishes repeats and nothing available to us
    # can tell a genuine repeat from a re-import.
    '19200,"Olson, Rick Senate Committee",PCC,,30.0000,2025-08-31,2025,'
    '"Wivoda, Zachary",,Individual,Contribution,No,,55372,',
    '19200,"Olson, Rick Senate Committee",PCC,,30.0000,2025-08-31,2025,'
    '"Wivoda, Zachary",,Individual,Contribution,No,,55372,',
    # 4 decimal places, finer than a cent, and it must not be rounded.
    '19200,"Olson, Rick Senate Committee",PCC,,1234.5678,2025-06-01,2025,'
    '"Penny, Paula",,Individual,Contribution,No,,55401,Teacher',
    # The source's own backslash-escaped quote, which RFC 4180 does not allow. The
    # default reader keeps this record; strict parsing rejects it and takes real
    # money with it.
    '19200,"Olson, Rick Senate Committee",PCC,,6.4900,2025-07-10,2025,'
    '"Prime, Amazon",,Individual,Contribution,Yes,'
    '"Amazon.com, 1.5\\" Micro Rod",55372,retired',
    # A newline inside a quoted field, so a line count is not a row count.
    '19200,"Olson, Rick Senate Committee",PCC,,15.0000,2025-05-03,2025,'
    '"Phillippe, Janet",,Individual,Contribution,Yes,"A book\nby Michelle Obama",'
    "55446,retired",
    # Registration 40858 with type PTU contradicts the numeric band people assume
    # (30000+ meaning a committee or fund). The file's type column is what we keep.
    '40858,"Libertarian Party of Minnesota",PTU,,500.0000,2025-04-04,2025,'
    '"Doe, John",,Individual,Contribution,No,,55102,',
    # Year disagreeing with the row's own date year, which happens on 702 rows
    # across the 3 real files. Both are stored and neither is derived.
    '19200,"Olson, Rick Senate Committee",PCC,,75.0000,2026-01-04,2025,'
    '"Newyear, Nora",,Individual,Contribution,No,,55101,',
    # Not a contribution at all: 1.2% of rows in the "itemized contributions" file
    # carry another receipt type, and the filing reports them on other schedules.
    '19200,"Olson, Rick Senate Committee",PCC,,5000.0000,2025-03-01,2025,'
    '"Olson, Rick",,Self,Miscellaneous,No,,55372,',
    # A negative amount, which the file does carry.
    '19200,"Olson, Rick Senate Committee",PCC,,-40.0000,2025-02-01,2025,'
    '"Refund, Ray",,Individual,Contribution,No,,55372,',
]

EXPENDITURE_ROWS = [
    '19004,"Hutchinson, Michael House Committee",PCC,,KnuFunK,Rochester,MN,55902,'
    '400.0000,.0000,2024-11-01,"Parade and Event Fees",2024,'
    '"Campaign Expenditure",,No,,',
    # A party unit files the same kind of spending under a different Type label, so
    # filtering on either label alone drops a whole kind of filer.
    '20010,"House Republican Campaign Cmte",PTU,,"Seven Corners Print",St. Paul,MN,'
    '55108,853.1800,.0000,2024-07-02,"Printing",2024,"General Expenditure",,No,'
    '"Olson, Rick Senate Committee",19200',
    '19004,"Hutchinson, Michael House Committee",PCC,,"Rising Tide Media",'
    "Salt Lake City,UT,84106,1000.0000,250.0000,2025-04-04,"
    '"Advertising - general",2025,"Non-Campaign Disbursement",,No,,',
]

INDEPENDENT_ROWS = [
    '"Alliance for a Better MN",30161,PCF,,"Fateh, Omar Senate Committee",18466,'
    'Against,2025,2025-09-10,"Independent Expenditure",1500.00,.00,No,,Mailers,'
    '"Print Co",Minneapolis,MN,55401',
    # The independent file prints 2 decimals and sometimes omits the integer part.
    '"Committee for a Better Tomorrow",30999,PCF,,'
    '"Olson, Rick Senate Committee",19200,For,2026,2026-02-14,'
    '"Independent Expenditure",.51,.00,No,,"Digital ads","Ad Shop",Duluth,MN,55802',
]

DEFAULT_ROWS = {
    Dataset.contributions: CONTRIBUTION_ROWS,
    Dataset.expenditures: EXPENDITURE_ROWS,
    Dataset.independent_expenditures: INDEPENDENT_ROWS,
}


def csv_bytes(spec: cf.DatasetSpec, rows: list[str]) -> bytes:
    """The pinned header line plus these records, CRLF-terminated like the source."""
    return ("\r\n".join([spec.header_line, *rows]) + "\r\n").encode("utf-8")


# --- The Board, faked over a real socket -------------------------------------


@dataclass
class FakeBoard:
    bodies: dict[Dataset, bytes] = field(default_factory=dict)
    filenames: dict[Dataset, str] = field(default_factory=dict)
    headings: dict[Dataset, str] = field(default_factory=dict)
    download_ids: dict[Dataset, str] = field(default_factory=dict)
    content_types: dict[Dataset, str] = field(default_factory=dict)
    status_codes: dict[Dataset, int] = field(default_factory=dict)
    port: int = 0

    def __post_init__(self) -> None:
        for spec in cf.DATASETS:
            self.bodies.setdefault(
                spec.dataset, csv_bytes(spec, list(DEFAULT_ROWS[spec.dataset]))
            )
            self.filenames.setdefault(
                spec.dataset,
                f"All - {spec.disposition_marker} Of Over $200 - Campaign Finance.csv",
            )
            self.headings.setdefault(spec.dataset, spec.heading.title())
            self.download_ids.setdefault(spec.dataset, DOWNLOAD_IDS[spec.dataset])
            self.content_types.setdefault(spec.dataset, "application/octet-stream")
            self.status_codes.setdefault(spec.dataset, 200)

    def set_rows(self, dataset: Dataset, rows: list[str]) -> None:
        self.bodies[dataset] = csv_bytes(cf.SPEC_BY_DATASET[dataset], rows)

    @property
    def landing_page(self) -> str:
        return f"http://127.0.0.1:{self.port}/landing"

    def dataset_for_download(self, number: str) -> Optional[Dataset]:
        for dataset, value in self.download_ids.items():
            if value == number:
                return dataset
        return None

    def landing_html(self) -> str:
        sections = []
        for spec in cf.DATASETS:
            number = self.download_ids[spec.dataset]
            sections.append(
                f"<h1>{self.headings[spec.dataset]}</h1>"
                "<table>"
                "<tr><th>Filer category</th><th>File</th></tr>"
                # A decoy category row above the one we want, so the resolver has
                # to read the labels rather than take the first link it sees.
                '<tr><td>Candidate</td><td><a class="csvFile" '
                'href="/files/?download=-999000111">Candidate</a></td></tr>'
                f'<tr><td>All</td><td><a class="csvFile" '
                f'href="/files/?download={number}">All</a></td></tr>'
                "</table>"
            )
        # A section we must not confuse with the 3 we want.
        sections.append(
            "<h1>Lobbyist disbursements</h1><table><tr><td>All</td><td>"
            '<a class="csvFile" href="/files/?download=-42">All</a></td></tr></table>'
        )
        return "<html><body>" + "".join(sections) + "</body></html>"


class _Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler's name
        board: FakeBoard = self.server.board  # type: ignore[attr-defined]
        parsed = urlparse(self.path)
        if parsed.path == "/landing":
            body = board.landing_html().encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        number = parse_qs(parsed.query).get("download", [""])[0]
        dataset = board.dataset_for_download(number)
        if dataset is None:
            # What the Board really does with a number that no longer resolves:
            # HTTP 200 and an HTML error page typed as a download.
            body = b"<!DOCTYPE html><html><body>Page not available</body></html>"
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        status = board.status_codes[dataset]
        if status >= 500:
            board.status_codes[dataset] = 200  # the next attempt succeeds
            self.send_response(status)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        body = board.bodies[dataset]
        self.send_response(200)
        self.send_header("Content-Type", board.content_types[dataset])
        self.send_header(
            "Content-Disposition",
            f'attachment; filename="{board.filenames[dataset]}"',
        )
        # No Content-Length and a chunked transfer, exactly like the source: nothing
        # in the response tells you the file arrived whole.
        self.send_header("Transfer-Encoding", "chunked")
        self.end_headers()
        self.wfile.write(b"%X\r\n" % len(body) + body + b"\r\n0\r\n\r\n")

    def log_message(self, *args: object) -> None:
        return


class MemoryStore:
    """Stands in for the private Supabase bucket, with the same read-back check."""

    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    def exists(self, key: str) -> bool:
        return key in self.objects

    def put_and_verify(self, key: str, path: str, expected_sha256: str) -> None:
        data = Path(path).read_bytes()
        if hashlib.sha256(data).hexdigest() != expected_sha256:
            raise RuntimeError("stored bytes do not hash to what was uploaded")
        self.objects[key] = data

    def get(self, key: str, destination: str) -> None:
        Path(destination).write_bytes(self.objects[key])


CF_TABLES = (
    "cf_contribution_row",
    "cf_expenditure_row",
    "cf_independent_expenditure_row",
    "cf_fetch_observation",
    "cf_snapshot_body",
)


def _clear(session) -> None:
    session.rollback()
    session.execute(text("UPDATE cf_current_release SET release_id = NULL"))
    session.execute(text("DELETE FROM cf_release"))
    for table in CF_TABLES:
        session.execute(text(f"DELETE FROM {table}"))
    session.execute(text("DELETE FROM cf_snapshot"))
    session.commit()


@pytest.fixture()
def db(seed_database: None):
    session = get_session_factory()()
    _clear(session)
    try:
        yield session
    finally:
        _clear(session)
        session.close()


@pytest.fixture()
def board() -> Iterator[FakeBoard]:
    fake = FakeBoard()
    server = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
    server.board = fake  # type: ignore[attr-defined]
    fake.port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield fake
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


@pytest.fixture()
def store() -> MemoryStore:
    return MemoryStore()


def run(db, board: FakeBoard, store: MemoryStore, **kwargs) -> cf.LoadReport:
    return cf.load_campaign_finance(
        db,
        store=store,
        landing_page=board.landing_page,
        log=lambda message: None,
        **kwargs,
    )


def publish_first(db, board: FakeBoard, store: MemoryStore) -> cf.LoadReport:
    """Get a first set live.

    There is deliberately no first-load exception: a first import has nothing to
    compare against, so it quarantines like any other and an operator publishes it
    by naming the exact 3 hashes they reviewed. This helper is that operator.
    """
    first = run(db, board, store)
    assert first.refusal is not None
    hashes = [outcome.fetched.content_hash for outcome in first.outcomes]
    published = run(db, board, store, publish_hashes=hashes)
    assert published.published, published.summary()
    return published


def contribution_rows(db, snapshot_id) -> list[models.CampaignFinanceContributionRow]:
    return list(
        db.scalars(
            select(models.CampaignFinanceContributionRow)
            .where(models.CampaignFinanceContributionRow.snapshot_id == snapshot_id)
            .order_by(models.CampaignFinanceContributionRow.row_number)
        )
    )


def snapshot_of(db, release, dataset: Dataset) -> models.CampaignFinanceSnapshot:
    column = cf.RELEASE_SNAPSHOT_COLUMN[dataset]
    return db.get(models.CampaignFinanceSnapshot, getattr(release, column))


def live(db) -> Optional[models.CampaignFinanceRelease]:
    db.expire_all()
    return cf.live_release(db)


# --- The pinned contract ----------------------------------------------------


def test_each_pinned_header_line_parses_to_its_own_column_list() -> None:
    """The header is a contract in code, not something learned from a download.

    Taking it from the previous snapshot would make one bad first import the
    permanent standard. This keeps the pinned line and the pinned column list from
    drifting apart, which is the only way the contract could quietly become wrong.
    """
    import csv
    import io

    for spec in cf.DATASETS:
        parsed = next(csv.reader(io.StringIO(spec.header_line)))
        assert parsed == [column.source for column in spec.columns], spec.key


def test_row_tables_hold_only_the_source_columns_plus_snapshot_and_record_number() -> (
    None
):
    """Nothing human may live on an imported row.

    The published set is rebuilt on every load, so a note stored here is silently
    destroyed the next time the Board's file grows. A human decision belongs on a
    table keyed by durable identifiers instead (§4.4). This asserts there is
    nowhere on these tables for one to be put — including no timestamp, which
    someone would eventually read as data.
    """
    for spec in cf.DATASETS:
        actual = {column.name for column in spec.table.__table__.columns}
        expected = {"snapshot_id", "row_number", *spec.attributes}
        assert actual == expected, spec.key


# --- Resolving the download links -------------------------------------------


def test_negative_download_numbers_resolve_from_the_landing_page(board) -> None:
    """All 3 numbers are negative, and a `\\d+` pattern resolves a different file."""
    http = cf._http_session()
    resolved = cf.resolve_downloads(http, board.landing_page)
    for spec in cf.DATASETS:
        assert resolved[spec.dataset].download_id == DOWNLOAD_IDS[spec.dataset]
        assert resolved[spec.dataset].download_id.startswith("-")


def test_a_renamed_dataset_heading_stops_the_run(board) -> None:
    """Loudly, because silently resolving a different file is the worst outcome."""
    board.headings[Dataset.contributions] = "Itemized gifts received of over $200"
    with pytest.raises(cf.CampaignFinanceRefusal) as refusal:
        cf.resolve_downloads(cf._http_session(), board.landing_page)
    assert "contributions" in str(refusal.value)


def test_a_server_error_is_retried_rather_than_treated_as_a_moved_link(
    db, board, store
) -> None:
    """The contributions download answered HTTP 500 once and succeeded on retry."""
    board.status_codes[Dataset.contributions] = 500
    cf.RETRY_PAUSE_SECONDS, original = 0, cf.RETRY_PAUSE_SECONDS
    try:
        report = run(db, board, store, dry_run=True)
    finally:
        cf.RETRY_PAUSE_SECONDS = original
    contributions = report.outcomes[0]
    assert contributions.fetched.content_error is None
    assert contributions.measurements is not None
    assert contributions.measurements.row_count == len(CONTRIBUTION_ROWS)


# --- What the rows must survive as ------------------------------------------


def test_two_identical_payments_both_survive_and_differ_only_by_record_number(
    db, board, store
) -> None:
    """Same donor, same day, same amount happens in real filings.

    A single official download carries 20,524 rows identical to another row, one of
    them repeated 119 times, so any key built from a row's contents would delete
    money the Board published.
    """
    report = publish_first(db, board, store)
    release = db.get(models.CampaignFinanceRelease, report.release_id)
    rows = contribution_rows(db, snapshot_of(db, release, Dataset.contributions).id)

    twins = [row for row in rows if row.contributor == "Wivoda, Zachary"]
    assert len(twins) == 2
    first, second = twins
    assert first.row_number != second.row_number
    for attribute in cf.SPEC_BY_DATASET[Dataset.contributions].attributes:
        assert getattr(first, attribute) == getattr(second, attribute)

    snapshot = snapshot_of(db, release, Dataset.contributions)
    assert snapshot.row_count == len(CONTRIBUTION_ROWS)
    assert snapshot.distinct_row_count == len(CONTRIBUTION_ROWS) - 1


def test_a_four_decimal_amount_round_trips_exactly(db, board, store) -> None:
    """4 expenditure rows are finer than a cent, so 2 decimals would round money."""
    report = publish_first(db, board, store)
    release = db.get(models.CampaignFinanceRelease, report.release_id)
    rows = contribution_rows(db, snapshot_of(db, release, Dataset.contributions).id)
    penny = next(row for row in rows if row.contributor == "Penny, Paula")
    assert penny.amount == Decimal("1234.5678")


def test_a_zip_with_a_leading_zero_keeps_it(db, board, store) -> None:
    """9,007 zips are shorter than 5 characters, so a numeric zip loses the zero."""
    report = publish_first(db, board, store)
    release = db.get(models.CampaignFinanceRelease, report.release_id)
    rows = contribution_rows(db, snapshot_of(db, release, Dataset.contributions).id)
    assert next(
        row for row in rows if row.contributor == "Smith, Jane"
    ).contrib_zip == ("0212")


def test_a_type_that_contradicts_its_registration_band_keeps_the_files_type(
    db, board, store
) -> None:
    """4,672 real rows carry a type that disagrees with their number's band.

    The Libertarian Party of Minnesota is registration 40858 with type PTU, where
    the band rule people assume would call 30000 and above a committee or fund. The
    file's own type column is what to believe, and nothing here may "correct" it.
    """
    report = publish_first(db, board, store)
    release = db.get(models.CampaignFinanceRelease, report.release_id)
    rows = contribution_rows(db, snapshot_of(db, release, Dataset.contributions).id)
    libertarians = next(row for row in rows if row.recipient_reg_num == "40858")
    assert libertarians.recipient_type == "PTU"


def test_the_sources_backslash_escaped_quote_keeps_its_record(db, board, store) -> None:
    """Strict parsing rejects 35 records of real money across the 3 files.

    So the record is kept as the default reader reads it and counted, never
    repaired: no mechanical rule reads both this and the expenditure rows where the
    same 2 characters are literal data.
    """
    report = publish_first(db, board, store)
    release = db.get(models.CampaignFinanceRelease, report.release_id)
    snapshot = snapshot_of(db, release, Dataset.contributions)
    rows = contribution_rows(db, snapshot.id)
    amazon = next(row for row in rows if row.contributor == "Prime, Amazon")
    assert amazon.amount == Decimal("6.4900")
    assert amazon.contrib_zip == "55372"
    assert snapshot.malformed_quote_record_count == 1


def test_a_newline_inside_a_quoted_field_does_not_shift_the_record_count(
    db, board, store
) -> None:
    """720 newlines sit inside quoted fields in the real files."""
    report = publish_first(db, board, store)
    release = db.get(models.CampaignFinanceRelease, report.release_id)
    rows = contribution_rows(db, snapshot_of(db, release, Dataset.contributions).id)
    assert len(rows) == len(CONTRIBUTION_ROWS)
    assert [row.row_number for row in rows] == list(range(1, len(rows) + 1))
    wrapped = next(row for row in rows if row.contributor == "Phillippe, Janet")
    assert wrapped.in_kind_descr == "A book\nby Michelle Obama"


def test_year_and_the_rows_own_date_are_both_stored(db, board, store) -> None:
    """They disagree on 702 real rows, so neither may be derived from the other."""
    report = publish_first(db, board, store)
    release = db.get(models.CampaignFinanceRelease, report.release_id)
    rows = contribution_rows(db, snapshot_of(db, release, Dataset.contributions).id)
    disagreeing = next(row for row in rows if row.contributor == "Newyear, Nora")
    assert disagreeing.year == 2025
    assert disagreeing.receipt_date.isoformat() == "2026-01-04"


def test_every_row_carries_its_date_and_a_traceable_record_number(
    db, board, store
) -> None:
    """The retired build lost half its dates while the source dates every row."""
    report = publish_first(db, board, store)
    release = db.get(models.CampaignFinanceRelease, report.release_id)
    for spec in cf.DATASETS:
        snapshot = snapshot_of(db, release, spec.dataset)
        date_attribute = next(
            column.attribute for column in spec.columns if column.kind == "date"
        )
        rows = list(
            db.scalars(select(spec.table).where(spec.table.snapshot_id == snapshot.id))
        )
        assert rows
        assert all(getattr(row, date_attribute) is not None for row in rows)
        assert snapshot.blank_date_count == 0
        assert sorted(row.row_number for row in rows) == list(range(1, len(rows) + 1))


# --- Running it twice -------------------------------------------------------


def test_running_the_same_import_twice_changes_nothing(db, board, store) -> None:
    """The whole point of replacing sets rather than merging rows.

    What may grow is the record of *what we checked and when*: a second run adds one
    append-only fetch observation per dataset. What may not change is anything
    published — the live release, every row, and every measurement derived from them.
    """
    first = publish_first(db, board, store)
    before = _published_state(db)

    second = run(db, board, store)
    assert second.no_change
    assert not second.published
    assert second.release_id is None

    assert _published_state(db) == before
    assert live(db).id == first.release_id
    snapshots = db.scalars(select(models.CampaignFinanceSnapshot)).all()
    assert len(snapshots) == 3
    observations = db.scalars(select(models.CampaignFinanceFetchObservation)).all()
    # 2 runs that fetched, plus the quarantined first attempt in publish_first.
    assert len(observations) == 9
    assert [
        observation
        for observation in observations
        if observation.reused_existing_snapshot
    ]


def _published_state(db) -> dict:
    """Everything a reader could see, as comparable values."""
    db.expire_all()
    release = cf.live_release(db)
    state: dict = {"release": None if release is None else str(release.id)}
    for spec in cf.DATASETS:
        snapshot = snapshot_of(db, release, spec.dataset)
        state[spec.key] = {
            "hash": snapshot.content_hash,
            "rows": snapshot.row_count,
            "amount_sum": str(snapshot.amount_sum),
            "distinct": snapshot.distinct_row_count,
            "by_year": snapshot.rows_by_year,
            "status": snapshot.status.value,
        }
        state[f"{spec.key}_rows"] = [
            tuple(
                str(getattr(row, attribute))
                for attribute in ("row_number", *spec.attributes)
            )
            for row in db.scalars(
                select(spec.table)
                .where(spec.table.snapshot_id == snapshot.id)
                .order_by(spec.table.row_number)
            )
        ]
    return state


# --- What a bad download must do --------------------------------------------


def test_a_truncated_download_is_kept_quarantined_and_the_previous_set_stays_live(
    db, board, store
) -> None:
    """A half-download that looks like real data is the failure most likely to hide.

    A parse error can never be the guard here, because the files are not valid CSV
    to begin with, so the row-count and byte-size bands are all there is.
    """
    first = publish_first(db, board, store)
    before = _published_state(db)

    board.set_rows(Dataset.contributions, CONTRIBUTION_ROWS[:2])
    report = run(db, board, store)

    assert report.refusal is not None
    assert not report.published
    assert [outcome.spec.key for outcome in report.quarantined] == ["contributions"]
    failed = {check.name for outcome in report.quarantined for check in outcome.blocked}
    assert "row_count_within_band" in failed

    assert live(db).id == first.release_id
    assert _published_state(db) == before

    truncated = db.scalars(
        select(models.CampaignFinanceSnapshot).where(
            models.CampaignFinanceSnapshot.content_hash
            == report.outcomes[0].fetched.content_hash
        )
    ).one()
    assert truncated.status == SnapshotStatus.quarantined
    assert "row_count_within_band" in str(truncated.validation_json)
    # Kept, not discarded: the bytes are what a diagnosis reads, and the Board
    # publishes no archive to re-fetch them from.
    body = db.get(models.CampaignFinanceSnapshotBody, truncated.id)
    assert body is not None
    assert store.exists(body.object_key)


def test_a_duplicated_download_is_quarantined_too(db, board, store) -> None:
    """Growth quarantines as well as shrinkage.

    A file duplicated end to end passes every check that only watches for a fall,
    and publishing it would roughly double the money on every page.
    """
    publish_first(db, board, store)
    board.set_rows(Dataset.contributions, CONTRIBUTION_ROWS * 2)
    report = run(db, board, store)

    assert report.refusal is not None
    failed = {check.name for outcome in report.quarantined for check in outcome.blocked}
    assert "row_count_within_band" in failed
    assert "amount_sum_within_band" in failed


def test_an_html_error_page_answered_as_a_download_is_refused(db, board, store) -> None:
    """A stale download number answers HTTP 200 with a 39 KB HTML error page."""
    board.download_ids[Dataset.contributions] = "-1"
    board.bodies[Dataset.contributions] = (
        b"<!DOCTYPE html><html><body>Page not available</body></html>"
    )
    report = run(db, board, store, dry_run=True)
    contributions = report.outcomes[0]
    assert contributions.fetched.content_error is not None
    assert "first line is not the expected column header" in (
        contributions.fetched.content_error
    )
    assert report.refusal is not None


def test_a_download_that_does_not_name_the_file_is_refused(db, board, store) -> None:
    """The Content-Disposition filename is the other half of the content check."""
    board.filenames[Dataset.expenditures] = "All - Something Else.csv"
    report = run(db, board, store, dry_run=True)
    expenditures = report.outcomes[1]
    assert expenditures.fetched.content_error is not None
    assert "did not name the expenditures file" in expenditures.fetched.content_error


@pytest.mark.parametrize(
    ("bad_date", "why"),
    [
        ("44196", "a spreadsheet serial, which the retired build stored as a date"),
        ("2026-31-03", "well shaped and not a real calendar date"),
        ("2025/07/10", "a plausible format the source does not use"),
    ],
)
def test_a_date_that_is_not_an_iso_calendar_date_stops_the_run(
    db, board, store, bad_date: str, why: str
) -> None:
    rows = list(CONTRIBUTION_ROWS)
    rows[0] = rows[0].replace("2025-07-10", bad_date)
    board.set_rows(Dataset.contributions, rows)
    report = run(db, board, store, dry_run=True)
    contributions = report.outcomes[0]
    assert contributions.measurements is not None
    assert contributions.measurements.errors, why
    assert "parses_completely" in {check.name for check in contributions.blocked}


def test_a_blank_date_in_a_dataset_that_had_none_stops_the_run(
    db, board, store
) -> None:
    """§4.3's own wording. The retired build lost half its dates."""
    publish_first(db, board, store)
    rows = list(CONTRIBUTION_ROWS)
    rows[0] = rows[0].replace(",2025-07-10,", ",,")
    board.set_rows(Dataset.contributions, rows)
    report = run(db, board, store)
    assert "no_new_blank_dates_or_amounts" in {
        check.name for outcome in report.quarantined for check in outcome.blocked
    }


def test_an_amount_finer_than_the_column_stops_the_run_rather_than_rounding(
    db, board, store
) -> None:
    """A 5-decimal value means the source changed. Rounding it moves real money."""
    rows = list(CONTRIBUTION_ROWS)
    rows[0] = rows[0].replace(",250.0000,", ",250.00001,")
    board.set_rows(Dataset.contributions, rows)
    report = run(db, board, store, dry_run=True)
    errors = report.outcomes[0].measurements.errors  # type: ignore[union-attr]
    assert any("decimal places" in error for error in errors)


def test_a_record_with_the_wrong_number_of_fields_stops_the_run(
    db, board, store
) -> None:
    rows = list(CONTRIBUTION_ROWS)
    rows.append("19200,too,few,fields")
    board.set_rows(Dataset.contributions, rows)
    report = run(db, board, store, dry_run=True)
    errors = report.outcomes[0].measurements.errors  # type: ignore[union-attr]
    assert any("fields, expected 15" in error for error in errors)


def test_naming_the_hashes_never_waives_a_structural_check(db, board, store) -> None:
    """An operator can accept a set the comparisons flagged, and nothing more.

    A header that does not match, a record with the wrong field count, a date that
    is not a date and an amount that would have to be rounded are not judgement
    calls, so there is no flag that lets one through.
    """
    rows = list(CONTRIBUTION_ROWS)
    rows[0] = rows[0].replace("2025-07-10", "44196")
    board.set_rows(Dataset.contributions, rows)
    first = run(db, board, store)
    hashes = [outcome.fetched.content_hash for outcome in first.outcomes]
    second = run(db, board, store, publish_hashes=hashes)
    assert not second.published
    assert "parses_completely" in {
        check.name for outcome in second.quarantined for check in outcome.blocked
    }


# --- Releases -----------------------------------------------------------------


def test_one_file_changing_while_two_do_not_publishes_a_set_from_this_run(
    db, board, store
) -> None:
    """Files fetched on different days must never be shown together.

    So a release names the 3 snapshots this run confirmed, and the 2 unchanged ones
    are current data rather than stale: this run downloaded them and checked their
    bytes, which the fetch observations record.
    """
    first = publish_first(db, board, store)
    rows = list(CONTRIBUTION_ROWS)
    # Changed without changing the record count, because a fixture of 10 rows
    # cannot gain one without leaving the row-count band.
    rows[0] = rows[0].replace("Retired", "Teacher")
    board.set_rows(Dataset.contributions, rows)

    second = run(db, board, store)
    assert second.published
    assert second.release_id != first.release_id

    release = db.get(models.CampaignFinanceRelease, second.release_id)
    run_id = release.ingestion_run_id
    for spec in cf.DATASETS:
        snapshot = snapshot_of(db, release, spec.dataset)
        confirmed_this_run = db.scalars(
            select(models.CampaignFinanceFetchObservation).where(
                models.CampaignFinanceFetchObservation.snapshot_id == snapshot.id,
                models.CampaignFinanceFetchObservation.ingestion_run_id == run_id,
            )
        ).all()
        assert len(confirmed_this_run) == 1, spec.key

    old = db.get(models.CampaignFinanceRelease, first.release_id)
    assert old.status == ReleaseStatus.superseded
    assert live(db).id == second.release_id
    # The superseded contributions snapshot keeps its body and its measurements and
    # loses only its parsed rows.
    superseded = snapshot_of(db, old, Dataset.contributions)
    assert superseded.status == SnapshotStatus.pruned
    assert db.get(models.CampaignFinanceSnapshotBody, superseded.id) is not None
    assert (
        db.scalars(
            select(models.CampaignFinanceContributionRow).where(
                models.CampaignFinanceContributionRow.snapshot_id == superseded.id
            )
        ).first()
        is None
    )
    # The 2 unchanged files keep their rows, because the new release still names them.
    for dataset in (Dataset.expenditures, Dataset.independent_expenditures):
        kept = snapshot_of(db, release, dataset)
        assert kept.status == SnapshotStatus.loaded
        assert (
            db.scalars(
                select(cf.SPEC_BY_DATASET[dataset].table).where(
                    cf.SPEC_BY_DATASET[dataset].table.snapshot_id == kept.id
                )
            ).first()
            is not None
        )


def test_a_republished_set_whose_rows_were_pruned_is_reloaded_not_reused(
    db, board, store
) -> None:
    """The Board can republish byte-identical files.

    A pruned snapshot still carries the hash, so treating it as "unchanged" would
    publish a dataset with no rows at all. It is marked pruned and reloaded instead.
    """
    original_rows = list(CONTRIBUTION_ROWS)
    publish_first(db, board, store)
    changed = list(original_rows)
    changed[0] = changed[0].replace("Retired", "Teacher")
    board.set_rows(Dataset.contributions, changed)
    run(db, board, store)

    # Back to the exact original bytes, whose snapshot is now pruned.
    board.set_rows(Dataset.contributions, original_rows)
    third = run(db, board, store)
    assert third.published

    release = db.get(models.CampaignFinanceRelease, third.release_id)
    snapshot = snapshot_of(db, release, Dataset.contributions)
    assert snapshot.status == SnapshotStatus.loaded
    assert len(contribution_rows(db, snapshot.id)) == len(original_rows)


def test_publishing_refuses_a_candidate_older_than_the_live_release(
    db, board, store
) -> None:
    """Two overlapping imports let the slower one replace newer data with older.

    A "one published release" rule limits quantity, not age, so the pointer row is
    taken with FOR UPDATE and the fetch window compared inside the lock.
    """
    from datetime import UTC, datetime, timedelta

    published = publish_first(db, board, store)
    live_release = db.get(models.CampaignFinanceRelease, published.release_id)

    board.set_rows(
        Dataset.contributions,
        [row.replace("Retired", "Nurse") for row in CONTRIBUTION_ROWS],
    )
    candidate = run(db, board, store, dry_run=True)
    assert candidate.refusal is None
    # Give the candidate real snapshots, then try to publish it as though its fetch
    # had started before the live release's did.
    staged = run(db, board, store)
    assert staged.published
    with pytest.raises(cf.CampaignFinanceRefusal) as refusal:
        cf.publish(
            db,
            staged.outcomes,
            fetch_started_at=live_release.fetch_started_at - timedelta(hours=1),
            fetch_completed_at=datetime.now(UTC),
            ingestion_run_id=None,
            notes=None,
        )
    assert "older data" in str(refusal.value)


# --- The two checks this loader cannot run -----------------------------------


def test_the_two_unrunnable_checks_are_recorded_as_not_run_with_their_reason(
    db, board, store
) -> None:
    """Never as passed.

    Reconciling against a filing's official total and resolving a registration
    number against the Board's filer directory both need data no table here holds
    yet, even though §9 has since established the route to each.
    """
    report = run(db, board, store, dry_run=True)
    for outcome in report.outcomes:
        recorded = {check.name: check for check in outcome.checks}
        for name in (
            "reported_totals_reconcile",
            "registration_numbers_resolve_to_a_known_filer",
        ):
            assert recorded[name].status == "not_run"
            assert recorded[name].detail
            assert not recorded[name].blocks_publication


def test_a_published_snapshot_records_the_checks_it_passed(db, board, store) -> None:
    report = publish_first(db, board, store)
    release = db.get(models.CampaignFinanceRelease, report.release_id)
    snapshot = snapshot_of(db, release, Dataset.contributions)
    names = {
        check["name"]: check["status"] for check in snapshot.validation_json["checks"]
    }
    assert names["download_is_the_expected_file"] == "passed"
    assert names["parses_completely"] == "passed"
    assert names["previous_release_to_compare_against"] == "overridden"
    assert names["reported_totals_reconcile"] == "not_run"
    assert release.notes is not None and snapshot.content_hash in release.notes


def test_a_dry_run_writes_nothing(db, board, store) -> None:
    report = run(db, board, store, dry_run=True)
    assert report.dry_run
    assert not report.published
    assert db.scalars(select(models.CampaignFinanceSnapshot)).all() == []
    assert store.objects == {}


def test_measurements_record_what_the_checks_compare(db, board, store) -> None:
    """Kept on the snapshot rather than recomputed from rows.

    That is what lets a superseded set's rows be pruned without losing the ability
    to check the next download.
    """
    report = publish_first(db, board, store)
    release = db.get(models.CampaignFinanceRelease, report.release_id)
    snapshot = snapshot_of(db, release, Dataset.contributions)
    assert snapshot.row_count == len(CONTRIBUTION_ROWS)
    assert snapshot.distinct_row_count == len(CONTRIBUTION_ROWS) - 1
    assert snapshot.negative_amount_sum == Decimal("-40.0000")
    assert snapshot.rows_by_year == {"2025": len(CONTRIBUTION_ROWS)}
    assert snapshot.distinct_filer_count == 2
    assert snapshot.column_names == [
        column.source for column in cf.SPEC_BY_DATASET[Dataset.contributions].columns
    ]
    assert snapshot.blank_counts_by_column["Contrib Reg Num"] == len(CONTRIBUTION_ROWS)
    # Added up by hand from the fixture above, on purpose: a total computed by
    # re-parsing the fixture would only prove the parser agrees with itself.
    # 250 + 30 + 30 + 1234.5678 + 6.49 + 15 + 500 + 75 + 5000 - 40.
    assert snapshot.amount_sum == Decimal("7101.0578")
