"""The daily campaign-money refresh's plan, lease and bookkeeping (D3, #2344).

The loaders themselves are tested in their own files; here they are stand-ins that
answer the way a real run does, so what is proven is the order and the memory: what
runs when, what is recorded only after success, what is retried, what is never handed
to a loader, and what the summary says is live.
"""

from __future__ import annotations

import inspect
import json
import subprocess
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any, Optional

import pytest
from sqlalchemy import text

from alethical.db.session import get_engine, get_session_factory
from alethical.pipeline import campaign_finance, campaign_finance_filings
from alethical.pipeline import campaign_finance_refresh as refresh
from alethical.pipeline.campaign_finance_recheck import CheckOutcome, RecheckReport
from alethical.pipeline.cache_purge import (
    A_FILINGS_RELEASE,
    A_MONEY_CHECK_VERDICT_SET,
    A_MONEY_DOWNLOAD_RELEASE,
)

NOW = datetime(2026, 9, 24, 15, 30, tzinfo=UTC)

GRID = {
    "cols": ["RegisteredEntityID", "RegisteredEntityFullName", "TerminationDate"],
    "data": {
        "11880": [["11880", "Marty, John Senate Committee", None]],
        "20008": [["20008", "Republican Party of Minnesota", None]],
    },
}


def test_the_content_hash_ignores_row_order_and_notices_a_changed_row() -> None:
    reordered = {
        "cols": GRID["cols"],
        "data": {key: GRID["data"][key] for key in reversed(list(GRID["data"]))},
    }
    assert refresh.stable_hash(GRID) == refresh.stable_hash(reordered)
    changed = {
        "cols": GRID["cols"],
        "data": {
            **GRID["data"],
            "20008": [
                ["20008", "Republican Party of Minnesota", "2026-09-01 00:00:00.000"]
            ],
        },
    }
    assert refresh.stable_hash(changed) != refresh.stable_hash(GRID)


@dataclass
class FakeResponse:
    status_code: int = 200
    body: Any = None
    raw: Optional[str] = None

    def json(self) -> Any:
        if self.raw is not None:
            return json.loads(self.raw)
        return self.body


def test_a_failed_or_wrong_shaped_list_is_a_reading_error_never_a_change(
    monkeypatch,
) -> None:
    """(a) HTTP failure, non-JSON and the wrong shape all read as 'could not read'."""
    assert refresh.grid_shape_error(GRID) is None
    assert refresh.grid_shape_error([]) == (
        "not a grid: got list where an object was expected"
    )
    assert refresh.grid_shape_error(False) == (
        "not a grid: got bool where an object was expected"
    )
    assert refresh.grid_shape_error({"data": {}}) == "not a grid: no 'cols' list"
    assert refresh.grid_shape_error({"cols": []}) == "not a grid: no 'data' rows"

    answers = {
        "all-registered-candidates": FakeResponse(200, GRID),
        "all-registered-ptus": FakeResponse(500),
        "all-registered-pcfs": FakeResponse(200, raw="<html>maintenance</html>"),
        "candidate-reports": FakeResponse(200, []),
        "ptu-reports": FakeResponse(200, False),
        "pcf-reports": FakeResponse(200, {"cols": GRID["cols"], "data": []}),
    }
    monkeypatch.setattr(
        refresh.filings,
        "post_form",
        lambda http, url, form: answers[form["data[action]"]],
    )
    readings = {reading.action: reading for reading in refresh.read_lists(object())}
    good = readings["all-registered-candidates"]
    assert good.error is None and good.content_hash == refresh.stable_hash(GRID)
    assert good.rows == 2
    assert readings["all-registered-ptus"].error == "answered HTTP 500"
    assert readings["all-registered-pcfs"].error.startswith("not JSON")
    assert readings["candidate-reports"].error.startswith("not a grid: got list")
    assert readings["ptu-reports"].error.startswith("not a grid: got bool")
    # An empty grid in the right shape is content (0 rows), not a failure to read.
    assert readings["pcf-reports"].error is None and readings["pcf-reports"].rows == 0
    for action in ("all-registered-ptus", "all-registered-pcfs", "candidate-reports"):
        assert readings[action].content_hash is None, action


def _readings(**hashes: str) -> list[refresh.ListReading]:
    return [
        refresh.ListReading(action, hashes.get(action, "same"), 2)
        for action in refresh.LIST_ACTIONS
    ]


