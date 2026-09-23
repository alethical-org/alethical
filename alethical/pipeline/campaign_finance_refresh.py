"""The daily campaign-money refresh: what to fetch today, and in what order.

Net: nothing used to refresh Alethical's campaign-money pages on a schedule, so they
sat 3 to 6 weeks behind the Board. This module is the one plan a scheduled run, a
hand-started run and a laptop run all follow (D3 on
[#2344](https://github.com/alethical-org/alethical/issues/2344)):

1. **One lock for the whole run**, held in the database for as long as the run lasts,
   so a scheduled start and a hand start at the same minute produce 1 run. The
   loaders' own short publish locks stay as they are; this one is above them.
2. **Retry first.** A re-check that did not finish last time is run before anything
   else, because until it finishes every committee page says nobody has compared its
   figures.
3. **Read 6 small lists** from the Board (the 3 registered-filer lists and the 3
   current-report lists), hash their content with row order removed, and compare with
   the versions the last successful run handled. A change to any of them means a
   filer registered, terminated or filed a report, which is what moves the official
   totals. On a change, and once a week regardless, run a **full totals refresh for
   every supported year**: a publication of the totals replaces the whole set, so a
   2-year run would erase 2022 to 2023.
4. **Download the 3 payment files every day** and publish when every check passes.
   They serve no size, date or change marker, so a full download is the only change
   detector, and the record-set hash makes an unchanged file a no-op.
5. **After any publish**: clear the saved pages, run both money re-checks, and clear
   the saved pages again once the verdicts have changed.
6. **Record a list as handled only after the work it triggered succeeded**, so a
   quarantined refresh is retried the next day rather than forgotten.

A quarantine leaves the previous set live (the loaders already guarantee that), keeps
the bytes and printed reasons, and makes the run exit non-zero; the workflow turns a
non-zero exit into a GitHub issue. Freshness, stated honestly wherever it is stated:
payments are checked daily; totals are refreshed when a list changes and weekly.
"""

from __future__ import annotations

import hashlib
import json
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from typing import Any, Callable, Iterator, Optional

import requests
from sqlalchemy import text
from sqlalchemy.orm import Session

from alethical.db import models as schema
from alethical.pipeline import campaign_finance_filings as filings
from alethical.pipeline.campaign_finance import (
    CampaignFinanceRefusal,
    LoadReport,
    load_campaign_finance,
)
from alethical.pipeline.campaign_finance_filings import (
    BOARD_BASE_URL,
    CampaignFinanceFilingsRefusal,
    FilingsRun,
)
from alethical.pipeline.campaign_finance_recheck import (
    RecheckReport,
    recheck_stated_figures,
)
from alethical.pipeline.cache_purge import (
    clear_after_publish,
    when_a_filings_release_lands,
    when_a_money_download_release_lands,
    when_the_money_checks_finish,
)

# One key for the whole refresh, distinct from the 2 publish locks
# (610312263010 payments, 610312263011 filings). Session-level rather than
# transaction-level, because it has to outlive every transaction in the run.
FULL_RUN_LOCK_KEY = 610312263012

# The 6 lists whose content decides whether the official totals moved. Same route and
# form as the filer directory (design §9.7).
LIST_ACTIONS: tuple[str, ...] = (
    "all-registered-candidates",
    "all-registered-ptus",
    "all-registered-pcfs",
    "candidate-reports",
    "ptu-reports",
    "pcf-reports",
)

FULL_REFRESH_EVERY = timedelta(days=7)
FIRST_SUPPORTED_YEAR = 2022

LAST_FULL_REFRESH_KEY = "totals_last_full_refresh_at"
RECHECK_PENDING_KEY = "recheck_pending"


def supported_years(today: Optional[date] = None) -> list[int]:
    """Every year a totals publication must carry, first supported year to this one."""
    return list(range(FIRST_SUPPORTED_YEAR, (today or date.today()).year + 1))


def list_form(action: str) -> dict[str, str]:
    return {
        "action": "grid_data",
        "data[action]": action,
        "data[type]": "current-lists",
        "data[params][0]": "all",
    }


