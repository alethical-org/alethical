"""What publishing a release must do about the 2 money checks (#1922).

A committee page says whether anybody compared its figures against the report the
committee itself filed with Minnesota. Every one of those answers is tied to the exact
data snapshot it judged, which is right -- an answer about payments since replaced is not
an answer about the payments on screen -- so publishing a new release retires all of them
at once. Nothing re-ran them, so from the instant of publication every page reverted to
saying nobody had looked, silently, across the whole site.

Every test here stands in for a way that safeguard could go quietly missing again:

* **A publish must re-run both checks**, and money in has to go first, because it is the
  one that fetches a filing from the Board and keeps it -- and money out reads filings
  back out of that same store.
* **A check that cannot run must be impossible to miss.** A banner, a named reason, and a
  non-zero exit from the publishing command. A quiet line at the end of a long run is how
  this went unnoticed for a day.
* **One broken check must not take the working one down with it.** They break for
  unrelated reasons: money out reads our own store, money in reads the Board.
* **A verdict from the previous release must never be reused.** "Nobody has looked" is
  the honest answer until somebody has looked at *these* rows.
* **A run that publishes nothing must not re-check anything**, because the release being
  served has not changed and its answers still speak for it.

Needs the local Postgres on port 54329 for the tests that publish a release.
"""

from __future__ import annotations

import importlib.util
import threading
from dataclasses import dataclass, field
from datetime import UTC, datetime
from decimal import Decimal
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from typing import Iterator, Optional

import pytest
from sqlalchemy import text

from alethical.db import models
from alethical.db.session import get_session_factory
from alethical.pipeline import campaign_finance_recheck as recheck
from alethical.tests.test_campaign_finance_load import (
    CONTRIBUTION_ROWS,
    Dataset,
    FakeBoard,
    MemoryStore,
    _clear,
    _Handler,
    publish_first,
    run,
    seed_filings_snapshot,
)
from alethical.tests.test_campaign_finance_stated_split import (
    _DocumentHandler,
    pdf_of,
)

ROOT = Path(__file__).resolve().parents[2]
_SCRIPT = ROOT / "scripts" / "load_campaign_finance.py"
_spec = importlib.util.spec_from_file_location("load_campaign_finance_script", _SCRIPT)
assert _spec is not None and _spec.loader is not None
loader_script = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(loader_script)


# --- The one document both checks read ----------------------------------------


def document_for_19004() -> bytes:
    """A filing both readers can prove themselves against, for the one fixture filer.

    19004 holds no contribution rows and one 2025 expenditure row of $1,000.00, so a
    filing stating $0.00 in and $1,000.00 out agrees with us on both sides.
    """
    return pdf_of(
        [
            "Campaign Finance And Public Disclosure Board",
            "Period Covered: 01/01/2025 through 12/31/2025",
            "Schedule A1 - IND   Contributions from Individuals",
            "Total of itemized 0.00 0.00 0.00",
            "Total of non-itemized 0.00 0.00 0.00",
            "Schedule B1 - CE   Campaign Expenditures",
            "Total of itemized 1,000.00 0.00 0.00 1,000.00",
            "Total of non-itemized 0.00 0.00 0.00 0.00",
        ]
    )


MONEY_OUT_FIGURES = {
    "campaign_expenditures": "1000.00",
    "total_expenditures": "1000.00",
}


# --- Fixtures -----------------------------------------------------------------


@pytest.fixture()
def db(seed_database: None):
    session = get_session_factory()()
    _clear(session)
    session.execute(text("DELETE FROM cf_stated_split"))
    session.execute(text("DELETE FROM cf_stated_spending"))
    session.commit()
    try:
        yield session
    finally:
        session.rollback()
        session.execute(text("DELETE FROM cf_stated_split"))
        session.execute(text("DELETE FROM cf_stated_spending"))
        session.commit()
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


@pytest.fixture()
def documents_server() -> Iterator[tuple[str, dict[str, bytes]]]:
    served: dict[str, bytes] = {}
    server = ThreadingHTTPServer(("127.0.0.1", 0), _DocumentHandler)
    server.documents = served  # type: ignore[attr-defined]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}", served
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def seed(db) -> models.CampaignFinanceFilingSnapshot:
    """A published filings snapshot naming one committee-year both checks can read."""
    snapshot = seed_filings_snapshot(
        db, reported={("19004", 2025): "0.00"}, years=(2025,)
    )
    filing_id = db.execute(
        text(
            "SELECT id FROM cf_filing WHERE snapshot_id = :snapshot "
            " AND registration_number = '19004' AND filing_year = 2025"
        ),
        {"snapshot": snapshot.id},
    ).scalar_one()
    for line_key, amount in MONEY_OUT_FIGURES.items():
        db.add(
            models.CampaignFinanceFilingFigure(
                filing_id=filing_id,
                line_key=line_key,
                label_as_served=line_key.replace("_", " ").capitalize(),
                amount=Decimal(amount),
            )
        )
    db.commit()
    return snapshot


