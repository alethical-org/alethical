"""What the lobbying loader must guarantee about Minnesota's download (#1862).

Every test here stands in for a way this import could publish something false. The
two that matter most:

* **Running the same import twice changes nothing**, including when the export
  reshuffles its rows — "did the data change" is decided on the records, not bytes.
* **A bad download is kept and never published.** The Board's own error page arrives
  as HTTP 200, and a half-download that looks like real data is the failure most
  likely to go unnoticed.

Fixtures are tiny hand-written CSVs, never the real 17,842 rows: §8 of
`docs/architecture/campaign-finance-system-design.md` is explicit that every count in
that document is a measurement of one day and never a requirement to assert. What the
fixtures *do* reproduce verbatim are this source's awkward shapes — `.0000` amounts
with no integer part, a principal whose name carries a comma, a row with every money
cell blank (48 of those on the real 31 Aug 2026 file), the 4-way type split that only
begins in 2024, LF line endings where the campaign-finance files use CRLF, and the
negative download number a `\\d+` pattern would silently mangle.

The Board is faked by a local HTTP server rather than by stubbing ``requests``, so the
real download path runs: the landing page is parsed, the negative download number is
resolved from its labels — past a "2020 only" row under the same heading and a
lobbyist-list section that must not match — and the body arrives over a real socket.

Needs the local Postgres on port 54329.
"""

from __future__ import annotations

import hashlib
import threading
from dataclasses import dataclass
from decimal import Decimal
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Iterator
from urllib.parse import parse_qs, urlparse

import pytest
from sqlalchemy import select, text

from alethical.db import models
from alethical.db.session import get_session_factory
from alethical.pipeline import lobbying_expenditures as lob

SnapshotStatus = models.CampaignFinanceSnapshotStatus

# The real numbers: the file we want is negative on purpose, so the `-?\d+` trap
# stays live, and the "2020 only" decoy keeps its real positive number.
DOWNLOAD_ID = "-728390027"
DECOY_2020_ID = "102614850"
LOBBYIST_LIST_ID = "-161966777"

LOBBYING_ROWS = [
    # `.0000` with no integer part is how the file prints an explicit zero.
    '"Allstate Insurance Co",14,2015,.0000,.0000,.0000,.0000,38500.0000,38500.0000',
    # A principal whose name carries a comma, quoted like the source quotes it.
    '"Moorhead, City of",1893,2015,.0000,.0000,.0000,.0000,12000.0000,12000.0000',
    # A row carrying no amounts at all: filed, but nothing reported. Blank is "not
    # reported", never 0, so every money cell must land as NULL.
    '"Moorhead, City of",1893,2014,,,,,,',
    # The 4-way type split begins in 2024: General is empty, Legislative carries it.
    '"Allstate Insurance Co",14,2024,.0000,42000.0000,1500.0000,.0000,,43500.0000',
    # The 1 filer that used the new columns in 2023 (§2.2).
    '"M A Mortenson Co",5551,2023,.0000,4000.0000,.0000,30000.0000,.0000,34000.0000',
    # Same entity as row 1, different year, every money value identical. Pins a
    # real bug the first dry run against the Board caught: the duplicate check
    # indexed the raw record with a position built for the typed row, so it read a
    # money column as the year and counted 12,549 false duplicates on the real
    # file. (Entity ID, Report Year) differs here, so a correct check stays quiet.
    '"Allstate Insurance Co",14,2016,.0000,.0000,.0000,.0000,38500.0000,38500.0000',
]


def csv_bytes(rows: list[str]) -> bytes:
    """The pinned header line plus these records, LF-terminated like the source."""
    return ("\n".join([lob.HEADER_LINE, *rows]) + "\n").encode("utf-8")


# --- The Board, faked over a real socket --------------------------------------