def stable_hash(payload: Any) -> str:
    """A hash of a list's content with its row order removed.

    The route answers ``{"cols": [...], "data": {reg: [[row], ...]}}``; the rows are
    what changes when a filer registers, terminates or files, and their order is not
    promised. Each row is serialised with its column names and the rows are sorted, so
    2 responses holding the same rows in a different order hash the same. Any other
    shape (``[]``, ``false``) hashes as its own serialisation, so a route that starts
    answering wrongly reads as a change and gets a person's eyes via the totals run's
    own checks rather than being silently equal.
    """
    if isinstance(payload, dict) and "cols" in payload and "data" in payload:
        columns = payload["cols"]
        groups = payload["data"]
        rows = (
            [row for group in groups.values() for row in group]
            if isinstance(groups, dict)
            else list(groups)
        )
        serialised = sorted(
            json.dumps(dict(zip(columns, row)), sort_keys=True, ensure_ascii=False)
            for row in rows
        )
    else:
        serialised = [json.dumps(payload, sort_keys=True, ensure_ascii=False)]
    digest = hashlib.sha256()
    for line in serialised:
        digest.update(line.encode("utf-8"))
        digest.update(b"\n")
    return digest.hexdigest()


@dataclass
class ListReading:
    action: str
    content_hash: Optional[str]
    rows: Optional[int]
    error: Optional[str] = None


def read_lists(
    http: requests.Session, base_url: str = BOARD_BASE_URL
) -> list[ListReading]:
    readings: list[ListReading] = []
    for action in LIST_ACTIONS:
        response = filings.post_form(
            http, filings.directory_url(base_url), list_form(action)
        )
        if response.status_code != 200:
            readings.append(
                ListReading(action, None, None, f"answered HTTP {response.status_code}")
            )
            continue
        try:
            payload = response.json()
        except ValueError as error:
            readings.append(ListReading(action, None, None, f"not JSON: {error}"))
            continue
        rows = None
        if isinstance(payload, dict) and isinstance(payload.get("data"), dict):
            rows = sum(len(group) for group in payload["data"].values())
        readings.append(ListReading(action, stable_hash(payload), rows))
    return readings


# --- The one lock ------------------------------------------------------------------


def try_hold_full_run_lock(connection) -> bool:
    """Take the run-wide lock on this connection, or say that another run holds it.

    Session-level, so it outlives every transaction of the run. The caller keeps this
    connection open and unused for anything else, and calls ``release_full_run_lock``
    when the run ends, however it ends: a pooled connection that is merely "closed"
    goes back to the pool still holding the lock, and the next run in the same
    process would be shut out by its own predecessor.
    """
    return bool(
        connection.execute(
            text("SELECT pg_try_advisory_lock(:key)"), {"key": FULL_RUN_LOCK_KEY}
        ).scalar()
    )


def release_full_run_lock(connection) -> None:
    connection.execute(
        text("SELECT pg_advisory_unlock(:key)"), {"key": FULL_RUN_LOCK_KEY}
    )
    # And never hand this connection back to the pool: whatever else it holds, the
    # next run starts from a fresh one.
    connection.invalidate()


@contextmanager
def full_run_lock(engine) -> Iterator[bool]:
    """``with full_run_lock(engine) as held:`` — held for the block, released after."""
    connection = engine.connect()
    held = False
    try:
        held = try_hold_full_run_lock(connection)
        yield held
    finally:
        if held:
            try:
                release_full_run_lock(connection)
            except Exception:  # noqa: BLE001 - the process is ending either way
                connection.invalidate()
        connection.close()


# --- Remembered state ---------------------------------------------------------------


def state_get(db: Session, key: str) -> Any:
    row = db.get(schema.CampaignFinanceRefreshState, key)
    return None if row is None else row.value


def state_set(db: Session, key: str, value: Any) -> None:
    row = db.get(schema.CampaignFinanceRefreshState, key)
    if row is None:
        db.add(schema.CampaignFinanceRefreshState(key=key, value=value))
    else:
        row.value = value
        row.updated_at = datetime.now(UTC)
    db.commit()


def state_delete(db: Session, key: str) -> None:
    row = db.get(schema.CampaignFinanceRefreshState, key)
    if row is not None:
        db.delete(row)
        db.commit()


# --- The plan -----------------------------------------------------------------------


