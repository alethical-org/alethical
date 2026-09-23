"""The daily campaign-money refresh's plan, lock and bookkeeping (D3, #2344).

The loaders themselves are tested in their own files; here they are stand-ins that
answer the way a real run does, so what is proven is the order and the memory: what
runs when, what is recorded only after success, and what is retried.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import text

from alethical.db.session import get_engine, get_session_factory
from alethical.pipeline import campaign_finance_refresh as refresh
from alethical.pipeline.campaign_finance_recheck import CheckOutcome, RecheckReport


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
    # A route answering wrongly hashes as its own shape, never as "no change".
    assert refresh.stable_hash([]) != refresh.stable_hash(GRID)
    assert refresh.stable_hash(False) != refresh.stable_hash([])


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


def test_an_unreadable_list_is_named_and_is_not_a_change() -> None:
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


def test_two_starts_at_once_take_one_lock(db) -> None:
    engine = get_engine()
    with refresh.full_run_lock(engine) as first:
        assert first
        with refresh.full_run_lock(engine) as second:
            assert not second
    # Released, and the connection not returned to the pool holding it, so the next
    # day's run in the same process is not shut out by its predecessor.
    with refresh.full_run_lock(engine) as third:
        assert third


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


def _run(db, *, totals, payments, recheck=None, clear=None, readings=None, **kwargs):
    calls: dict[str, list] = {"totals": [], "payments": [], "recheck": [], "clear": []}

    def load_totals(session, **options):
        calls["totals"].append(options)
        return totals

    def load_payments(session, **options):
        calls["payments"].append(options)
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
        now=NOW,
        log=lambda message: None,
        **kwargs,
    )
    return report, calls


def test_a_first_run_refreshes_every_supported_year_and_records_the_lists_only_on_success(
    db, monkeypatch
) -> None:
    board = Board({})
    monkeypatch.setattr(refresh, "read_lists", lambda http, base_url: board.readings())

    quarantined = FakeTotals(
        blocked=[Check("filer_count_within_band", "1 against 1,611")]
    )
    report, calls = _run(db, totals=quarantined, payments=FakePayments(no_change=True))
    assert not report.ok
    assert "totals refresh quarantined" in report.failures[0]
    assert calls["totals"][0]["years"] == refresh.supported_years(NOW.date())
    # Nothing handled: the same lists are compared again tomorrow.
    assert refresh.state_get(db, "list:pcf-reports") is None
    assert refresh.state_get(db, refresh.LAST_FULL_REFRESH_KEY) is None
    # The payments half still ran.
    assert len(calls["payments"]) == 1

    report, calls = _run(
        db, totals=FakeTotals(published=True), payments=FakePayments(no_change=True)
    )
    assert report.ok, report.summary()
    assert refresh.state_get(db, "list:pcf-reports") == refresh.stable_hash(GRID)
    assert refresh.state_get(db, refresh.LAST_FULL_REFRESH_KEY) == NOW.isoformat()
    # Publish, clear, re-check, clear again; and nothing left pending.
    assert calls["clear"] == [
        "a new filed-totals or registered-filer release",
        "the 2 money checks finished against the new release",
    ]
    assert len(calls["recheck"]) == 1
    assert refresh.state_get(db, refresh.RECHECK_PENDING_KEY) is None


def test_an_unchanged_day_is_a_no_op(db, monkeypatch) -> None:
    board = Board({})
    monkeypatch.setattr(refresh, "read_lists", lambda http, base_url: board.readings())
    for reading in board.readings():
        refresh.state_set(db, f"list:{reading.action}", reading.content_hash)
    refresh.state_set(
        db, refresh.LAST_FULL_REFRESH_KEY, (NOW - timedelta(days=1)).isoformat()
    )

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
    for reading in board.readings():
        refresh.state_set(db, f"list:{reading.action}", reading.content_hash)
    refresh.state_set(
        db, refresh.LAST_FULL_REFRESH_KEY, (NOW - timedelta(days=1)).isoformat()
    )
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
    assert calls["clear"] == [
        "a new campaign-money download release",
        "the 2 money checks finished against the new release",
    ]
    assert len(calls["recheck"]) == 1


def test_an_unfinished_recheck_is_retried_first_on_the_next_run(
    db, monkeypatch
) -> None:
    board = Board({})
    monkeypatch.setattr(refresh, "read_lists", lambda http, base_url: board.readings())
    for reading in board.readings():
        refresh.state_set(db, f"list:{reading.action}", reading.content_hash)
    refresh.state_set(
        db, refresh.LAST_FULL_REFRESH_KEY, (NOW - timedelta(days=1)).isoformat()
    )

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
        db, totals=FakeTotals(), payments=FakePayments(published=True), recheck=broken
    )
    assert not report.ok
    assert "retried on the next run" in report.failures[0]
    assert refresh.state_get(db, refresh.RECHECK_PENDING_KEY) is not None
    # Cleared once after the publish; not again, because the verdicts never landed.
    assert calls["clear"] == ["a new campaign-money download release"]

    report, calls = _run(db, totals=FakeTotals(), payments=FakePayments(no_change=True))
    assert report.ok, report.summary()
    # The retry ran before the lists were read, and cleared once its verdicts were live.
    assert len(calls["recheck"]) == 1
    assert calls["clear"] == ["the 2 money checks finished against the new release"]
    assert refresh.state_get(db, refresh.RECHECK_PENDING_KEY) is None


def test_a_dry_run_reads_the_lists_and_writes_no_state(db, monkeypatch) -> None:
    board = Board({})
    monkeypatch.setattr(refresh, "read_lists", lambda http, base_url: board.readings())
    report, calls = _run(db, totals=FakeTotals(), payments=FakePayments(), dry_run=True)
    assert report.ok
    assert report.plan.totals_due  # a first run
    assert calls["totals"] == []
    assert calls["payments"][0]["dry_run"] is True
    assert refresh.state_get(db, "list:pcf-reports") is None
    assert "would run for 2022, 2023, 2024, 2025, 2026" in report.summary()


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
