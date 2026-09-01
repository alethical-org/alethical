"""What discovering documents from the Board's own catalogue has to guarantee (#1886).

Minnesota is taking every campaign-finance report filed since 1 January 2022 off its
website, redacting donors' street addresses and reposting it, finishing about 19 November
2026. The Board publishes no archive, so a document not copied before the repost reaches
it exists nowhere afterwards. Until #1886 the keeper could only ask for documents a
verdict already named, and no verdict exists for 2022 or 2023 -- so 2,215 year-end
documents were invisible to it while the Board was still serving them.

The three that carry the most weight, each standing for a way this run could quietly
keep less than it could have:

* **A catalogued report with no verdict is asked for.** This is the whole point; a pass
  that silently found nothing would look exactly like a pass that found nothing to do.
* **A refused effective version steps down to one that serves.** Measured on production
  1 September 2026: filer 20994's 2024 year-end is catalogued at amendment 2, which is
  refused, while amendments 0 and 1 both serve. Asking only at the catalogued index
  throws away a document the Board is still willing to hand over.
* **A version kept is recorded as the version it is.** A stepped-down document stored
  under the catalogued index would be a filing claiming to be a version it is not, which
  is the one failure that outlives the deadline.

Needs the local Postgres on port 54329.
"""

from __future__ import annotations

import hashlib
import uuid
from datetime import UTC, date, datetime
from typing import Iterator, Optional

import pytest
from sqlalchemy import text

from alethical.db import models
from alethical.db.models import CampaignFinanceFilerKind as FilerKind
from alethical.db.models import CampaignFinanceSnapshotStatus as SnapshotStatus
from alethical.db.session import get_session_factory
from alethical.pipeline.campaign_finance_report_document_store import (
    DocumentKeeper,
    stored_document_filings,
)
from scripts import backfill_campaign_finance_report_documents as backfill_script

DOCUMENT = b"%PDF-1.4\na real-looking filing\n%%EOF\n"
NOT_FOUND = b"Requested file not found."
ERROR_PAGE = b"<html>" + b"x" * 30_000 + b"</html>"


class MemoryStore:
    """Stands in for the private bucket, with the real store's read-back contract."""

    bucket = "test-bucket"

    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    def exists(self, key: str) -> bool:
        return key in self.objects

    def size(self, key: str) -> Optional[int]:
        stored = self.objects.get(key)
        return None if stored is None else len(stored)

    def put_and_verify(self, key: str, path: str, expected_sha256: str) -> None:
        if key not in self.objects:
            with open(path, "rb") as handle:
                self.objects[key] = handle.read()
        stored = hashlib.sha256(self.objects[key]).hexdigest()
        if stored != expected_sha256:
            raise RuntimeError(f"{key} read back as {stored}, not {expected_sha256}")

    def get(self, key: str, destination: str) -> None:
        with open(destination, "wb") as handle:
            handle.write(self.objects[key])


class Board:
    """A stand-in Board. Answers only what it was told to serve; refuses the rest.

    Every request is recorded, because half of what these tests prove is about requests
    NOT made: a document already kept must cost nothing, and a refused version must not
    be retried for ever.
    """

    def __init__(self, served: dict[tuple[str, int, str, int, bool], bytes]) -> None:
        self.served = served
        self.asked: list[tuple[str, int, str, int, bool]] = []
        self.refusal = NOT_FOUND

    def __call__(self, http, **kwargs):
        from alethical.pipeline.campaign_finance_report_documents import (
            classify_document,
        )

        key = (
            kwargs["registration_number"],
            kwargs["filing_year"],
            kwargs["report_type"],
            kwargs["amendment_index"],
            kwargs["special_election"],
        )
        self.asked.append(key)
        body = self.served.get(key, self.refusal)
        outcome, note = classify_document(200, body)
        response = _Response(body)
        return response, outcome, note


class _Response:
    def __init__(self, body: bytes) -> None:
        self.body = body
        self.status_code = 200
        self.content_hash = hashlib.sha256(body).hexdigest()