def test_the_totals_refresh_is_due_on_a_changed_list_weekly_and_before_any_first_run() -> (
    None
):
    handled = {action: "same" for action in refresh.LIST_ACTIONS}
    recent = NOW - timedelta(days=1)

    quiet = refresh.plan_totals_refresh(_readings(), handled, recent, now=NOW)
    assert not quiet.totals_due and quiet.reasons == []

    changed = refresh.plan_totals_refresh(
        _readings(**{"pcf-reports": "new"}), handled, recent, now=NOW
    )
    assert changed.totals_due and changed.changed_lists == ["pcf-reports"]

    weekly = refresh.plan_totals_refresh(
        _readings(), handled, NOW - timedelta(days=7), now=NOW
    )
    assert weekly.totals_due and "weekly regardless" in weekly.reasons[0]

    first = refresh.plan_totals_refresh(_readings(), {}, None, now=NOW)
    assert first.totals_due
    assert len(first.changed_lists) == len(refresh.LIST_ACTIONS)

    forced = refresh.plan_totals_refresh(
        _readings(), handled, recent, now=NOW, force=True
    )
    assert forced.totals_due and "asked for" in forced.reasons[0]


def test_an_unreadable_list_is_named_and_is_neither_a_change_nor_a_no_change() -> None:
    handled = {action: "same" for action in refresh.LIST_ACTIONS}
    readings = _readings()
    readings[3] = refresh.ListReading(
        "candidate-reports", None, None, "answered HTTP 500"
    )
    plan = refresh.plan_totals_refresh(
        readings, handled, NOW - timedelta(days=1), now=NOW
    )
    assert not plan.totals_due
    assert plan.unreadable_lists == ["candidate-reports: answered HTTP 500"]
    # Due for another reason, the totals still refresh; the unread list stays named.
    weekly = refresh.plan_totals_refresh(
        readings, handled, NOW - timedelta(days=8), now=NOW
    )
    assert weekly.totals_due and weekly.unreadable_lists == plan.unreadable_lists


def _live(payments: str, filings: str, *, at: datetime) -> refresh.LiveVersions:
    return refresh.LiveVersions(
        payments_release_id=payments,
        payments_fetched_at=at,
        payments_published_at=at,
        filings_snapshot_id=filings,
        filings_fetched_at=at,
    )


def test_a_pending_recheck_is_owed_while_its_generation_or_a_newer_one_is_live() -> (
    None
):
    """(d) The marker names the generation it is owed for."""
    marker = _live("release-1", "snapshot-1", at=NOW).as_marker()
    assert refresh.recheck_still_owed(marker, _live("release-1", "snapshot-1", at=NOW))
    newer = _live("release-2", "snapshot-1", at=NOW + timedelta(days=1))
    assert refresh.recheck_still_owed(marker, newer)
    older = _live("release-0", "snapshot-1", at=NOW - timedelta(days=1))
    assert not refresh.recheck_still_owed(marker, older)
    assert not refresh.recheck_still_owed(marker, refresh.LiveVersions())


# --- Telling a person -------------------------------------------------------------


class FakeGh:
    """Records every gh command and answers the way the CLI would."""

    def __init__(self, existing_issue: str = "") -> None:
        self.existing_issue = existing_issue
        self.commands: list[list[str]] = []

    def __call__(self, command, **kwargs) -> subprocess.CompletedProcess:
        self.commands.append(list(command))
        assert kwargs.get("capture_output") and kwargs.get("text")
        if command[:3] == ["gh", "issue", "list"]:
            return subprocess.CompletedProcess(command, 0, self.existing_issue, "")
        if command[:3] == ["gh", "issue", "create"]:
            return subprocess.CompletedProcess(
                command,
                0,
                "https://github.com/alethical-org/alethical/issues/9999\n",
                "",
            )
        return subprocess.CompletedProcess(command, 0, "", "")