@dataclass
class FakeBoard:
    body: bytes = b""
    filename: str = (
        "Principal Expenditures - 2009 - Present - Principal Expenditures - "
        "Lobbying.csv"
    )
    download_id: str = DOWNLOAD_ID
    status_code: int = 200
    # When set, the wanted download answers the Board's real failure shape: HTTP
    # 200 and an HTML error page typed as a download, with no filename.
    serve_error_page: bool = False
    port: int = 0

    def __post_init__(self) -> None:
        if not self.body:
            self.body = csv_bytes(list(LOBBYING_ROWS))

    def set_rows(self, rows: list[str]) -> None:
        self.body = csv_bytes(rows)

    @property
    def landing_page(self) -> str:
        return f"http://127.0.0.1:{self.port}/landing"

    def landing_html(self) -> str:
        return (
            "<html><body>"
            # A section the resolver must not match: lobbyist lists, not spending.
            "<h1>Lobbyist Information</h1><table>"
            "<tr><th>Download name</th><th>Data included</th><th>Download data</th></tr>"
            "<tr><td>Active Lobbyists</td><td>Current Active Lobbyists</td>"
            f'<td><a class="csvFile" href="/files/?download={LOBBYIST_LIST_ID}">'
            "csv</a></td></tr>"
            "</table>"
            "<h1>Principal expenditures</h1><table>"
            "<tr><th>Download name</th><th>Data included</th><th>Download data</th></tr>"
            # The decoy row under the SAME heading: a strict subset of the file we
            # want, so resolving it instead would silently publish 1 year as 11.
            "<tr><td>Principal expenditures - 2020 only</td><td>2020 only.</td>"
            f'<td><a class="csvFile" href="/files/?download={DECOY_2020_ID}">'
            "csv</a></td></tr>"
            "<tr><td>Principal expenditures - 2009 - Present</td>"
            "<td>2015 - Present.</td>"
            f'<td><a class="csvFile" href="/files/?download={self.download_id}">'
            "csv</a></td></tr>"
            "</table></body></html>"
        )


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
        if number != board.download_id or board.serve_error_page:
            # What the Board really does with a number that no longer resolves:
            # HTTP 200 and an HTML error page typed as a download.
            body = b"<!DOCTYPE html><html><body>Page not available</body></html>"
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        status = board.status_code
        if status >= 500:
            board.status_code = 200  # the next attempt succeeds
            self.send_response(status)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        body = board.body
        self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header(
            "Content-Disposition", f'attachment; filename="{board.filename}"'
        )
        # No Content-Length and a chunked transfer: nothing in the response tells
        # you the file arrived whole.
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


LOBBYING_TABLES = (
    "lobbying_expenditure_row",
    "lobbying_fetch_observation",
)


def _clear(session) -> None:
    session.rollback()
    session.execute(
        text(
            "UPDATE lobbying_expenditure_current SET snapshot_id = NULL "
            "WHERE snapshot_id IS NOT NULL"
        )
    )
    for table in LOBBYING_TABLES:
        session.execute(text(f"DELETE FROM {table}"))
    session.execute(text("DELETE FROM lobbying_expenditure_snapshot"))
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


def run(db, board: FakeBoard, store: MemoryStore, **kwargs) -> lob.LoadReport:
    return lob.load_lobbying_expenditures(
        db,
        store=store,
        landing_page=board.landing_page,
        log=lambda message: None,
        **kwargs,
    )


def publish_first(db, board: FakeBoard, store: MemoryStore) -> lob.LoadReport:
    """Get a first set live.

    There is deliberately no first-load exception: a first import has nothing to
    compare against, so it quarantines like any other and an operator publishes it
    by naming the exact record hash they reviewed. This helper is that operator.
    """
    first = run(db, board, store)
    assert first.refusal is not None
    published = run(
        db, board, store, publish_hash=first.outcome.measurements.record_set_hash
    )
    assert published.published, published.summary()
    return published


def publish_as_operator(db, board: FakeBoard, store: MemoryStore) -> lob.LoadReport:
    """Publish whatever the Board currently serves, waving through the comparison
    checks the way an operator who reviewed the hash would.

    The fixture sets are 5 rows, so adding 1 row is a 20% jump that correctly
    trips the growth band built for the real 17,842-row file. Tests about
    pointer and prune behaviour publish through this helper; tests about the
    bands themselves never use it.
    """
    first = run(db, board, store)
    if first.published:
        return first
    published = run(
        db, board, store, publish_hash=first.outcome.measurements.record_set_hash
    )
    assert published.published, published.summary()
    return published


def loaded_rows(db, snapshot_id) -> list[models.LobbyingExpenditureRow]:
    return list(
        db.scalars(
            select(models.LobbyingExpenditureRow)
            .where(models.LobbyingExpenditureRow.snapshot_id == snapshot_id)
            .order_by(models.LobbyingExpenditureRow.row_number)
        )
    )


def observation_count(db) -> int:
    return len(list(db.scalars(select(models.LobbyingExpenditureFetchObservation))))


# --- The pinned contract -------------------------------------------------------