@dataclass
class Plan:
    totals_due: bool
    reasons: list[str] = field(default_factory=list)
    changed_lists: list[str] = field(default_factory=list)
    unreadable_lists: list[str] = field(default_factory=list)


def plan_totals_refresh(
    readings: list[ListReading],
    handled: dict[str, Optional[str]],
    last_full_refresh_at: Optional[datetime],
    *,
    now: datetime,
    force: bool = False,
) -> Plan:
    """Whether the official totals are refreshed today, and why.

    Pure, so the rule is testable without a Board or a database. A list that could not
    be read is neither a change nor a no-change: it is named, and it never blocks the
    payments half of the run. A list read for the first time (nothing handled yet) is a
    change, because nothing has been compared against it.
    """
    plan = Plan(totals_due=False)
    for reading in readings:
        if reading.error is not None:
            plan.unreadable_lists.append(f"{reading.action}: {reading.error}")
            continue
        if handled.get(reading.action) != reading.content_hash:
            plan.changed_lists.append(reading.action)
    if plan.changed_lists:
        plan.totals_due = True
        plan.reasons.append("list content changed: " + ", ".join(plan.changed_lists))
    if last_full_refresh_at is None:
        plan.totals_due = True
        plan.reasons.append("no full totals refresh has been recorded")
    elif now - last_full_refresh_at >= FULL_REFRESH_EVERY:
        plan.totals_due = True
        plan.reasons.append(
            f"last full totals refresh was {last_full_refresh_at.date().isoformat()}, "
            f"{(now - last_full_refresh_at).days} days ago (weekly regardless)"
        )
    if force:
        plan.totals_due = True
        plan.reasons.append("a full totals refresh was asked for")
    return plan


# --- The run ------------------------------------------------------------------------


@dataclass
class RefreshReport:
    started_at: datetime
    dry_run: bool
    plan: Optional[Plan] = None
    readings: list[ListReading] = field(default_factory=list)
    totals: Optional[FilingsRun] = None
    payments: Optional[LoadReport] = None
    recheck: Optional[RecheckReport] = None
    failures: list[str] = field(default_factory=list)
    lines: list[str] = field(default_factory=list)
    finished_at: Optional[datetime] = None

    @property
    def ok(self) -> bool:
        return not self.failures

    def summary(self) -> str:
        minutes = (
            (self.finished_at or datetime.now(UTC)) - self.started_at
        ).total_seconds() / 60
        out = [
            f"campaign-money refresh, {'dry run, ' if self.dry_run else ''}{minutes:.1f} minutes"
        ]
        for reading in self.readings:
            out.append(
                f"  list {reading.action}: "
                + (
                    f"{reading.rows if reading.rows is not None else '?'} rows, "
                    f"{reading.content_hash[:12]}"
                    if reading.content_hash
                    else f"not read ({reading.error})"
                )
            )
        if self.plan is not None:
            out.append(
                "  totals: "
                + (
                    "refresh due (" + "; ".join(self.plan.reasons) + ")"
                    if self.plan.totals_due
                    else "no list changed and the weekly refresh is not due"
                )
            )
        out.extend(f"  {line}" for line in self.lines)
        if self.failures:
            out.append("  FAILED:")
            out.extend(f"    {failure}" for failure in self.failures)
        else:
            out.append("  every step finished")
        return "\n".join(out)