def test_the_alert_issue_is_created_once_then_commented_and_never_on_a_dry_run() -> (
    None
):
    summary = "campaign-money refresh, 3.0 minutes\n  FAILED, so this run is incomplete"
    run_url = "https://github.com/alethical-org/alethical/actions/runs/1"
    quiet: list[str] = []

    gh = FakeGh()
    done = refresh.file_refresh_alert(summary, run_url, runner=gh, log=quiet.append)
    assert done and "9999" in done
    assert [command[:3] for command in gh.commands] == [
        ["gh", "issue", "list"],
        ["gh", "issue", "create"],
    ]
    listing = gh.commands[0]
    assert listing[listing.index("--search") + 1] == (
        f"{refresh.REFRESH_ALERT_TITLE} in:title"
    )
    create = gh.commands[1]
    assert create[create.index("--title") + 1] == f"🚨 {refresh.REFRESH_ALERT_TITLE}"
    assert create[create.index("--label") + 1] == "backend"
    body = create[create.index("--body") + 1]
    assert body.startswith("Net: ")
    assert summary in body and run_url in body
    # The body quotes the summary and asserts nothing about what is live itself.
    assert "previous set is still live" not in body

    gh = FakeGh(existing_issue="2350\n")
    done = refresh.file_refresh_alert(summary, run_url, runner=gh, log=quiet.append)
    assert done == "commented on existing alert issue #2350"
    assert [command[:4] for command in gh.commands] == [
        ["gh", "issue", "list", "--state"],
        ["gh", "issue", "comment", "2350"],
    ]
    comment = gh.commands[1]
    assert summary in comment[comment.index("--body") + 1]

    gh = FakeGh()
    assert (
        refresh.file_refresh_alert(
            summary, run_url, dry_run=True, runner=gh, log=quiet.append
        )
        is None
    )
    assert gh.commands == []
    assert any("dry run" in line for line in quiet)

    # gh missing or failing is reported, never raised.
    def missing(command, **kwargs):
        raise FileNotFoundError("gh")

    assert (
        refresh.file_refresh_alert(summary, None, runner=missing, log=quiet.append)
        is None
    )


def test_the_run_url_comes_from_the_variables_actions_sets() -> None:
    assert refresh.github_run_url({}) is None
    assert (
        refresh.github_run_url(
            {
                "GITHUB_SERVER_URL": "https://github.com",
                "GITHUB_REPOSITORY": "alethical-org/alethical",
                "GITHUB_RUN_ID": "77",
            }
        )
        == "https://github.com/alethical-org/alethical/actions/runs/77"
    )


# --- Against a real database ----------------------------------------------------


def _clear(session) -> None:
    session.rollback()
    session.execute(text("DELETE FROM cf_refresh_state"))
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


def test_two_acquirers_get_one_lease_and_it_is_released_for_the_next(db) -> None:
    """(g) The lease is a row taken in 1 statement, not an advisory lock."""
    engine = get_engine()
    with refresh.hold_full_run_lease(engine, purpose="run A") as first:
        assert first.held and bool(first)
        holder = refresh.full_run_lease_holder(db)
        assert holder["owner"] == first.owner and holder["purpose"] == "run A"
        with refresh.hold_full_run_lease(engine, purpose="run B") as second:
            assert not second.held and not bool(second)
            assert "run A" in second.refusal()
        # A non-holder leaving releases nothing.
        assert refresh.full_run_lease_holder(db)["owner"] == first.owner
    assert refresh.full_run_lease_holder(db) is None
    # A session works as the bind too, and the lease is free again.
    with refresh.hold_full_run_lease(db, purpose="run C") as third:
        assert third.held


def test_a_crashed_holder_is_reusable_after_expiry_and_only_its_owner_releases(
    db,
) -> None:
    """(g) Expiry, renewal, release by a non-owner, and the publish gate."""
    t0 = datetime.now(UTC)
    crashed = refresh.FullRunLease(db=db, purpose="a run that died", owner="crashed")
    assert crashed.acquire(now=t0)
    # Never released. An hour later it still holds; 4 hours later it does not.
    later = refresh.FullRunLease(db=db, purpose="the next run", owner="next")
    assert not later.acquire(now=t0 + timedelta(hours=1))
    assert later.acquire(now=t0 + refresh.FULL_RUN_LEASE_TTL)
    row = refresh.full_run_lease_holder(db)
    assert row["owner"] == "next" and row["purpose"] == "the next run"

    # The dead run's release is a no-op: the row still belongs to `next`.
    assert crashed.release() is False
    assert refresh.full_run_lease_holder(db)["owner"] == "next"

    # The publish gate: the run that lost its lease refuses; the holder renews.
    refused = crashed.refusal(
        now=t0 + refresh.FULL_RUN_LEASE_TTL + timedelta(minutes=5)
    )
    assert refused is not None and "held by next" in refused
    assert "does not publish" in refused
    acquired_at = refresh.full_run_lease_holder(db)["acquired_at"]
    assert later.refusal(now=t0 + timedelta(hours=5)) is None
    renewed = refresh.full_run_lease_holder(db)
    assert renewed["acquired_at"] == acquired_at
    assert datetime.fromisoformat(renewed["expires_at"]) == (
        t0 + timedelta(hours=5) + refresh.FULL_RUN_LEASE_TTL
    )

    assert later.release() is True
    assert refresh.full_run_lease_holder(db) is None