def test_pinned_header_line_parses_to_exactly_the_column_list() -> None:
    """The header contract and the column list can never drift apart."""
    import csv as csv_module
    import io

    parsed = next(csv_module.reader(io.StringIO(lob.HEADER_LINE)))
    assert parsed == [column.source for column in lob.COLUMNS]


def test_row_table_holds_only_the_source_columns_plus_snapshot_and_record_number() -> (
    None
):
    """Nothing human, no timestamps: the published set is rebuilt on every load, so
    anything else stored here would be silently destroyed (§4.4)."""
    table = models.LobbyingExpenditureRow.__table__
    assert {column.name for column in table.columns} == {
        "snapshot_id",
        "row_number",
        *(column.attribute for column in lob.COLUMNS),
    }


# --- Resolving the link --------------------------------------------------------


def test_resolver_finds_the_2009_present_file_not_its_decoys(board) -> None:
    """Two decoys, both real: the "2020 only" row under the same heading (a strict
    subset — resolving it would silently publish 1 year as 11), and the lobbyist
    list section, which is a different dataset entirely."""
    resolved = lob.resolve_download(lob._http_session(), board.landing_page)
    assert resolved.download_id == DOWNLOAD_ID


def test_a_renamed_row_label_breaks_the_run_rather_than_guessing(board) -> None:
    board.download_id = DOWNLOAD_ID  # the page still lists it...
    original = board.landing_html

    def renamed() -> str:
        return original().replace(
            "Principal expenditures - 2009 - Present", "Principal spending - All"
        )

    board.landing_html = renamed  # type: ignore[method-assign]
    with pytest.raises(lob.LobbyingRefusal, match="labels have changed"):
        lob.resolve_download(lob._http_session(), board.landing_page)


# --- What rows must survive as -------------------------------------------------


def test_first_import_quarantines_then_publishes_by_named_hash(
    db, board, store
) -> None:
    """A first import has nothing to compare against, so it quarantines by design,
    keeps its bytes, and publishes only when an operator names the record hash."""
    first = run(db, board, store)
    assert first.refusal is not None
    snapshot = db.get(models.LobbyingExpenditureSnapshot, first.outcome.snapshot_id)
    assert snapshot.status == SnapshotStatus.quarantined
    assert snapshot.object_key in store.objects  # the bytes are kept either way
    assert loaded_rows(db, snapshot.id) == []

    published = run(
        db, board, store, publish_hash=first.outcome.measurements.record_set_hash
    )
    assert published.published
    db.expire_all()
    live = lob.live_snapshot(db)
    assert live is not None and live.id == first.outcome.snapshot_id
    assert live.status == SnapshotStatus.loaded
    assert live.row_count == len(LOBBYING_ROWS)
    assert live.total_spent_sum == Decimal("166500.0000")
    assert live.distinct_entity_count == 3
    assert live.duplicate_entity_year_count == 0
    assert live.total_mismatch_count == 0


def test_blank_money_is_null_and_explicit_zero_is_zero(db, board, store) -> None:
    """The all-blank row is "not reported", never 0 — collapsing the two invents a
    fact about a named organisation (grounded-answers rule 12). `.0000` is the
    file's explicit zero and stays one."""
    publish_first(db, board, store)
    rows = loaded_rows(db, lob.live_snapshot(db).id)
    blank = next(row for row in rows if row.report_year == 2014)
    assert blank.principal == "Moorhead, City of"
    assert blank.total_spent is None
    assert blank.puc_lobbying_amount is None
    assert blank.general_lobbying_amount is None
    explicit = next(
        row for row in rows if row.report_year == 2015 and row.entity_id == "14"
    )
    assert explicit.puc_lobbying_amount == Decimal("0.0000")
    assert explicit.total_spent == Decimal("38500.0000")
    # The 2024 row: General blank (NULL), the money in Legislative.
    split = next(row for row in rows if row.report_year == 2024)
    assert split.general_lobbying_amount is None
    assert split.legislative_lobbying_amount == Decimal("42000.0000")


def test_amounts_finer_than_4_decimals_stop_the_run_unwaived(db, board, store) -> None:
    """A 5-decimal value means the source changed; rounding it would move real
    money, and no flag lets a structural failure through."""
    board.set_rows(
        ['"Allstate Insurance Co",14,2015,.00001,.0000,.0000,.0000,.0000,.00001']
    )
    report = run(db, board, store, publish_hash="anything")
    assert report.refusal is not None
    assert any(
        check.name == "parses_completely" and check.status == "failed"
        for check in report.outcome.checks
    )


