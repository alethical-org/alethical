"""The daily campaign-money refresh: what to fetch today, and in what order.

Net: nothing used to refresh Alethical's campaign-money pages on a schedule, so they
sat 3 to 6 weeks behind the Board. This module is the one plan a scheduled run, a
hand-started run and a laptop run all follow (D3 on
[#2344](https://github.com/alethical-org/alethical/issues/2344)):

1. **One lease for the whole run**, a row in ``cf_refresh_state`` taken in a single
   statement and held for as long as the run lasts, so a scheduled start and a hand
   start at the same minute produce 1 run. Every publication route takes it: this
   refresh and both hand-run loader scripts. The loaders' own short publish locks stay
   as they are; this one is above them. A row rather than ``pg_try_advisory_lock``
   because production connects through Supabase's pooler in transaction mode, where a
   session-level lock is unsafe: each statement may reach a different backend, so the
   lock can be released by, or left held on, a backend the run never sees again
   (https://supabase.com/docs/guides/database/connecting-to-postgres#transaction-mode-limitations).
   The lease expires after 4 hours, so a crashed run frees it without a person; the
   run that holds it renews it right before each publish, and a run that finds its
   lease taken by another owner does not publish.
2. **Retry first.** A saved-page clearing that did not finish last time is retried
   before anything else, because it is cheap and until it finishes readers are served
   the previous answer. Then a money re-check that did not finish is retried, because
   until it finishes every committee page says nobody has compared its figures. At
   most 1 re-check attempt per run, and only for a generation of data that is still
   live or has since been replaced by a newer one.
3. **Read 6 small lists** from the Board (the 3 registered-filer lists and the 3
   current-report lists), hash their content with row order removed, and compare with
   the versions the last successful run handled. A change to any of them means a
   filer registered, terminated or filed a report, which is what moves the official
   totals. On a change, and once a week regardless, run a **full totals refresh for
   every supported year**: a publication of the totals replaces the whole set, so a
   2-year run would erase 2022 to 2023. A list that could not be read, or that came
   back in the wrong shape, is neither a change nor a no-change: it is named, the run
   is reported as incomplete, and the list is never recorded as handled.
4. **Download the 3 payment files every day** and publish when every check passes.
   They serve no size, date or change marker, so a full download is the only change
   detector, and the record-set hash makes an unchanged file a no-op. This half runs
   whatever happened to the lists.
5. **After any publish**: clear the saved pages, run both money re-checks, and clear
   the saved pages again once the verdicts have changed. Each step that did not
   finish leaves its own marker (``clearing_pending``, ``recheck_pending``) that is
   removed only when that step succeeds.
6. **Record a list as handled only after the work it triggered succeeded**, so a
   quarantined refresh is retried the next day rather than forgotten.

**The first scheduled run has no marker to compare against**, because the one-off hand
runs that got the site live never recorded one, and it must not be handed one: stamping
the 6 lists as handled without processing them would hide a change nobody compared. So
the first run fetches the totals once, under the weekly rule (no full refresh is
recorded, so one is due), records the 6 list hashes only after that succeeds, and every
later run compares. The cost is paid once: about 54 minutes and 6,444 requests.

A quarantine leaves the previous set live (the loaders already guarantee that), keeps
the bytes and printed reasons, and makes the run exit non-zero. The summary a run prints
says exactly which payments release and which totals snapshot are live when it ends and
whether this run published each, so a failure after a successful publish is never
reported as "the previous set is still live". With ``--alert-issue`` the script files or
updates one GitHub issue quoting that summary. Freshness, stated honestly wherever it is
stated: payments are checked daily; totals are refreshed when a list changes and weekly;
a run whose lists could not be read is reported as incomplete.
"""

from __future__ import annotations

import atexit
import hashlib
import json
import os
import secrets
import socket
import subprocess
import sys
from contextlib import ExitStack, contextmanager
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from typing import Any, Callable, Iterable, Iterator, Mapping, Optional