@pytest.fixture()
def db(seed_database: None) -> Iterator:
    session = get_session_factory()()
    _clear(session)
    try:
        yield session
    finally:
        _clear(session)
        session.close()


def _clear(session) -> None:
    session.rollback()
    session.execute(text("DELETE FROM cf_report_document"))
    session.execute(text("DELETE FROM cf_filing_report"))
    session.execute(text("DELETE FROM cf_filer"))
    session.execute(text("UPDATE cf_filing_current SET snapshot_id = NULL"))
    session.execute(text("DELETE FROM cf_filing_snapshot"))
    session.commit()


_ROWS: dict[uuid.UUID, int] = {}


def a_snapshot(db, *, live: bool = True, completed_at: datetime | None = None):
    stamp = completed_at or datetime(2026, 8, 12, 21, 34, tzinfo=UTC)
    snapshot = models.CampaignFinanceFilingSnapshot(
        fetch_started_at=stamp,
        fetch_completed_at=stamp,
        status=SnapshotStatus.loaded,
        filer_count=0,
        report_count=0,
    )
    db.add(snapshot)
    db.flush()
    if live:
        db.execute(
            text(
                "INSERT INTO cf_filing_current (id, snapshot_id) VALUES (true, :sid) "
                "ON CONFLICT (id) DO UPDATE SET snapshot_id = EXCLUDED.snapshot_id"
            ),
            {"sid": snapshot.id},
        )
    db.commit()
    return snapshot


def a_filer(db, snapshot, registration: str, kind: FilerKind = FilerKind.party_unit):
    db.add(
        models.CampaignFinanceFiler(
            snapshot_id=snapshot.id,
            registration_number=registration,
            kind=kind,
            name=f"Committee {registration}",
            is_incumbent=False,
        )
    )
    db.commit()


def a_catalogued_report(
    db,
    snapshot,
    registration: str,
    *,
    year: int,
    report_type: str = "YE",
    amendment_index: int | None = 0,
    special_election: bool = False,
):
    _ROWS[snapshot.id] = _ROWS.get(snapshot.id, 0) + 1
    db.add(
        models.CampaignFinanceFilingReport(
            snapshot_id=snapshot.id,
            row_number=_ROWS[snapshot.id],
            registration_number=registration,
            filing_year=year,
            report_type=report_type,
            report_name=f"{year} Year-End Report",
            cut_off_date=date(year, 12, 31),
            special_election=special_election,
            effective_amendment_index=amendment_index,
            amendment_count=None if amendment_index is None else amendment_index + 1,
        )
    )
    db.commit()


def run(db, board, monkeypatch, tmp_path, **kwargs):
    """One pass with the Board replaced and no pacing, and the report it produced."""
    monkeypatch.setattr(backfill_script, "fetch_document", board)
    monkeypatch.setattr(backfill_script, "http_session", lambda: None)
    keeper = DocumentKeeper(db=db, store=MemoryStore(), directory=str(tmp_path))
    report = backfill_script.backfill(db, keeper, spacing_seconds=0, **kwargs)
    return report, keeper


def test_a_catalogued_report_with_no_verdict_is_asked_for_and_kept(
    db, monkeypatch, tmp_path
) -> None:
    """The whole of #1886: 2022 has no verdicts, so nothing else can reach it.

    Kept under the catalogued amendment index, and discoverable afterwards by the same
    key ``DocumentLibrary.body_for`` looks a filing up by -- a row nothing can find is a
    row that will not answer "show me the source" later.
    """
    snapshot = a_snapshot(db)
    a_filer(db, snapshot, "20003")
    a_catalogued_report(db, snapshot, "20003", year=2022, amendment_index=3)
    board = Board({("20003", 2022, "YE", 3, False): DOCUMENT})

    report, keeper = run(db, board, monkeypatch, tmp_path)

    assert board.asked == [("20003", 2022, "YE", 3, False)]
    assert report.newly_kept == 1
    assert report.not_served == 0
    assert report.bytes_served == len(DOCUMENT)
    assert report.served_by_year[2022] == 1
    assert keeper.report.stored == 1
    assert ("20003", 2022, "YE", 3, False) in stored_document_filings(db)