def test_the_process_wide_hold_refuses_in_plain_words_when_another_run_holds_it(
    db,
) -> None:
    """(c) What the 2 hand-run loader scripts call at the top of their work."""
    engine = get_engine()
    said: list[str] = []
    with refresh.hold_full_run_lease(
        engine, purpose="the daily campaign-money refresh"
    ):
        assert not refresh.hold_full_run_lease_until_exit(
            engine, purpose="a hand-run campaign-money payments load", log=said.append
        )
    assert "the daily campaign-money refresh" in said[0]
    assert "does nothing" in said[0]
    assert refresh.hold_full_run_lease_until_exit(
        engine, purpose="a hand-run campaign-money payments load", log=said.append
    )
    assert refresh.full_run_lease_holder(db)["purpose"] == (
        "a hand-run campaign-money payments load"
    )
    # What the interpreter's exit would do, done here so the next test starts clean.
    refresh._PROCESS_LEASES.close()
    assert refresh.full_run_lease_holder(db) is None


@dataclass
class FakeTotals:
    blocked: list = field(default_factory=list)
    published: bool = False
    unchanged: bool = False


@dataclass
class FakePayments:
    refusal: str | None = None
    published: bool = False
    no_change: bool = False


@dataclass
class Check:
    name: str
    detail: str


class Board:
    def __init__(self, payloads: dict[str, object]) -> None:
        self.payloads = payloads

    def readings(self) -> list[refresh.ListReading]:
        return [
            refresh.ListReading(
                action, refresh.stable_hash(self.payloads.get(action, GRID)), 2
            )
            for action in refresh.LIST_ACTIONS
        ]


class FakeLive:
    """What the database says is live: a generation the fake loaders move forward."""

    def __init__(self, current: Optional[refresh.LiveVersions] = None) -> None:
        self.current = current or refresh.LiveVersions()
        self.generation = 0

    def __call__(self, db) -> refresh.LiveVersions:
        return self.current

    def publish_payments(self) -> None:
        self.generation += 1
        at = NOW + timedelta(minutes=self.generation)
        self.current = refresh.LiveVersions(
            payments_release_id=f"release-{self.generation}",
            payments_fetched_at=at,
            payments_published_at=at,
            filings_snapshot_id=self.current.filings_snapshot_id,
            filings_fetched_at=self.current.filings_fetched_at,
        )

    def publish_totals(self) -> None:
        self.generation += 1
        at = NOW + timedelta(minutes=self.generation)
        self.current = refresh.LiveVersions(
            payments_release_id=self.current.payments_release_id,
            payments_fetched_at=self.current.payments_fetched_at,
            payments_published_at=self.current.payments_published_at,
            filings_snapshot_id=f"snapshot-{self.generation}",
            filings_fetched_at=at,
        )


def _run(
    db,
    *,
    totals,
    payments,
    recheck=None,
    clear=None,
    live: Optional[FakeLive] = None,
    **kwargs,
):
    calls: dict[str, list] = {"totals": [], "payments": [], "recheck": [], "clear": []}
    live = live or FakeLive()

    def load_totals(session, **options):
        calls["totals"].append(options)
        refused = options["before_publish"]()
        if refused:
            return FakeTotals(blocked=[Check("caller_allows_publish", refused)])
        if totals.published:
            live.publish_totals()
        return totals

    def load_payments(session, **options):
        calls["payments"].append(options)
        refused = options["before_publish"]()
        if refused:
            return FakePayments(refusal=f"not published: {refused}")
        if payments.published and not options["dry_run"]:
            live.publish_payments()
        return payments

    def do_recheck(session, **options):
        calls["recheck"].append(options)
        return recheck or RecheckReport(
            years=(2024, 2025, 2026),
            outcomes=[
                CheckOutcome(name="money in", verdicts=1),
                CheckOutcome(name="money out", verdicts=1),
            ],
        )

    def do_clear(clearing, *, published, log=print):
        calls["clear"].append(clearing.event)
        return False if clear is None else clear(clearing)

    report = refresh.refresh_campaign_money(
        db,
        http=object(),
        load_totals=load_totals,
        load_payments=load_payments,
        recheck=do_recheck,
        clear=do_clear,
        read_live=live,
        now=NOW,
        log=lambda message: None,
        **kwargs,
    )
    return report, calls


def _handled(db, board: Board, *, last_full_days_ago: int = 1) -> None:
    """Yesterday's successful run, remembered: every list handled, totals fresh."""
    for reading in board.readings():
        refresh.state_set(db, f"list:{reading.action}", reading.content_hash)
    refresh.state_set(
        db,
        refresh.LAST_FULL_REFRESH_KEY,
        (NOW - timedelta(days=last_full_days_ago)).isoformat(),
    )