# --- Running it twice ----------------------------------------------------------


def test_rerunning_an_unchanged_file_publishes_nothing_and_records_the_look(
    db, board, store
) -> None:
    publish_first(db, board, store)
    live_before = lob.live_snapshot(db).id
    again = run(db, board, store)
    assert again.no_change and not again.published
    db.expire_all()
    assert lob.live_snapshot(db).id == live_before
    # 3 downloads happened (quarantined first, published second, unchanged third);
    # every one is on the record with its own byte hash.
    assert observation_count(db) == 3
    assert len(loaded_rows(db, live_before)) == len(LOBBYING_ROWS)


def test_the_same_records_in_a_different_order_are_unchanged(db, board, store) -> None:
    """This export served byte-identical files on 2 downloads a minute apart, but 2
    fetches of 1 file are not a property of the source: the record-set hash is what
    decides, so a reshuffle must read as no change."""
    publish_first(db, board, store)
    board.set_rows(list(reversed(LOBBYING_ROWS)))
    again = run(db, board, store)
    assert again.no_change, again.summary()


# --- Bad downloads -------------------------------------------------------------


def test_the_boards_error_page_is_quarantined_with_its_bytes_kept(
    db, board, store
) -> None:
    """A stale download number answers HTTP 200 with an HTML error page typed as a
    download. The disposition check catches it, the bytes are kept for diagnosis,
    and nothing is published."""
    publish_first(db, board, store)
    live_before = lob.live_snapshot(db).id
    board.serve_error_page = True
    report = run(db, board, store)
    assert report.refusal is not None
    db.expire_all()
    assert lob.live_snapshot(db).id == live_before
    snapshot = db.get(models.LobbyingExpenditureSnapshot, report.outcome.snapshot_id)
    assert snapshot.status == SnapshotStatus.quarantined
    assert snapshot.object_key in store.objects
    assert "did not name the principal expenditures file" in (snapshot.error_text or "")


def test_a_truncated_file_is_quarantined_and_the_previous_set_stays_live(
    db, board, store
) -> None:
    """A half-download that parses cleanly is the failure most likely to look like
    real data. The count band and the year-loss check both catch this one."""
    publish_first(db, board, store)
    live_before = lob.live_snapshot(db).id
    board.set_rows(LOBBYING_ROWS[:1])
    report = run(db, board, store)
    assert report.refusal is not None
    failed = {check.name for check in report.outcome.blocked}
    assert "row_count_within_band" in failed
    db.expire_all()
    assert lob.live_snapshot(db).id == live_before
    assert len(loaded_rows(db, live_before)) == len(LOBBYING_ROWS)


def test_a_year_losing_rows_is_its_own_alarm(db, board, store) -> None:
    """Past years are nearly static in an annual file, so a year losing rows is the
    sharpest truncation signal there is — even when new rows keep the total count
    inside its band. The floor keeps small fixture years from tripping, so this
    fixture publishes a year holding enough rows to clear it."""
    year_2015 = [
        f'"Principal {index}",{index + 100},2015,.0000,.0000,.0000,.0000,'
        "100.0000,100.0000"
        for index in range(lob.YEAR_ROW_LOSS_FLOOR)
    ]
    board.set_rows(year_2015)
    publish_first(db, board, store)
    # The same size overall, with 2015 drained into 2016: the count band passes,
    # the year check must not.
    board.set_rows(
        year_2015[:-3]
        + [
            f'"Principal {index}",{index + 900},2016,.0000,.0000,.0000,.0000,'
            "100.0000,100.0000"
            for index in range(3)
        ]
    )
    report = run(db, board, store)
    assert report.refusal is not None
    assert any(
        check.name == "no_published_year_lost_rows" and check.status == "failed"
        for check in report.outcome.checks
    )


def test_a_duplicate_entity_year_pair_quarantines(db, board, store) -> None:
    """0 duplicate pairs on every measured file, and a duplicate double-counts a
    principal's year wherever rows are summed per principal."""
    publish_first(db, board, store)
    board.set_rows(
        list(LOBBYING_ROWS)
        + ['"Allstate Insurance Co",14,2015,.0000,.0000,.0000,.0000,1.0000,1.0000']
    )
    report = run(db, board, store)
    assert report.refusal is not None
    assert any(
        check.name == "entity_year_pairs_stay_unique" and check.status == "failed"
        for check in report.outcome.checks
    )