def test_a_filing_version_already_kept_costs_no_request(
    db, monkeypatch, tmp_path
) -> None:
    """Safe to re-run is not a nicety here: the pass is long enough to be interrupted.

    A verdict is skipped on its hash; a catalogued report has no hash to skip on, so it
    is skipped on its filing version. This is the second test of the pair.
    """
    snapshot = a_snapshot(db)
    a_filer(db, snapshot, "20003")
    a_catalogued_report(db, snapshot, "20003", year=2022, amendment_index=3)
    board = Board({("20003", 2022, "YE", 3, False): DOCUMENT})
    run(db, board, monkeypatch, tmp_path)

    second = Board({("20003", 2022, "YE", 3, False): DOCUMENT})
    report, keeper = run(db, second, monkeypatch, tmp_path)

    assert second.asked == []
    assert report.already_kept == 1
    assert report.newly_kept == 0
    assert keeper.report.stored == 0


def test_a_refused_effective_version_steps_down_to_one_that_serves(
    db, monkeypatch, tmp_path
) -> None:
    """Filer 20994's real shape: catalogued at 2, refused at 2, served at 1 and 0.

    It stops at the first version that serves rather than collecting every earlier one:
    the effective document is what every figure is drawn from (§9.6), and the amendment
    history is a larger question #1886 deliberately leaves alone.
    """
    snapshot = a_snapshot(db)
    a_filer(db, snapshot, "20994")
    a_catalogued_report(db, snapshot, "20994", year=2024, amendment_index=2)
    board = Board(
        {
            ("20994", 2024, "YE", 1, False): DOCUMENT,
            ("20994", 2024, "YE", 0, False): b"%PDF-1.4\nthe original\n%%EOF\n",
        }
    )

    report, _ = run(db, board, monkeypatch, tmp_path)

    assert board.asked == [
        ("20994", 2024, "YE", 2, False),
        ("20994", 2024, "YE", 1, False),
    ]
    assert report.newly_kept == 1
    assert report.earlier_version_kept == 1
    assert report.not_served == 0


def test_a_stepped_down_document_is_recorded_as_the_version_it_actually_is(
    db, monkeypatch, tmp_path
) -> None:
    """The version kept is amendment 1, so the row says 1, and nothing says 2.

    Storing it as the catalogued version would make the row assert a filing version we
    do not hold -- and because the Board will not serve version 2 again after the
    repost, nobody could ever catch it.
    """
    snapshot = a_snapshot(db)
    a_filer(db, snapshot, "20994")
    a_catalogued_report(db, snapshot, "20994", year=2024, amendment_index=2)
    board = Board({("20994", 2024, "YE", 1, False): DOCUMENT})

    run(db, board, monkeypatch, tmp_path)

    held = stored_document_filings(db)
    assert ("20994", 2024, "YE", 1, False) in held
    assert ("20994", 2024, "YE", 2, False) not in held


def test_an_earlier_version_already_kept_stops_the_step_down(
    db, monkeypatch, tmp_path
) -> None:
    """A re-run costs one request for the effective version, not the whole ladder.

    The effective version is asked for again on purpose: it may become available. What
    must not happen is re-walking every earlier version on every run.
    """
    snapshot = a_snapshot(db)
    a_filer(db, snapshot, "20994")
    a_catalogued_report(db, snapshot, "20994", year=2024, amendment_index=2)
    board = Board({("20994", 2024, "YE", 1, False): DOCUMENT})
    run(db, board, monkeypatch, tmp_path)

    second = Board({("20994", 2024, "YE", 1, False): DOCUMENT})
    report, keeper = run(db, second, monkeypatch, tmp_path)

    assert second.asked == [("20994", 2024, "YE", 2, False)]
    assert report.newly_kept == 0
    assert keeper.report.stored == 0