def refresh_campaign_money(
    db: Session,
    *,
    dry_run: bool = False,
    force_totals: bool = False,
    http: Optional[requests.Session] = None,
    store: Any = None,
    base_url: str = BOARD_BASE_URL,
    today: Optional[date] = None,
    now: Optional[datetime] = None,
    log: Callable[[str], None] = print,
    load_totals: Callable[..., FilingsRun] = filings.load_campaign_finance_filings,
    load_payments: Callable[..., LoadReport] = load_campaign_finance,
    recheck: Callable[..., RecheckReport] = recheck_stated_figures,
    clear: Callable[..., bool] = clear_after_publish,
) -> RefreshReport:
    """One refresh, start to finish. The caller holds the run-wide lock."""
    started = now or datetime.now(UTC)
    report = RefreshReport(started_at=started, dry_run=dry_run)
    http = http or filings.http_session()

    # 1. Retry a re-check that did not finish last time, before reading anything new.
    pending = state_get(db, RECHECK_PENDING_KEY)
    if pending and not dry_run:
        log(
            f"retrying the money re-checks left unfinished on {pending.get('recorded_at')}"
        )
        _run_rechecks(db, report, recheck=recheck, clear=clear, log=log)

    # 2. Read the 6 lists and decide about the totals.
    report.readings = read_lists(http, base_url)
    handled = {action: state_get(db, f"list:{action}") for action in LIST_ACTIONS}
    last_full = state_get(db, LAST_FULL_REFRESH_KEY)
    last_full_at = datetime.fromisoformat(last_full) if last_full else None
    report.plan = plan_totals_refresh(
        report.readings, handled, last_full_at, now=started, force=force_totals
    )
    log("\n".join(report.summary().splitlines()[1:]))

    # 3. The totals, for every supported year, when due.
    if report.plan.totals_due:
        if dry_run:
            report.lines.append(
                "dry run: the totals refresh would run for "
                + ", ".join(str(year) for year in supported_years(today))
                + " and was skipped"
            )
        else:
            try:
                report.totals = load_totals(
                    db, years=supported_years(today), store=store, log=log
                )
            except CampaignFinanceFilingsRefusal as refusal:
                report.failures.append(f"totals refresh refused: {refusal}")
            else:
                run = report.totals
                if run.blocked:
                    report.failures.append(
                        "totals refresh quarantined: "
                        + "; ".join(
                            f"{check.name}: {check.detail}" for check in run.blocked
                        )
                    )
                else:
                    # Handled only now, after the work succeeded (or was a no-op).
                    for reading in report.readings:
                        if reading.content_hash:
                            state_set(
                                db, f"list:{reading.action}", reading.content_hash
                            )
                    state_set(db, LAST_FULL_REFRESH_KEY, started.isoformat())
                    report.lines.append(
                        "totals: published a new snapshot"
                        if run.published
                        else "totals: unchanged, the published snapshot already holds these figures"
                    )
                    if run.published:
                        _after_publish(
                            db,
                            report,
                            when_a_filings_release_lands(),
                            clear=clear,
                            log=log,
                        )

    # 4. The 3 payment files, every day.
    try:
        report.payments = load_payments(db, dry_run=dry_run, store=store, log=log)
    except CampaignFinanceRefusal as refusal:
        report.failures.append(f"payments refresh refused: {refusal}")
    else:
        payments = report.payments
        if payments.refusal:
            report.failures.append(f"payments refresh quarantined: {payments.refusal}")
        elif payments.published:
            report.lines.append("payments: published a new release")
            _after_publish(
                db, report, when_a_money_download_release_lands(), clear=clear, log=log
            )
        else:
            report.lines.append(
                "payments: dry run, nothing written"
                if dry_run
                else "payments: unchanged, the published release already holds these files"
            )

    # 5. The re-checks, once, for whatever published in this run.
    if state_get(db, RECHECK_PENDING_KEY) and not dry_run:
        _run_rechecks(db, report, recheck=recheck, clear=clear, log=log)

    report.finished_at = datetime.now(UTC)
    return report


def _after_publish(db: Session, report: RefreshReport, clearing, *, clear, log) -> None:
    if clear(clearing, published=True, log=log):
        report.failures.append(f"clearing saved pages failed after {clearing.event}")
    state_set(
        db,
        RECHECK_PENDING_KEY,
        {"recorded_at": datetime.now(UTC).isoformat(), "after": clearing.event},
    )


def _run_rechecks(db: Session, report: RefreshReport, *, recheck, clear, log) -> None:
    outcome = recheck(db, log=log)
    report.recheck = outcome
    log(outcome.summary())
    if outcome.failed:
        report.failures.append(
            "a money re-check did not finish; it is retried on the next run: "
            + "; ".join(one.error or "" for one in outcome.outcomes if not one.ran)
        )
        return
    state_delete(db, RECHECK_PENDING_KEY)
    report.lines.append("re-checks: both finished and their verdicts are live")
    if clear(when_the_money_checks_finish(), published=True, log=log):
        report.failures.append("clearing saved pages failed after the re-checks")