def test_a_total_that_is_not_the_sum_of_its_parts_quarantines(db, board, store) -> None:
    """Published figures sum `Total spent`, so its relationship to the 5 type
    columns drifting is never silent."""
    publish_first(db, board, store)
    board.set_rows(
        list(LOBBYING_ROWS)
        + ['"Drift Co",7777,2025,.0000,.0000,.0000,.0000,100.0000,999.0000']
    )
    report = run(db, board, store)
    assert report.refusal is not None
    assert any(
        check.name == "total_spent_is_the_sum_of_its_parts" and check.status == "failed"
        for check in report.outcome.checks
    )


def test_a_changed_header_is_structural_and_no_hash_waives_it(db, board, store) -> None:
    publish_first(db, board, store)
    board.body = (
        "Principal,Entity,Year,Total\n" + '"Allstate Insurance Co",14,2015,1.0\n'
    ).encode("utf-8")
    report = run(db, board, store, publish_hash="deadbeef")
    assert report.refusal is not None
    assert any(
        check.name == "download_is_the_expected_file" and check.status == "failed"
        for check in report.outcome.checks
    )


# --- Releases and pruning ------------------------------------------------------


def test_prune_keeps_the_live_set_and_one_spare_generation(db, board, store) -> None:
    """A reader resolves the live snapshot in one statement and asks for rows in
    the next, so the set a publish supersedes keeps its rows until the publish
    after next — then goes, so nothing accumulates."""
    publish_first(db, board, store)
    first_id = lob.live_snapshot(db).id

    board.set_rows(
        list(LOBBYING_ROWS)
        + ['"New Filer LLC",9001,2025,.0000,500.0000,.0000,.0000,,500.0000']
    )
    second = publish_as_operator(db, board, store)
    second_id = second.published_snapshot_id
    db.expire_all()
    # One spare generation: the first set's rows survive this publish.
    assert len(loaded_rows(db, first_id)) == len(LOBBYING_ROWS)

    board.set_rows(
        list(LOBBYING_ROWS)
        + ['"New Filer LLC",9001,2025,.0000,600.0000,.0000,.0000,,600.0000']
    )
    third = publish_as_operator(db, board, store)
    db.expire_all()
    # The publish after next takes them; the middle generation is the spare now,
    # and the live set — the one a stale pointer would have deleted — is intact.
    assert loaded_rows(db, first_id) == []
    assert db.get(models.LobbyingExpenditureSnapshot, first_id).status == (
        SnapshotStatus.pruned
    )
    assert len(loaded_rows(db, second_id)) == len(LOBBYING_ROWS) + 1
    live = lob.live_snapshot(db)
    assert live.id == third.published_snapshot_id
    assert len(loaded_rows(db, live.id)) == len(LOBBYING_ROWS) + 1


def test_a_pruned_set_republishes_from_the_retained_body(db, board, store) -> None:
    """The Board can republish records whose rows we pruned. A pruned snapshot must
    never be reused as "unchanged" — it has no rows — and its rows are rebuilt from
    the retained body, never from this run's download, whose row numbers may belong
    to a different shuffle of the same records."""
    publish_first(db, board, store)
    first_id = lob.live_snapshot(db).id
    original_rows = list(LOBBYING_ROWS)

    for suffix in ("500", "600"):
        board.set_rows(
            list(LOBBYING_ROWS)
            + [
                f'"New Filer LLC",9001,2025,.0000,{suffix}.0000,.0000,.0000,,'
                f"{suffix}.0000"
            ]
        )
        publish_as_operator(db, board, store)
    db.expire_all()
    assert loaded_rows(db, first_id) == []  # pruned

    # The Board serves the original records again, reshuffled.
    board.set_rows(list(reversed(original_rows)))
    report = publish_as_operator(db, board, store)
    assert report.published_snapshot_id == first_id
    db.expire_all()
    rows = loaded_rows(db, first_id)
    assert len(rows) == len(original_rows)
    # Rebuilt from the retained body: row 1 is the retained file's row 1, not the
    # reshuffled download's.
    assert rows[0].principal == "Allstate Insurance Co"


def test_dry_run_writes_nothing(db, board, store) -> None:
    report = run(db, board, store, dry_run=True)
    assert report.dry_run and not report.published
    assert store.objects == {}
    assert observation_count(db) == 0
    assert list(db.scalars(select(models.LobbyingExpenditureSnapshot))) == []