def test_a_first_run_refreshes_every_supported_year_and_records_the_lists_only_on_success(
    db, monkeypatch
) -> None:
    """(f) No marker means fetch the totals once; the hashes land only after that."""
    board = Board({})
    monkeypatch.setattr(refresh, "read_lists", lambda http, base_url: board.readings())
    # The first scheduled run finds nothing from the one-off hand runs, and is handed
    # nothing: no list hash and no full-refresh time.
    assert all(
        refresh.state_get(db, f"list:{action}") is None
        for action in refresh.LIST_ACTIONS
    )
    assert refresh.state_get(db, refresh.LAST_FULL_REFRESH_KEY) is None

    quarantined = FakeTotals(
        blocked=[Check("filer_count_within_band", "1 against 1,611")]
    )
    report, calls = _run(db, totals=quarantined, payments=FakePayments(no_change=True))
    assert not report.ok
    assert "totals refresh quarantined" in report.failures[0]
    assert "no full totals refresh has been recorded" in report.plan.reasons
    assert calls["totals"][0]["years"] == refresh.supported_years(NOW.date())
    # Nothing handled: the totals were fetched but did not succeed, so the same lists
    # are compared again tomorrow and the weekly rule fires again.
    assert all(
        refresh.state_get(db, f"list:{action}") is None
        for action in refresh.LIST_ACTIONS
    )
    assert refresh.state_get(db, refresh.LAST_FULL_REFRESH_KEY) is None
    # The payments half still ran.
    assert len(calls["payments"]) == 1

    report, calls = _run(
        db, totals=FakeTotals(published=True), payments=FakePayments(no_change=True)
    )
    assert report.ok, report.summary()
    # Recorded only now, after the totals refresh succeeded, and all 6 at once.
    assert all(
        refresh.state_get(db, f"list:{action}") == refresh.stable_hash(GRID)
        for action in refresh.LIST_ACTIONS
    )
    assert refresh.state_get(db, refresh.LAST_FULL_REFRESH_KEY) == NOW.isoformat()
    # Publish, clear, re-check, clear again; and nothing left pending.
    assert calls["clear"] == [A_FILINGS_RELEASE, A_MONEY_CHECK_VERDICT_SET]
    assert len(calls["recheck"]) == 1
    assert refresh.state_get(db, refresh.RECHECK_PENDING_KEY) is None
    assert refresh.state_get(db, refresh.CLEARING_PENDING_KEY) is None

    # And the day after, with everything handled, nothing is fetched.
    report, calls = _run(db, totals=FakeTotals(), payments=FakePayments(no_change=True))
    assert report.ok and calls["totals"] == []


def test_an_unchanged_day_is_a_no_op(db, monkeypatch) -> None:
    board = Board({})
    monkeypatch.setattr(refresh, "read_lists", lambda http, base_url: board.readings())
    _handled(db, board)

    report, calls = _run(db, totals=FakeTotals(), payments=FakePayments(no_change=True))
    assert report.ok
    assert calls["totals"] == []
    assert len(calls["payments"]) == 1
    assert calls["recheck"] == [] and calls["clear"] == []
    assert not report.plan.totals_due


def test_a_changed_report_list_triggers_the_totals_and_a_payments_publish_rechecks(
    db, monkeypatch
) -> None:
    board = Board({})
    monkeypatch.setattr(refresh, "read_lists", lambda http, base_url: board.readings())
    _handled(db, board)
    board.payloads["pcf-reports"] = {
        **GRID,
        "data": {**GRID["data"], "41412": [["41412", "Restore Sanity", None]]},
    }

    report, calls = _run(
        db, totals=FakeTotals(unchanged=True), payments=FakePayments(published=True)
    )
    assert report.ok, report.summary()
    assert report.plan.changed_lists == ["pcf-reports"]
    assert len(calls["totals"]) == 1
    assert refresh.state_get(db, "list:pcf-reports") == refresh.stable_hash(
        board.payloads["pcf-reports"]
    )
    assert calls["clear"] == [A_MONEY_DOWNLOAD_RELEASE, A_MONEY_CHECK_VERDICT_SET]
    assert len(calls["recheck"]) == 1