def verdicts(db, table: str) -> dict[tuple[str, str, int], str]:
    """Every stored answer, keyed by the snapshot it is about and the committee-year."""
    return {
        (str(snapshot), registration, year): status
        for snapshot, registration, year, status in db.execute(
            text(
                f"SELECT snapshot_id, registration_number, filing_year, status "
                f"FROM {table}"
            )
        )
    }


def live_snapshots(db) -> tuple[str, str]:
    """The contributions and expenditures snapshot ids the served release resolves to."""
    row = db.execute(
        text(
            "SELECT r.contributions_snapshot_id, r.expenditures_snapshot_id "
            " FROM cf_release r JOIN cf_current_release c ON c.release_id = r.id "
            " WHERE c.id = true"
        )
    ).one()
    return str(row[0]), str(row[1])


def money_in_against(url: str):
    """The real money-in check, pointed at a fake Board and not sleeping between
    requests."""
    return partial(recheck.run_money_in, base_url=url, spacing_seconds=0)


# --- Both checks run, in the order that matters -------------------------------


def test_a_publish_re_checks_both_sides_against_what_it_just_published(
    db, board, store, documents_server
) -> None:
    """The whole point: after this, an answer exists for the release being served."""
    url, served = documents_server
    served["19004"] = document_for_19004()
    seed(db)
    publish_first(db, board, store)

    report = recheck.recheck_stated_figures(
        db,
        years=[2025],
        store_factory=lambda: store,
        log=lambda message: None,
        money_in=money_in_against(url),
    )

    assert report.failed is False
    assert [outcome.name for outcome in report.outcomes] == ["money in", "money out"]
    contributions, expenditures = live_snapshots(db)
    money_in = verdicts(db, "cf_stated_split")
    money_out = verdicts(db, "cf_stated_spending")
    assert money_in[(contributions, "19004", 2025)] == "agrees"
    assert money_out[(expenditures, "19004", 2025)] == "agrees"
    # Every answer is about the release being served, and every committee-year in the
    # population has one -- including the ones the Board serves no document for, which
    # read as not checked rather than being left with no answer at all.
    assert {snapshot for snapshot, _, _ in money_in} == {contributions}
    assert {snapshot for snapshot, _, _ in money_out} == {expenditures}
    assert len(money_in) == report.outcomes[0].verdicts
    assert len(money_out) == report.outcomes[1].verdicts


def test_money_out_reads_the_document_money_in_has_just_fetched(
    db, board, store, documents_server
) -> None:
    """Why money in runs first, and it is load-bearing rather than alphabetical.

    Money in fetches each filing from the Board and keeps it (#1501); money out reads
    filings back out of that same store and asks the Board for nothing. Nothing is in the
    store when this starts, so a money-out verdict of anything but "no copy" proves money
    in put it there inside this one re-check. Run the other way round, that committee-year
    would read as not checked until the next publish.
    """
    url, served = documents_server
    served["19004"] = document_for_19004()
    seed(db)
    publish_first(db, board, store)
    assert db.execute(text("SELECT count(*) FROM cf_report_document")).scalar() == 0

    recheck.recheck_stated_figures(
        db,
        years=[2025],
        store_factory=lambda: store,
        log=lambda message: None,
        money_in=money_in_against(url),
    )

    assert db.execute(text("SELECT count(*) FROM cf_report_document")).scalar() == 1
    _, expenditures = live_snapshots(db)
    assert verdicts(db, "cf_stated_spending")[(expenditures, "19004", 2025)] == "agrees"