import requests
from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from alethical.db import models as schema
from alethical.pipeline import campaign_finance_filings as filings
from alethical.pipeline.campaign_finance import (
    CampaignFinanceRefusal,
    LoadReport,
    live_release,
    load_campaign_finance,
)
from alethical.pipeline.campaign_finance_filings import (
    BOARD_BASE_URL,
    CampaignFinanceFilingsRefusal,
    FilingsRun,
    live_filings_snapshot,
)
from alethical.pipeline.campaign_finance_recheck import (
    RecheckReport,
    recheck_stated_figures,
)
from alethical.pipeline.cache_purge import (
    A_FILINGS_RELEASE,
    A_MONEY_CHECK_VERDICT_SET,
    A_MONEY_DOWNLOAD_RELEASE,
    Clearing,
    clear_after_publish,
    when_a_filings_release_lands,
    when_a_money_download_release_lands,
    when_the_money_checks_finish,
)

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
CLEARING_PENDING_KEY = "clearing_pending"

# The one run-wide lease. Its row's ``value`` holds ``owner`` (a token unique to the
# process that took it), ``purpose`` (what the run is, in words), ``acquired_at`` and
# ``expires_at``. Four hours: the longest honest day is a 54-minute totals fetch, the
# payments download and 72 minutes of re-checks, and the workflow's own limit is 5.
FULL_RUN_LEASE_KEY = "full_run_lease"
FULL_RUN_LEASE_TTL = timedelta(hours=4)

#: The 3 clearings a run can owe, by the event name a marker stores.
CLEARINGS_BY_EVENT: dict[str, Callable[[], Clearing]] = {
    A_MONEY_DOWNLOAD_RELEASE: when_a_money_download_release_lands,
    A_FILINGS_RELEASE: when_a_filings_release_lands,
    A_MONEY_CHECK_VERDICT_SET: when_the_money_checks_finish,
}

REFRESH_ALERT_TITLE = "The daily campaign-money refresh did not finish"