def test_an_unreadable_list_makes_the_run_incomplete_and_is_never_recorded(
    db, monkeypatch
) -> None:
    """(a) The run fails as incomplete; the payments half still runs."""
    board = Board({})
    _handled(db, board)
    readings = board.readings()
    readings[3] = refresh.ListReading(
        "candidate-reports", None, None, "not a grid: got list"
    )
    monkeypatch.setattr(refresh, "read_lists", lambda http, base_url: readings)
    before = refresh.state_get(db, "list:candidate-reports")

    report, calls = _run(db, totals=FakeTotals(), payments=FakePayments(published=True))
    assert not report.ok
    assert report.failures[0].startswith("incomplete: 1 of 6 lists could not be read")
    assert "candidate-reports: not a grid: got list" in report.failures[0]
    # Not a change, so no 54-minute totals fetch on a broken route.
    assert calls["totals"] == []
    # Independent safe work still ran and published.
    assert len(calls["payments"]) == 1 and report.published_payments
    assert calls["clear"][0] == A_MONEY_DOWNLOAD_RELEASE
    # The unread list is not recorded as processed.
    assert refresh.state_get(db, "list:candidate-reports") == before
    assert "not read (not a grid: got list)" in report.summary()
    assert "whether the totals moved is unknown" in report.summary()

    # Due for another reason (the weekly rule), the totals refresh, the 5 readable
    # lists are recorded, and the unread one still is not.
    _clear(db)
    _handled(db, board, last_full_days_ago=8)
    refresh.state_set(db, "list:candidate-reports", "an-older-hash")
    report, calls = _run(
        db, totals=FakeTotals(published=True), payments=FakePayments(no_change=True)
    )
    assert not report.ok and report.failures[0].startswith("incomplete")
    assert len(calls["totals"]) == 1
    assert refresh.state_get(db, "list:pcf-reports") == refresh.stable_hash(GRID)
    assert refresh.state_get(db, "list:candidate-reports") == "an-older-hash"
    assert refresh.state_get(db, refresh.LAST_FULL_REFRESH_KEY) == NOW.isoformat()


def test_an_unfinished_recheck_is_retried_first_on_the_next_run(
    db, monkeypatch
) -> None:
    board = Board({})
    monkeypatch.setattr(refresh, "read_lists", lambda http, base_url: board.readings())
    _handled(db, board)
    live = FakeLive()

    broken = RecheckReport(
        years=(2024, 2025, 2026),
        outcomes=[
            CheckOutcome(
                name="money in", error="the report-document store is unreachable"
            ),
            CheckOutcome(
                name="money out", error="the report-document store is unreachable"
            ),
        ],
    )
    report, calls = _run(
        db,
        totals=FakeTotals(),
        payments=FakePayments(published=True),
        recheck=broken,
        live=live,
    )
    assert not report.ok
    assert "retried on the next run" in report.failures[0]
    marker = refresh.state_get(db, refresh.RECHECK_PENDING_KEY)
    assert marker["after"] == A_MONEY_DOWNLOAD_RELEASE
    # (d) The marker names the generation it is owed for.
    assert marker["payments_release_id"] == "release-1"
    # Cleared once after the publish; not again, because the verdicts never landed.
    assert calls["clear"] == [A_MONEY_DOWNLOAD_RELEASE]

    report, calls = _run(
        db, totals=FakeTotals(), payments=FakePayments(no_change=True), live=live
    )
    assert report.ok, report.summary()
    # The retry ran before the lists were read, and cleared once its verdicts were live.
    assert len(calls["recheck"]) == 1
    assert calls["clear"] == [A_MONEY_CHECK_VERDICT_SET]
    assert refresh.state_get(db, refresh.RECHECK_PENDING_KEY) is None
    assert refresh.state_get(db, refresh.CLEARING_PENDING_KEY) is None


def test_a_failed_recheck_is_attempted_once_per_run_and_only_for_live_data(
    db, monkeypatch
) -> None:
    """(d) One attempt per invocation, tied to the generation it is owed for."""
    board = Board({})
    monkeypatch.setattr(refresh, "read_lists", lambda http, base_url: board.readings())
    _handled(db, board)
    live = FakeLive()
    live.publish_payments()  # release-1 is live, and its re-check never finished
    refresh.state_set(
        db,
        refresh.RECHECK_PENDING_KEY,
        {
            "recorded_at": NOW.isoformat(),
            "after": A_MONEY_DOWNLOAD_RELEASE,
            **live.current.as_marker(),
        },
    )
    broken = RecheckReport(
        years=(2026,),
        outcomes=[CheckOutcome(name="money in", error="store unreachable")],
    )
    # The retry fails, then this run publishes release-2. No second attempt.
    report, calls = _run(
        db,
        totals=FakeTotals(),
        payments=FakePayments(published=True),
        recheck=broken,
        live=live,
    )
    assert not report.ok
    assert len(calls["recheck"]) == 1
    marker = refresh.state_get(db, refresh.RECHECK_PENDING_KEY)
    assert marker["payments_release_id"] == "release-2"
    assert sum("re-check did not finish" in failure for failure in report.failures) == 1

    # Tomorrow, release-2 is still live: the re-check runs.
    report, calls = _run(
        db, totals=FakeTotals(), payments=FakePayments(no_change=True), live=live
    )
    assert report.ok and len(calls["recheck"]) == 1
    assert refresh.state_get(db, refresh.RECHECK_PENDING_KEY) is None

    # A marker owed for a generation that is no longer live, with nothing newer
    # published (a rollback), is dropped and said so, not re-checked.
    stale = FakeLive(
        _live("release-9", "snapshot-9", at=NOW + timedelta(days=3))
    ).current.as_marker()
    refresh.state_set(
        db,
        refresh.RECHECK_PENDING_KEY,
        {"recorded_at": NOW.isoformat(), "after": A_MONEY_DOWNLOAD_RELEASE, **stale},
    )
    report, calls = _run(
        db, totals=FakeTotals(), payments=FakePayments(no_change=True), live=live
    )
    assert report.ok and calls["recheck"] == []
    assert refresh.state_get(db, refresh.RECHECK_PENDING_KEY) is None
    assert any("re-check marker dropped" in line for line in report.lines)