def test_the_previous_releases_answers_are_never_carried_forward(
    db, board, store, documents_server
) -> None:
    """A second publish leaves both tables with no answer for the served release.

    That is the honest state and the reason this issue exists: the answer is about
    payments that have been replaced, so reusing it would publish an unchecked figure as
    a checked one. Only a re-check may fill it in.
    """
    url, served = documents_server
    served["19004"] = document_for_19004()
    seed(db)
    publish_first(db, board, store)
    recheck.recheck_stated_figures(
        db,
        years=[2025],
        store_factory=lambda: store,
        log=lambda message: None,
        money_in=money_in_against(url),
    )
    first_contributions, first_expenditures = live_snapshots(db)

    board.set_rows(
        Dataset.contributions,
        [row.replace("Retired", "Nurse") for row in CONTRIBUTION_ROWS],
    )
    second = run(db, board, store)
    assert second.published
    db.expire_all()
    contributions, expenditures = live_snapshots(db)
    assert contributions != first_contributions
    # Every stored answer is still about the release that is no longer served, and
    # nothing has been re-keyed onto the one that is.
    assert {snapshot for snapshot, _, _ in verdicts(db, "cf_stated_split")} == {
        first_contributions
    }
    assert {snapshot for snapshot, _, _ in verdicts(db, "cf_stated_spending")} == {
        first_expenditures
    }

    recheck.recheck_stated_figures(
        db,
        years=[2025],
        store_factory=lambda: store,
        log=lambda message: None,
        money_in=money_in_against(url),
    )
    assert verdicts(db, "cf_stated_split")[(contributions, "19004", 2025)] == "agrees"
    assert verdicts(db, "cf_stated_spending")[(expenditures, "19004", 2025)] == "agrees"


# --- A check that cannot run says so loudly -----------------------------------


class RollbackOnly:
    """Stands in for the session where only the failure path touches it.

    A check that raises leaves its transaction dirty, so the re-check rolls back before
    running the other one. Recorded here so that rollback cannot quietly disappear.
    """

    def __init__(self) -> None:
        self.rollbacks = 0

    def rollback(self) -> None:
        self.rollbacks += 1


def exploding(message: str):
    def runner(db, **kwargs):
        raise RuntimeError(message)

    return runner


def counting():
    calls: list[tuple[int, ...]] = []

    def runner(db, *, years, **kwargs):
        calls.append(tuple(years))
        return 7, {"agrees": 7}

    runner.calls = calls  # type: ignore[attr-defined]
    return runner


def test_a_check_that_cannot_run_fails_the_publish_loudly() -> None:
    """The guard this issue is really about: publication is never quietly followed by
    nothing."""
    session = RollbackOnly()
    report = recheck.recheck_stated_figures(
        session,
        years=[2025],
        store_factory=lambda: object(),
        log=lambda message: None,
        money_in=exploding("no cf_stated_split table"),
        money_out=counting(),
    )

    assert session.rollbacks == 1
    assert report.failed is True
    summary = report.summary()
    assert "NEEDS A PERSON" in summary
    assert "no cf_stated_split table" in summary
    assert "money in" in summary
    # The way back: the exact commands, with the years already in them.
    assert "scripts/check_campaign_finance_stated_split.py --years 2025" in summary


def test_one_broken_check_does_not_stop_the_other() -> None:
    """They break for unrelated reasons, and one working answer is worth having."""
    working = counting()
    report = recheck.recheck_stated_figures(
        RollbackOnly(),
        years=[2025],
        store_factory=lambda: object(),
        log=lambda message: None,
        money_in=exploding("the Board refused every request"),
        money_out=working,
    )

    assert working.calls == [(2025,)]  # type: ignore[attr-defined]
    assert report.failed is True
    assert [outcome.ran for outcome in report.outcomes] == [False, True]


def test_a_store_nobody_can_reach_fails_both_checks_rather_than_half_of_them() -> None:
    """Both checks read a filing out of the same store, so its credentials failing is
    not a per-check problem and must not report as one."""

    def refuse():
        raise RuntimeError("SUPABASE_STORAGE_S3_ACCESS_KEY_ID not set")

    never = counting()
    report = recheck.recheck_stated_figures(
        RollbackOnly(),
        years=[2025],
        store_factory=refuse,
        log=lambda message: None,
        money_in=never,
        money_out=never,
    )

    assert never.calls == []  # type: ignore[attr-defined]
    assert report.failed is True
    assert [outcome.ran for outcome in report.outcomes] == [False, False]
    assert "SUPABASE_STORAGE_S3_ACCESS_KEY_ID" in report.summary()


def test_a_run_where_both_checks_worked_carries_no_banner() -> None:
    """So the banner means something when it appears."""
    report = recheck.recheck_stated_figures(
        RollbackOnly(),
        years=[2025],
        store_factory=lambda: object(),
        log=lambda message: None,
        money_in=counting(),
        money_out=counting(),
    )

    assert report.failed is False
    assert "NEEDS A PERSON" not in report.summary()
    assert "7 committee-years" in report.summary()