def test_a_transport_failure_stops_the_step_down(db, monkeypatch, tmp_path) -> None:
    """An HTTP error is about the connection, not about which version exists.

    And it is systemic when it happens: the document route answers a hard 403 without the
    PHPSESSID cookie, 18 of 18 measured, so once it starts every request gets it. Walking
    every amendment of every report would make a run that keeps nothing cost half again as
    many requests on the Board. Every other refusal shape still steps down, because a
    wasted request costs a quarter of a second and a step-down not taken costs a document.
    """
    snapshot = a_snapshot(db)
    a_filer(db, snapshot, "20003")
    a_catalogued_report(db, snapshot, "20003", year=2022, amendment_index=3)

    def forbidden(http, **kwargs):
        from alethical.pipeline.campaign_finance_report_documents import (
            classify_document,
        )

        response = _Response(b"")
        response.status_code = 403
        outcome, note = classify_document(403, b"")
        return response, outcome, note

    report, _ = run(db, forbidden, monkeypatch, tmp_path)

    assert report.outcomes["http_error"] == 1
    assert report.not_served == 1


def test_a_report_the_catalogue_carries_no_amendment_for_is_asked_once(
    db, monkeypatch, tmp_path
) -> None:
    """§9.6 reads a null amendment record as never filed, so its refusal is expected.

    Asked once anyway, at amendment 0, because one request is the entire cost and a
    document the Board does serve here would otherwise be lost for good. Counted
    separately so a refusal is not read as the Board withdrawing a filed report.
    """
    snapshot = a_snapshot(db)
    a_filer(db, snapshot, "15987")
    a_catalogued_report(db, snapshot, "15987", year=2023, amendment_index=None)
    board = Board({})

    report, _ = run(db, board, monkeypatch, tmp_path)

    assert board.asked == [("15987", 2023, "YE", 0, False)]
    assert report.not_served == 1
    assert report.refused_no_amendment_record == 1
    assert report.refused_by_year[2023] == 1


def test_the_special_election_series_is_its_own_report(
    db, monkeypatch, tmp_path
) -> None:
    """One filer-year, two year-end reports, two documents.

    A candidate in a special election files a whole second series (§9.5). Collapsing the
    two onto one filing key would keep one document and silently drop the other.
    """
    snapshot = a_snapshot(db)
    a_filer(db, snapshot, "19119", kind=FilerKind.candidate_committee)
    a_catalogued_report(db, snapshot, "19119", year=2025, amendment_index=0)
    a_catalogued_report(
        db, snapshot, "19119", year=2025, amendment_index=0, special_election=True
    )
    board = Board(
        {
            ("19119", 2025, "YE", 0, False): b"%PDF-1.4\nregular\n%%EOF\n",
            ("19119", 2025, "YE", 0, True): b"%PDF-1.4\nspecial election\n%%EOF\n",
        }
    )

    report, keeper = run(db, board, monkeypatch, tmp_path)

    assert sorted(board.asked) == [
        ("19119", 2025, "YE", 0, False),
        ("19119", 2025, "YE", 0, True),
    ]
    assert report.newly_kept == 2
    assert keeper.report.stored == 2


def test_only_the_live_catalogue_is_read(db, monkeypatch, tmp_path) -> None:
    """A superseded snapshot's reports are never asked for.

    Two generations of the catalogue are retained (§4.4). Reading both would ask the
    Board for filings the current catalogue no longer lists, and record them as reports
    Minnesota still says exist.
    """
    old = a_snapshot(db, live=False, completed_at=datetime(2026, 7, 1, tzinfo=UTC))
    a_filer(db, old, "11111")
    a_catalogued_report(db, old, "11111", year=2022, amendment_index=0)
    live = a_snapshot(db)
    a_filer(db, live, "20003")
    a_catalogued_report(db, live, "20003", year=2022, amendment_index=0)
    board = Board(
        {
            ("20003", 2022, "YE", 0, False): DOCUMENT,
            ("11111", 2022, "YE", 0, False): DOCUMENT,
        }
    )

    report, _ = run(db, board, monkeypatch, tmp_path)

    assert board.asked == [("20003", 2022, "YE", 0, False)]
    assert report.newly_kept == 1