def test_a_failed_final_clearing_is_retried_first_next_run_without_the_rechecks(
    db, monkeypatch
) -> None:
    """(b) clearing_pending outlives recheck_pending until the clearing succeeds."""
    board = Board({})
    monkeypatch.setattr(refresh, "read_lists", lambda http, base_url: board.readings())
    _handled(db, board)
    live = FakeLive()

    report, calls = _run(
        db,
        totals=FakeTotals(),
        payments=FakePayments(published=True),
        clear=lambda clearing: clearing.event == A_MONEY_CHECK_VERDICT_SET,
        live=live,
    )
    assert not report.ok
    assert calls["clear"] == [A_MONEY_DOWNLOAD_RELEASE, A_MONEY_CHECK_VERDICT_SET]
    assert len(calls["recheck"]) == 1
    # The re-checks finished, so their marker is gone; the clearing they owe is not.
    assert refresh.state_get(db, refresh.RECHECK_PENDING_KEY) is None
    assert refresh.state_get(db, refresh.CLEARING_PENDING_KEY)["events"] == [
        A_MONEY_CHECK_VERDICT_SET
    ]
    assert any("retried first on the next run" in one for one in report.failures)

    report, calls = _run(
        db, totals=FakeTotals(), payments=FakePayments(no_change=True), live=live
    )
    assert report.ok, report.summary()
    # Cleared first, and the 72-minute re-checks were not repeated.
    assert calls["clear"] == [A_MONEY_CHECK_VERDICT_SET]
    assert calls["recheck"] == []
    assert refresh.state_get(db, refresh.CLEARING_PENDING_KEY) is None
    assert any("cleared the saved pages owed after" in line for line in report.lines)


def test_a_failed_clearing_is_a_failure_that_never_undoes_the_publish(
    db, monkeypatch
) -> None:
    board = Board({})
    monkeypatch.setattr(refresh, "read_lists", lambda http, base_url: board.readings())
    report, calls = _run(
        db,
        totals=FakeTotals(published=True),
        payments=FakePayments(no_change=True),
        clear=lambda clearing: True,
    )
    assert not report.ok
    assert any("clearing saved pages failed" in failure for failure in report.failures)
    # The lists were still recorded: the publish succeeded and is live.
    assert refresh.state_get(db, refresh.LAST_FULL_REFRESH_KEY) == NOW.isoformat()
    # Both clearings are still owed, in order, and only a success removes them.
    assert refresh.state_get(db, refresh.CLEARING_PENDING_KEY)["events"] == [
        A_FILINGS_RELEASE,
        A_MONEY_CHECK_VERDICT_SET,
    ]


def test_a_dry_run_reads_the_lists_and_writes_no_state(db, monkeypatch) -> None:
    board = Board({})
    monkeypatch.setattr(refresh, "read_lists", lambda http, base_url: board.readings())
    refresh.state_set(
        db,
        refresh.RECHECK_PENDING_KEY,
        {"recorded_at": NOW.isoformat(), "after": A_MONEY_DOWNLOAD_RELEASE},
    )
    report, calls = _run(db, totals=FakeTotals(), payments=FakePayments(), dry_run=True)
    assert report.ok
    assert report.plan.totals_due  # a first run
    assert calls["totals"] == []
    assert calls["payments"][0]["dry_run"] is True
    # No retry either: a re-check writes verdicts.
    assert calls["recheck"] == [] and calls["clear"] == []
    assert refresh.state_get(db, "list:pcf-reports") is None
    assert refresh.state_get(db, refresh.RECHECK_PENDING_KEY) is not None
    assert refresh.full_run_lease_holder(db) is None
    assert "would run for 2022, 2023, 2024, 2025, 2026" in report.summary()