def _stderr(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


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


def grid_shape_error(payload: Any) -> Optional[str]:
    """Why ``payload`` is not the grid this route answers with, or ``None`` when it is.

    The route answers ``{"cols": [...], "data": {reg: [[row], ...]}}``. Anything else
    (``[]``, ``false``, a bare string, a dict missing either key) is a route answering
    wrongly, and that is a failure to read the list rather than a list with new
    content: hashing it would make a broken route read as a change and start a
    54-minute totals fetch on nothing.
    """
    if not isinstance(payload, dict):
        return f"not a grid: got {type(payload).__name__} where an object was expected"
    if not isinstance(payload.get("cols"), list):
        return "not a grid: no 'cols' list"
    if not isinstance(payload.get("data"), (dict, list)):
        return "not a grid: no 'data' rows"
    return None


def stable_hash(payload: Any) -> str:
    """A hash of a list's content with its row order removed.

    The route answers ``{"cols": [...], "data": {reg: [[row], ...]}}``; the rows are
    what changes when a filer registers, terminates or files, and their order is not
    promised. Each row is serialised with its column names and the rows are sorted, so
    2 responses holding the same rows in a different order hash the same. Any other
    shape hashes as its own serialisation; ``read_lists`` refuses those shapes before
    they get here (``grid_shape_error``), so a route that starts answering wrongly is
    reported as unreadable rather than as a change.
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
    """Read the 6 lists. A failure of any kind is an ``error`` on that reading.

    HTTP failure, a body that is not JSON, and a body in the wrong shape are all the
    same thing to the plan: the list could not be read, so whether it changed is
    unknown. None of them is hashed, so none can be recorded as handled.
    """
    readings: list[ListReading] = []
    for action in LIST_ACTIONS:
        try:
            response = filings.post_form(
                http, filings.directory_url(base_url), list_form(action)
            )
        except requests.RequestException as error:
            readings.append(ListReading(action, None, None, f"not reachable: {error}"))
            continue
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
        shape = grid_shape_error(payload)
        if shape is not None:
            readings.append(ListReading(action, None, None, shape))
            continue
        rows = (
            sum(len(group) for group in payload["data"].values())
            if isinstance(payload["data"], dict)
            else len(payload["data"])
        )
        readings.append(ListReading(action, stable_hash(payload), rows))
    return readings


# --- The one lease -----------------------------------------------------------------

_ACQUIRE_LEASE = text(
    """
    INSERT INTO cf_refresh_state (key, value, updated_at)
    VALUES (:key, CAST(:value AS jsonb), :now)
    ON CONFLICT (key) DO UPDATE SET
        value = CASE
            WHEN cf_refresh_state.value->>'owner' = :owner
            THEN cf_refresh_state.value
                 || jsonb_build_object('expires_at', EXCLUDED.value->>'expires_at')
            ELSE EXCLUDED.value
        END,
        updated_at = EXCLUDED.updated_at
    WHERE cf_refresh_state.value->>'owner' = :owner
       OR CAST(cf_refresh_state.value->>'expires_at' AS timestamptz) <= :now
    RETURNING 1
    """
)

_RELEASE_LEASE = text(
    "DELETE FROM cf_refresh_state WHERE key = :key AND value->>'owner' = :owner"
)

_READ_LEASE = text("SELECT value FROM cf_refresh_state WHERE key = :key")


def try_acquire_full_run_lease(
    db: Session,
    owner: str,
    *,
    purpose: str,
    now: Optional[datetime] = None,
    ttl: timedelta = FULL_RUN_LEASE_TTL,
) -> bool:
    """Take or renew the run-wide lease for ``owner`` in one statement.

    One statement, so it is atomic under transaction pooling as well as on a direct
    connection: 2 acquirers racing on the same key are serialised by the row's primary
    key, and the ``WHERE`` makes the update happen only when the existing lease has
    expired or already belongs to this owner. The row comes back only when this owner
    now holds it. Called again by the holder it extends ``expires_at`` and keeps
    ``acquired_at``. Clocks: ``now`` is the caller's clock, and a lease's expiry is
    compared against the clock of whoever asks next; a 4-hour lease dwarfs any drift
    between a laptop and a GitHub runner.
    """
    moment = now or datetime.now(UTC)
    value = {
        "owner": owner,
        "purpose": purpose,
        "acquired_at": moment.isoformat(),
        "expires_at": (moment + ttl).isoformat(),
    }
    row = db.execute(
        _ACQUIRE_LEASE,
        {
            "key": FULL_RUN_LEASE_KEY,
            "value": json.dumps(value),
            "now": moment,
            "owner": owner,
        },
    ).first()
    db.commit()
    return row is not None


def release_full_run_lease(db: Session, owner: str) -> bool:
    """Drop the lease, and only when ``owner`` holds it. A non-owner's call is a no-op."""
    result = db.execute(_RELEASE_LEASE, {"key": FULL_RUN_LEASE_KEY, "owner": owner})
    db.commit()
    return bool(result.rowcount)


def full_run_lease_holder(db: Session) -> Optional[dict[str, Any]]:
    """The lease row's value (owner, purpose, acquired_at, expires_at), or ``None``."""
    value = db.execute(_READ_LEASE, {"key": FULL_RUN_LEASE_KEY}).scalar()
    return value if isinstance(value, dict) else None


def describe_holder(holder: Optional[Mapping[str, Any]]) -> str:
    if holder is None:
        return "nobody holds the run-wide lease"
    return (
        f"the run-wide lease is held by {holder.get('owner')} for "
        f"{holder.get('purpose')} until {holder.get('expires_at')}"
    )


def new_owner_token() -> str:
    return f"{socket.gethostname()}:{os.getpid()}:{secrets.token_hex(4)}"


@dataclass
class FullRunLease:
    """One run's hold on the run-wide lease. Truthy exactly when held.

    Built by ``hold_full_run_lease``; used by the refresh to prove, right before each
    publish, that the lease is still its own (``refusal``).
    """

    db: Session
    purpose: str
    owner: str = field(default_factory=new_owner_token)
    ttl: timedelta = FULL_RUN_LEASE_TTL
    held: bool = False

    def __bool__(self) -> bool:
        return self.held

    def acquire(self, now: Optional[datetime] = None) -> bool:
        self.held = try_acquire_full_run_lease(
            self.db, self.owner, purpose=self.purpose, now=now, ttl=self.ttl
        )
        return self.held

    def renew(self, now: Optional[datetime] = None) -> bool:
        """Extend the lease; ``False`` when another owner holds it now."""
        return self.acquire(now)

    def release(self) -> bool:
        released = release_full_run_lease(self.db, self.owner)
        self.held = False
        return released

    def holder(self) -> Optional[dict[str, Any]]:
        return full_run_lease_holder(self.db)

    def refusal(self, now: Optional[datetime] = None) -> Optional[str]:
        """``None`` when this run may publish; otherwise why it must not.

        The publish gate. Renewing succeeds only while the lease is ours or nobody's,
        so a lease that expired and was taken by another run refuses here, and the
        loader quarantines instead of publishing over that run's work.
        """
        if self.renew(now):
            return None
        return (
            f"{describe_holder(self.holder())}, not by this run, so this run does not "
            "publish"
        )


@contextmanager
def hold_full_run_lease(
    engine_or_session: Engine | Session,
    *,
    purpose: str = "a campaign-money run",
    owner: Optional[str] = None,
    ttl: timedelta = FULL_RUN_LEASE_TTL,
    now: Optional[datetime] = None,
) -> Iterator[FullRunLease]:
    """``with hold_full_run_lease(engine) as held:`` — held for the block, released after.

    Yields the lease, which is truthy exactly when held (``held.held``). Given an
    engine it opens its own session for the lease statements and closes it after;
    given a session it uses that one and commits after each lease statement. Released
    at the end only by its owner: a lease that expired and was taken by another run
    stays that run's.
    """
    if isinstance(engine_or_session, Session):
        db, owns_session = engine_or_session, False
    else:
        db, owns_session = Session(engine_or_session), True
    lease = FullRunLease(
        db=db, purpose=purpose, owner=owner or new_owner_token(), ttl=ttl
    )
    try:
        lease.acquire(now)
        yield lease
    finally:
        try:
            if lease.held:
                lease.release()
        finally:
            if owns_session:
                db.close()


# The hand-run loader scripts cannot wrap their whole ``main()`` in a ``with`` block
# without re-indenting every line of it, so they enter the lease here and it is
# released when the interpreter exits, however the command ends. A crash that skips
# ``atexit`` (a kill signal) is what the 4-hour expiry is for.
_PROCESS_LEASES = ExitStack()
atexit.register(_PROCESS_LEASES.close)


def hold_full_run_lease_until_exit(
    engine_or_session: Engine | Session,
    *,
    purpose: str,
    log: Callable[[str], None] = _stderr,
) -> bool:
    """Take the run-wide lease for the rest of this process, or say who holds it.

    ``True`` when held. ``False`` prints, in plain words, which run holds the lease and
    that this command does nothing; the caller exits 1.
    """
    lease = _PROCESS_LEASES.enter_context(
        hold_full_run_lease(engine_or_session, purpose=purpose)
    )
    if lease.held:
        return True
    log(
        f"another campaign-money run is under way ({describe_holder(lease.holder())}), "
        "so this command does nothing; run it again once that one finishes. A run "
        "that died without releasing frees the lease 4 hours after it took it."
    )
    return False


# --- Remembered state ---------------------------------------------------------------


def state_get(db: Session, key: str) -> Any:
    row = db.get(schema.CampaignFinanceRefreshState, key)
    return None if row is None else row.value


def state_update(
    db: Session,
    *,
    set_values: Optional[Mapping[str, Any]] = None,
    delete_keys: Iterable[str] = (),
) -> None:
    """Write and remove several keys in one commit, so a crash leaves no half-state."""
    for key, value in (set_values or {}).items():
        row = db.get(schema.CampaignFinanceRefreshState, key)
        if row is None:
            db.add(schema.CampaignFinanceRefreshState(key=key, value=value))
        else:
            row.value = value
            row.updated_at = datetime.now(UTC)
    for key in delete_keys:
        row = db.get(schema.CampaignFinanceRefreshState, key)
        if row is not None:
            db.delete(row)
    db.commit()


def state_set(db: Session, key: str, value: Any) -> None:
    state_update(db, set_values={key: value})


def state_delete(db: Session, key: str) -> None:
    state_update(db, delete_keys=[key])


# --- What is live -------------------------------------------------------------------


@dataclass(frozen=True)
class LiveVersions:
    """Which payments release and which totals snapshot are live, read from the database.

    ``None`` throughout when nothing is live. ``payments_published_at`` and
    ``filings_fetched_at`` are what say whether one generation is newer than another:
    the pointer rows carry no publish time of their own (they are moved by a
    statement, so their ``updated_at`` does not follow).
    """

    payments_release_id: Optional[str] = None
    payments_fetched_at: Optional[datetime] = None
    payments_published_at: Optional[datetime] = None
    filings_snapshot_id: Optional[str] = None
    filings_fetched_at: Optional[datetime] = None

    def as_marker(self) -> dict[str, Optional[str]]:
        return {
            "payments_release_id": self.payments_release_id,
            "payments_published_at": _iso(self.payments_published_at),
            "filings_snapshot_id": self.filings_snapshot_id,
            "filings_fetched_at": _iso(self.filings_fetched_at),
        }


def _iso(moment: Optional[datetime]) -> Optional[str]:
    return None if moment is None else moment.isoformat()


def _from_iso(value: Any) -> Optional[datetime]:
    return datetime.fromisoformat(value) if isinstance(value, str) and value else None


def live_versions(db: Session) -> LiveVersions:
    release = live_release(db)
    snapshot = live_filings_snapshot(db)
    return LiveVersions(
        payments_release_id=str(release.id) if release is not None else None,
        payments_fetched_at=(
            release.fetch_completed_at if release is not None else None
        ),
        payments_published_at=(
            (release.published_at or release.fetch_completed_at)
            if release is not None
            else None
        ),
        filings_snapshot_id=str(snapshot.id) if snapshot is not None else None,
        filings_fetched_at=(
            snapshot.fetch_completed_at if snapshot is not None else None
        ),
    )


def recheck_still_owed(marker: Mapping[str, Any], live: LiveVersions) -> bool:
    """Whether a pending re-check recorded against ``marker``'s generation is still due.

    Due when that generation is still live, or when a newer one has since published:
    the verdicts are tied to the exact release and snapshot they judged, so whatever is
    live now is unchecked in both cases. Not due when nothing is live, or when what is
    live is *older* than the marker's generation (a rollback), because re-checking then
    would judge data the marker was never about; the marker is dropped and the run says
    so.
    """
    if live.payments_release_id is None and live.filings_snapshot_id is None:
        return False
    pairs = (
        (
            marker.get("payments_release_id"),
            _from_iso(marker.get("payments_published_at")),
            live.payments_release_id,
            live.payments_published_at,
        ),
        (
            marker.get("filings_snapshot_id"),
            _from_iso(marker.get("filings_fetched_at")),
            live.filings_snapshot_id,
            live.filings_fetched_at,
        ),
    )
    for marked_id, marked_at, live_id, live_at in pairs:
        if marked_id is None or live_id is None or marked_id == live_id:
            continue
        if marked_at is not None and live_at is not None and live_at < marked_at:
            return False
    return True


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
    be read is neither a change nor a no-change: it is named in ``unreadable_lists``,
    the run that carries this plan is reported as incomplete, and it never blocks the
    payments half of the run. The totals still refresh when they are due for another
    reason (a readable list changed, the weekly rule, a first run, or a request). A
    list read for the first time (nothing handled yet) is a change, because nothing has
    been compared against it.
    """
    plan = Plan(totals_due=False)
    for reading in readings:
        if reading.error is not None or reading.content_hash is None:
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
    recheck_attempted: bool = False
    published_totals: bool = False
    published_payments: bool = False
    live: Optional[LiveVersions] = None
    failures: list[str] = field(default_factory=list)
    lines: list[str] = field(default_factory=list)
    finished_at: Optional[datetime] = None

    @property
    def ok(self) -> bool:
        return not self.failures

    def _live_lines(self) -> list[str]:
        if self.live is None:
            return []

        def describe(
            what: str,
            identifier: Optional[str],
            fetched: Optional[datetime],
            ours: bool,
        ) -> str:
            if identifier is None:
                return f"    {what}: nothing is live"
            when = fetched.date().isoformat() if fetched is not None else "unknown date"
            return f"    {what}: {identifier}, fetched {when}, " + (
                "published by this run" if ours else "live before this run started"
            )

        return [
            "  live at the end of this run:",
            describe(
                "payments release",
                self.live.payments_release_id,
                self.live.payments_fetched_at,
                self.published_payments,
            ),
            describe(
                "totals and register snapshot",
                self.live.filings_snapshot_id,
                self.live.filings_fetched_at,
                self.published_totals,
            ),
        ]

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
            unread = (
                f"{len(self.plan.unreadable_lists)} list(s) not read, so whether the "
                "totals moved is unknown"
                if self.plan.unreadable_lists
                else ""
            )
            if self.plan.totals_due:
                line = "refresh due (" + "; ".join(self.plan.reasons) + ")"
                if unread:
                    line += f"; {unread}"
            elif unread:
                line = f"not refreshed; {unread}"
            else:
                line = "no list changed and the weekly refresh is not due"
            out.append("  totals: " + line)
        out.extend(f"  {line}" for line in self.lines)
        out.extend(self._live_lines())
        if self.failures:
            out.append(
                "  FAILED, so this run is incomplete (what is live is stated above):"
            )
            out.extend(f"    {failure}" for failure in self.failures)
        else:
            out.append("  every step finished")
        return "\n".join(out)


def refresh_campaign_money(
    db: Session,
    *,
    dry_run: bool = False,
    force_totals: bool = False,
    lease: Optional[FullRunLease] = None,
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
    read_live: Callable[[Session], LiveVersions] = live_versions,
) -> RefreshReport:
    """One refresh, start to finish. The caller holds the run-wide lease.

    ``lease`` is asked, right before each publish, whether this run still holds it;
    without one (a test, or a laptop run that chose not to take one) nothing is asked.
    Neither loader is ever handed a publish hash or any other waiver: a scheduled run
    never waives a check, and a quarantined set waits for a person.
    """
    started = now or datetime.now(UTC)
    report = RefreshReport(started_at=started, dry_run=dry_run)
    http = http or filings.http_session()

    def before_publish() -> Optional[str]:
        """The loaders' last word before a pointer moves: still our lease, or why not."""
        return None if lease is None else lease.refusal()

    # 1. Retry what did not finish last time, cheapest first, before reading anything.
    if not dry_run:
        _retry_pending_clearing(db, report, clear=clear, log=log)
        _retry_pending_recheck(
            db, report, recheck=recheck, clear=clear, log=log, read_live=read_live
        )

    # 2. Read the 6 lists and decide about the totals.
    report.readings = read_lists(http, base_url)
    handled = {action: state_get(db, f"list:{action}") for action in LIST_ACTIONS}
    last_full = state_get(db, LAST_FULL_REFRESH_KEY)
    last_full_at = datetime.fromisoformat(last_full) if last_full else None
    report.plan = plan_totals_refresh(
        report.readings, handled, last_full_at, now=started, force=force_totals
    )
    log("\n".join(report.summary().splitlines()[1:]))
    if report.plan.unreadable_lists:
        report.failures.append(
            f"incomplete: {len(report.plan.unreadable_lists)} of {len(LIST_ACTIONS)} "
            "lists could not be read ("
            + "; ".join(report.plan.unreadable_lists)
            + "), so whether the official totals moved is unknown; an unread list is "
            "not recorded as handled and tomorrow's run compares it again"
        )

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
                    db,
                    years=supported_years(today),
                    store=store,
                    log=log,
                    before_publish=before_publish,
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
                    # Handled only now, after the work succeeded (or was a no-op), and
                    # only the lists that were actually read.
                    handled_now = {
                        f"list:{reading.action}": reading.content_hash
                        for reading in report.readings
                        if reading.error is None and reading.content_hash
                    }
                    handled_now[LAST_FULL_REFRESH_KEY] = started.isoformat()
                    state_update(db, set_values=handled_now)
                    report.lines.append(
                        "totals: published a new snapshot"
                        if run.published
                        else "totals: unchanged, the published snapshot already holds these figures"
                    )
                    if run.published:
                        report.published_totals = True
                        _after_publish(
                            db,
                            report,
                            when_a_filings_release_lands(),
                            clear=clear,
                            log=log,
                            read_live=read_live,
                        )

    # 4. The 3 payment files, every day, whatever happened to the lists.
    try:
        report.payments = load_payments(
            db, dry_run=dry_run, store=store, log=log, before_publish=before_publish
        )
    except CampaignFinanceRefusal as refusal:
        report.failures.append(f"payments refresh refused: {refusal}")
    else:
        payments = report.payments
        if payments.refusal:
            report.failures.append(f"payments refresh quarantined: {payments.refusal}")
        elif payments.published:
            report.published_payments = True
            report.lines.append("payments: published a new release")
            _after_publish(
                db,
                report,
                when_a_money_download_release_lands(),
                clear=clear,
                log=log,
                read_live=read_live,
            )
        else:
            report.lines.append(
                "payments: dry run, nothing written"
                if dry_run
                else "payments: unchanged, the published release already holds these files"
            )

    # 5. The re-checks, once, for whatever published in this run. Never a second
    # attempt in the same run: a retry that failed in step 1 is reported and owed to
    # tomorrow, whatever this run then published.
    if (
        state_get(db, RECHECK_PENDING_KEY)
        and not dry_run
        and not report.recheck_attempted
    ):
        _run_rechecks(db, report, recheck=recheck, clear=clear, log=log)

    # Reading what is live is not a write, so a dry run states it too.
    report.live = read_live(db)
    report.finished_at = datetime.now(UTC)
    return report


def _clearing_marker(events: Iterable[str]) -> dict[str, Any]:
    return {"recorded_at": datetime.now(UTC).isoformat(), "events": list(events)}


def _clear_and_mark(
    db: Session, report: RefreshReport, clearing: Clearing, *, clear, log
) -> bool:
    """Clear, and keep a ``clearing_pending`` marker for as long as it has not succeeded."""
    pending = state_get(db, CLEARING_PENDING_KEY) or {}
    owed = [event for event in pending.get("events", []) if event != clearing.event]
    if clear(clearing, published=True, log=log):
        report.failures.append(
            f"clearing saved pages failed after {clearing.event}; it is retried first "
            "on the next run"
        )
        state_set(db, CLEARING_PENDING_KEY, _clearing_marker([*owed, clearing.event]))
        return False
    if owed:
        state_set(db, CLEARING_PENDING_KEY, _clearing_marker(owed))
    elif pending:
        state_delete(db, CLEARING_PENDING_KEY)
    return True


def _retry_pending_clearing(db: Session, report: RefreshReport, *, clear, log) -> None:
    pending = state_get(db, CLEARING_PENDING_KEY)
    if not pending:
        return
    events = list(pending.get("events") or [])
    log(
        f"retrying the saved-page clearing left unfinished on {pending.get('recorded_at')}: "
        + ", ".join(events)
    )
    unknown = [event for event in events if event not in CLEARINGS_BY_EVENT]
    if unknown:
        report.failures.append(
            "a clearing_pending marker names an event this code does not know: "
            + ", ".join(unknown)
            + "; a person removes or corrects the marker"
        )
    for event in events:
        if event in CLEARINGS_BY_EVENT:
            if _clear_and_mark(
                db, report, CLEARINGS_BY_EVENT[event](), clear=clear, log=log
            ):
                report.lines.append(f"cleared the saved pages owed after {event}")


def _retry_pending_recheck(
    db: Session, report: RefreshReport, *, recheck, clear, log, read_live
) -> None:
    pending = state_get(db, RECHECK_PENDING_KEY)
    if not pending:
        return
    live = read_live(db)
    if not recheck_still_owed(pending, live):
        state_delete(db, RECHECK_PENDING_KEY)
        report.lines.append(
            "re-check marker dropped: the data it was owed for is no longer live and "
            "nothing newer replaced it (recorded "
            f"{pending.get('recorded_at')}, payments release "
            f"{pending.get('payments_release_id')}, totals snapshot "
            f"{pending.get('filings_snapshot_id')})"
        )
        return
    log(f"retrying the money re-checks left unfinished on {pending.get('recorded_at')}")
    _run_rechecks(db, report, recheck=recheck, clear=clear, log=log)


def _after_publish(
    db: Session, report: RefreshReport, clearing: Clearing, *, clear, log, read_live
) -> None:
    _clear_and_mark(db, report, clearing, clear=clear, log=log)
    live = read_live(db)
    state_set(
        db,
        RECHECK_PENDING_KEY,
        {
            "recorded_at": datetime.now(UTC).isoformat(),
            "after": clearing.event,
            **live.as_marker(),
        },
    )


def _run_rechecks(db: Session, report: RefreshReport, *, recheck, clear, log) -> None:
    report.recheck_attempted = True
    outcome = recheck(db, log=log)
    report.recheck = outcome
    log(outcome.summary())
    if outcome.failed:
        report.failures.append(
            "a money re-check did not finish; it is retried on the next run: "
            + "; ".join(one.error or "" for one in outcome.outcomes if not one.ran)
        )
        return
    # The re-check marker goes and the clearing marker arrives in one commit, so no
    # moment exists where neither says a step is owed.
    final = when_the_money_checks_finish()
    pending = state_get(db, CLEARING_PENDING_KEY) or {}
    owed = [event for event in pending.get("events", []) if event != final.event]
    state_update(
        db,
        set_values={CLEARING_PENDING_KEY: _clearing_marker([*owed, final.event])},
        delete_keys=[RECHECK_PENDING_KEY],
    )
    report.lines.append("re-checks: both finished and their verdicts are live")
    _clear_and_mark(db, report, final, clear=clear, log=log)


# --- Telling a person -----------------------------------------------------------------


def github_run_url(env: Optional[Mapping[str, str]] = None) -> Optional[str]:
    """This run's address on GitHub Actions, from the variables Actions sets; else ``None``."""
    values = os.environ if env is None else env
    server = values.get("GITHUB_SERVER_URL")
    repository = values.get("GITHUB_REPOSITORY")
    run_id = values.get("GITHUB_RUN_ID")
    if server and repository and run_id:
        return f"{server}/{repository}/actions/runs/{run_id}"
    return None


def file_refresh_alert(
    summary_text: str,
    run_url: Optional[str],
    *,
    dry_run: bool = False,
    runner: Callable[..., subprocess.CompletedProcess] = subprocess.run,
    log: Callable[[str], None] = _stderr,
) -> Optional[str]:
    """Open or update the one issue that says the refresh did not finish.

    Searches for an open issue by title and comments on it, else creates it, the same
    idiom ``_file_committee_link_alert`` in ``scripts/load_campaign_finance.py`` uses,
    so a refresh that keeps failing is 1 issue growing a thread rather than a new issue
    a day. The body quotes the run's own summary and asserts nothing itself: the
    summary is what says which versions are live and whether this run published them.

    **Never on a dry run**, because filing an issue is a write, and a dry run makes none.
    Never raises: the summary was already printed, and this is the second channel.
    Returns one line saying what it did, or ``None`` when it did nothing.
    """
    if dry_run:
        log("dry run: no GitHub issue is filed, because filing one is a write")
        return None
    where = run_url or "(not run under GitHub Actions, so there is no run address)"
    try:
        existing = runner(
            [
                "gh",
                "issue",
                "list",
                "--state",
                "open",
                "--search",
                f"{REFRESH_ALERT_TITLE} in:title",
                "--json",
                "number",
                "--jq",
                ".[0].number // empty",
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if existing.returncode != 0:
            log(
                "note: could not check for an existing alert issue "
                f"(gh issue list exited {existing.returncode}): {existing.stderr.strip()}"
            )
            return None
        number = existing.stdout.strip()
        if number:
            commented = runner(
                [
                    "gh",
                    "issue",
                    "comment",
                    number,
                    "--body",
                    f"Still not finishing as of this run: {where}\n\n"
                    f"```\n{summary_text}\n```",
                ],
                capture_output=True,
                text=True,
                timeout=30,
            )
            if commented.returncode != 0:
                log(
                    f"note: could not comment on alert issue #{number} "
                    f"(gh issue comment exited {commented.returncode}): "
                    f"{commented.stderr.strip()}"
                )
                return None
            done = f"commented on existing alert issue #{number}"
            log(f"note: {done}")
            return done
        body = (
            "Net: today's refresh of Alethical's campaign-money records from "
            "Minnesota's Campaign Finance Board stopped before every step finished. "
            "The run's own summary below says which payments release and which totals "
            "snapshot are live now and whether this run published them, and names the "
            "step that did not land; a person decides whether that is a bad download, "
            "a known source disagreement, or a real change to publish under a named "
            "exception (see issue 2344, D2).\n\n"
            f"```\n{summary_text}\n```\n\n"
            f"Run: {where}. Auto-filed by `scripts/refresh_campaign_finance.py "
            "--alert-issue`; the next scheduled run retries on its own."
        )
        created = runner(
            [
                "gh",
                "issue",
                "create",
                "--title",
                f"🚨 {REFRESH_ALERT_TITLE}",
                "--label",
                "backend",
                "--body",
                body,
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if created.returncode != 0:
            log(
                "note: could not file a new alert issue "
                f"(gh issue create exited {created.returncode}): {created.stderr.strip()}"
            )
            return None
        done = f"filed a new alert issue: {created.stdout.strip()}"
        log(f"note: {done}")
        return done
    except (subprocess.SubprocessError, OSError) as error:
        log(f"note: could not file/update the alert issue: {error}")
        return None