def test_the_year_floor_and_report_type_bound_what_is_asked_for(
    db, monkeypatch, tmp_path
) -> None:
    """Only what the redaction order covers, and only the type the Board still serves.

    Measured 1 September 2026: 30 of 30 non-year-end 2022 and 2023 reports answered with
    §9.4's 30,424-byte HTML page, so a wider default would spend thousands of requests on
    a shape already known to refuse. Both bounds are arguments, so a later pass can widen
    them without editing the script.
    """
    snapshot = a_snapshot(db)
    a_filer(db, snapshot, "20003")
    a_catalogued_report(db, snapshot, "20003", year=2021, amendment_index=0)
    a_catalogued_report(db, snapshot, "20003", year=2022, amendment_index=0)
    a_catalogued_report(
        db, snapshot, "20003", year=2022, report_type="E", amendment_index=0
    )
    board = Board(
        {
            ("20003", 2021, "YE", 0, False): DOCUMENT,
            ("20003", 2022, "YE", 0, False): DOCUMENT,
            ("20003", 2022, "E", 0, False): DOCUMENT,
        }
    )

    report, _ = run(db, board, monkeypatch, tmp_path)

    assert board.asked == [("20003", 2022, "YE", 0, False)]
    assert report.newly_kept == 1


def test_each_refusal_shape_is_counted_by_its_own_name(
    db, monkeypatch, tmp_path
) -> None:
    """The acceptance criterion is a refusal rate broken down by §9.4's shapes.

    "The Board would not serve 2,000" is not an answer anybody can act on; "1,900 said
    the file was not found and 100 answered the HTML page" is, because those two mean
    different things about the same report.
    """
    snapshot = a_snapshot(db)
    a_filer(db, snapshot, "20003")
    a_filer(db, snapshot, "20006")
    a_catalogued_report(db, snapshot, "20003", year=2022, amendment_index=0)
    a_catalogued_report(db, snapshot, "20006", year=2022, amendment_index=0)

    def refuse_differently(http, **kwargs):
        from alethical.pipeline.campaign_finance_report_documents import (
            classify_document,
        )

        body = NOT_FOUND if kwargs["registration_number"] == "20003" else ERROR_PAGE
        outcome, note = classify_document(200, body)
        return _Response(body), outcome, note

    report, _ = run(db, refuse_differently, monkeypatch, tmp_path)

    assert report.outcomes["not_found"] == 1
    assert report.outcomes["error_page"] == 1
    assert report.not_served == 2
    assert len(report.refused) == 2


def test_the_dry_run_describes_the_run_it_previews(db, capsys) -> None:
    """Including under ``--limit``, and split by which question found each document.

    A preview reporting the whole population while the run would stop at 1 is a preview
    of a different run, which is the one thing a dry run cannot be.
    """
    snapshot = a_snapshot(db)
    a_filer(db, snapshot, "20003")
    a_filer(db, snapshot, "20006")
    a_catalogued_report(db, snapshot, "20003", year=2022, amendment_index=0)
    a_catalogued_report(db, snapshot, "20006", year=2023, amendment_index=None)

    backfill_script.describe(db)
    whole = capsys.readouterr().out
    assert "2 document(s) would be asked for" in whole
    assert "0 named by a verdict" in whole
    assert "2 named by the Board's catalogue (YE from 2022)" in whole
    assert "2022: 1" in whole and "2023: 1" in whole
    assert "1 of them are catalogued with no amendment record" in whole

    backfill_script.describe(db, limit=1)
    bounded = capsys.readouterr().out
    assert "1 document(s) would be asked for" in bounded
    assert "--limit 1 holds back 1 of 2 pending" in bounded