def test_the_refresh_never_hands_a_loader_a_publish_hash_or_any_waiver(
    db, monkeypatch
) -> None:
    board = Board({})
    monkeypatch.setattr(refresh, "read_lists", lambda http, base_url: board.readings())
    report, calls = _run(
        db, totals=FakeTotals(published=True), payments=FakePayments(published=True)
    )
    assert report.ok, report.summary()
    assert len(calls["totals"]) == 1 and len(calls["payments"]) == 1
    assert set(calls["totals"][0]) == {"years", "store", "log", "before_publish"}
    assert set(calls["payments"][0]) == {"dry_run", "store", "log", "before_publish"}
    for options in (*calls["totals"], *calls["payments"]):
        for waiver in ("publish_hash", "publish_hashes", "operator_approved"):
            assert waiver not in options
    # And in the loaders' real signatures those names exist, so the assertion is
    # about a real waiver and not a misspelling.
    assert (
        "publish_hashes"
        in inspect.signature(campaign_finance.load_campaign_finance).parameters
    )
    assert (
        "publish_hash"
        in inspect.signature(
            campaign_finance_filings.load_campaign_finance_filings
        ).parameters
    )
    for loader in (
        campaign_finance.load_campaign_finance,
        campaign_finance_filings.load_campaign_finance_filings,
    ):
        assert "before_publish" in inspect.signature(loader).parameters


def test_a_lease_taken_by_another_run_stops_every_publish(db, monkeypatch) -> None:
    """(g) Fail closed: the gate is asked right before each publish."""
    board = Board({})
    monkeypatch.setattr(refresh, "read_lists", lambda http, base_url: board.readings())
    t0 = datetime.now(UTC)
    ours = refresh.FullRunLease(db=db, purpose="the daily campaign-money refresh")
    assert ours.acquire(now=t0)
    # Hours pass, the lease expires, and a hand-run load takes it.
    thief = refresh.FullRunLease(db=db, purpose="a hand-run campaign-money totals load")
    assert thief.acquire(now=t0 + refresh.FULL_RUN_LEASE_TTL + timedelta(minutes=1))

    report, calls = _run(
        db,
        totals=FakeTotals(published=True),
        payments=FakePayments(published=True),
        lease=ours,
    )
    assert not report.ok
    assert len(calls["totals"]) == 1 and len(calls["payments"]) == 1
    assert not report.published_totals and not report.published_payments
    assert calls["clear"] == [] and calls["recheck"] == []
    assert any(
        "totals refresh quarantined: caller_allows_publish" in one
        for one in report.failures
    )
    assert any(
        "payments refresh quarantined: not published" in one for one in report.failures
    )
    assert all(
        "a hand-run campaign-money totals load" in one for one in report.failures
    )
    # Nothing recorded as handled, so tomorrow compares the same lists again.
    assert refresh.state_get(db, refresh.LAST_FULL_REFRESH_KEY) is None
    assert thief.release()


def test_the_summary_states_what_is_live_and_whether_this_run_published_it(
    db, monkeypatch
) -> None:
    """(e) No line ever says 'the previous set is still live' on its own authority."""
    board = Board({})
    monkeypatch.setattr(refresh, "read_lists", lambda http, base_url: board.readings())
    live = FakeLive(_live("release-old", "snapshot-old", at=NOW - timedelta(days=9)))

    # The totals publish, then the final clearing fails: the summary still says the
    # new snapshot is live and that this run published it.
    report, calls = _run(
        db,
        totals=FakeTotals(published=True),
        payments=FakePayments(no_change=True),
        clear=lambda clearing: clearing.event == A_MONEY_CHECK_VERDICT_SET,
        live=live,
    )
    assert not report.ok
    summary = report.summary()
    assert "live at the end of this run:" in summary
    assert (
        "payments release: release-old, fetched 2026-09-15, live before this run started"
        in summary
    )
    assert (
        "totals and register snapshot: snapshot-1, fetched 2026-09-24, published by this run"
        in summary
    )
    assert (
        "FAILED, so this run is incomplete (what is live is stated above):" in summary
    )
    assert "previous set is still live" not in summary

    # And on the empty test database, read for real: nothing is live, and it says so.
    assert refresh.live_versions(db) == refresh.LiveVersions()
    report, calls = _run(db, totals=FakeTotals(), payments=FakePayments(no_change=True))
    assert "payments release: nothing is live" in report.summary()
    assert "totals and register snapshot: nothing is live" in report.summary()