# --- Which years, and when it runs at all -------------------------------------


def test_the_default_years_are_this_year_and_the_2_before_it() -> None:
    """Narrower would silently shrink what the stored verdicts already cover; wider
    could only add years the Board serves no document for."""
    assert recheck.recheck_years(datetime(2026, 9, 2, tzinfo=UTC)) == (2024, 2025, 2026)


def test_named_years_are_used_and_deduplicated() -> None:
    runner = counting()
    recheck.recheck_stated_figures(
        RollbackOnly(),
        years=[2026, 2024, 2024],
        store_factory=lambda: object(),
        log=lambda message: None,
        money_in=runner,
        money_out=counting(),
    )
    assert runner.calls == [(2024, 2026)]  # type: ignore[attr-defined]


# --- The publishing command's own wiring --------------------------------------


@dataclass
class FakeLoadReport:
    published: bool = False
    no_change: bool = False
    dry_run: bool = False
    refusal: Optional[str] = None
    committee_link_contradictions: list[str] = field(default_factory=list)

    def summary(self) -> str:
        return "  (a load)"


@dataclass
class FakeRecheckReport:
    failed: bool = False

    def summary(self) -> str:
        return "  (a re-check)"


def call_loader(monkeypatch, load_report, *, argv=None, recheck_report=None):
    """Run the publishing command's ``main`` with the load and re-check both faked.

    Everything below the command's own decisions is replaced, because what is under test
    is exactly those decisions: whether a re-check happens, for which years, and what the
    command exits with.
    """
    calls: list[dict] = []

    class FakeSession:
        def __enter__(self):
            return "session"

        def __exit__(self, *args):
            return False

    def fake_recheck(session, *, years, log):
        calls.append({"session": session, "years": years})
        return recheck_report or FakeRecheckReport()

    monkeypatch.setattr(loader_script, "create_engine", lambda *a, **k: "engine")
    monkeypatch.setattr(loader_script, "Session", lambda engine: FakeSession())
    monkeypatch.setattr(
        loader_script, "normalize_database_url", lambda url: "postgresql://fake"
    )
    monkeypatch.setattr(
        loader_script, "database_url_for_target", lambda target: "postgresql://fake"
    )
    monkeypatch.setattr(
        loader_script, "load_campaign_finance", lambda *a, **k: load_report
    )
    monkeypatch.setattr(loader_script, "recheck_stated_figures", fake_recheck)
    monkeypatch.setattr("sys.argv", ["load_campaign_finance.py", *(argv or [])])
    return loader_script.main(), calls


def test_publishing_re_checks_and_exits_zero(monkeypatch) -> None:
    code, calls = call_loader(monkeypatch, FakeLoadReport(published=True))
    assert code == 0
    assert len(calls) == 1
    assert calls[0]["session"] == "session"
    assert calls[0]["years"] is None  # the module's own default


def test_a_re_check_that_could_not_run_makes_the_publish_exit_non_zero(
    monkeypatch,
) -> None:
    """A zero exit here is what let this go unnoticed: the command looked successful."""
    code, calls = call_loader(
        monkeypatch,
        FakeLoadReport(published=True),
        recheck_report=FakeRecheckReport(failed=True),
    )
    assert code == 1
    assert len(calls) == 1


def test_named_recheck_years_reach_the_re_check(monkeypatch) -> None:
    _, calls = call_loader(
        monkeypatch,
        FakeLoadReport(published=True),
        argv=["--recheck-years", "2025", "2026"],
    )
    assert calls[0]["years"] == [2025, 2026]


@pytest.mark.parametrize(
    "load_report, expected_code",
    [
        (FakeLoadReport(no_change=True), 0),
        (FakeLoadReport(refusal="quarantined contributions"), 1),
        (FakeLoadReport(dry_run=True), 0),
    ],
    ids=["unchanged", "quarantined", "dry run"],
)
def test_a_run_that_publishes_nothing_re_checks_nothing(
    monkeypatch, load_report, expected_code
) -> None:
    """The release being served has not changed, so its answers still speak for it.

    Re-running an hour of checks for nothing would be the smaller cost; the real one is
    that a re-check writes verdicts, and writing them against an unchanged release for a
    run that refused would read as this run having published something.
    """
    code, calls = call_loader(monkeypatch, load_report)
    assert calls == []
    assert code == expected_code
