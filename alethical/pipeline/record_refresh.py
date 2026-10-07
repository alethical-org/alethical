"""Durable deadlines for public-record work, independent of a particular timer.

The runner stores success only after the command finishes. A failed collection
does not advance its source date. Commands are a code-owned allowlist, never text
received from a request or a database row. Existing source publication checks
remain responsible for accepting records.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import uuid

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from alethical.db.models import SourceRefreshState, SourceRefreshAttempt
from alethical.pipeline.legislative_calendar import session_refresh_interval
from alethical.pipeline.sessions import SESSION_DEFINITIONS

ROOT = Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class RefreshJob:
    name: str
    interval: timedelta
    timeout: timedelta
    arguments: tuple[str, ...]
    source: str
    purpose: str
    capture_json: bool = False
    review_exit: int | None = None
    lane: str | None = None


def jobs(now: datetime | None = None) -> dict[str, RefreshJob]:
    """Return supported source jobs; cadence is not inferred from recent activity."""
    now = now or datetime.now(UTC)
    definitions = [
        RefreshJob(
            "lobbying",
            timedelta(days=1),
            timedelta(minutes=30),
            ("scripts/refresh_lobbying_records.py", "--target", "{target}"),
            "https://cfb.mn.gov/reports-and-data/self-help/data-downloads/lobbying/",
            "Publish the checked active-list and spending pair",
            lane="lobbying",
        ),
        RefreshJob(
            "campaign-money",
            timedelta(days=1),
            timedelta(hours=5),
            ("scripts/refresh_campaign_finance.py", "--target", "{target}"),
            "https://cfb.mn.gov/",
            "Refresh supported totals and payment files",
            lane="campaign",
        ),
        RefreshJob(
            "filing-dates",
            timedelta(days=1),
            timedelta(hours=2),
            (
                "scripts/backfill_campaign_finance_filed_dates.py",
                "--target",
                "{target}",
                "--year-from",
                "2022",
            ),
            "https://cfb.mn.gov/",
            "Copy filing dates from official report evidence",
            lane="campaign",
        ),
        RefreshJob(
            "refunds",
            timedelta(days=30),
            timedelta(hours=1),
            ("scripts/load_refund_summaries.py", "--target", "{target}"),
            "https://cfb.mn.gov/",
            "Recheck refund source bytes and approved account links",
            lane="campaign",
        ),
        RefreshJob(
            "notice-amendments",
            timedelta(days=7),
            timedelta(hours=2),
            (
                "scripts/collect_campaign_finance_notices.py",
                "--target",
                "{target}",
                "--refresh-existing",
            ),
            "https://cfb.mn.gov/",
            "Recheck retained notice PDFs for corrections",
            lane="campaign",
        ),
        RefreshJob(
            "statement-amendments",
            timedelta(days=7),
            timedelta(hours=3),
            (
                "scripts/collect_campaign_finance_statements.py",
                "--target",
                "{target}",
                "--kinds",
                "all",
                "--refresh-existing",
            ),
            "https://cfb.mn.gov/",
            "Refresh statement catalogues and corrected PDFs",
            lane="campaign",
        ),
    ]
    definitions.append(
        RefreshJob(
            "donor-proof-preparation",
            timedelta(days=1),
            timedelta(hours=3),
            ("scripts/prepare_lobbyist_donor_evidence.py", "--target", "{target}"),
            "https://cfb.mn.gov/",
            "Retain exact-generation donor evidence privately for review",
            lane="campaign",
            capture_json=True,
        )
    )
    definitions.append(
        RefreshJob(
            "notices",
            timedelta(days=1),
            timedelta(hours=2),
            ("scripts/collect_campaign_finance_notices.py", "--target", "{target}"),
            "https://cfb.mn.gov/",
            "Collect newly posted notices without a hardcoded election year",
            lane="campaign",
        )
    )
    by_slug = {}
    for code, definition in sorted(SESSION_DEFINITIONS.items()):
        if definition.start_date <= now:
            by_slug[definition.slug] = (code, definition)
    for code, definition in by_slug.values():
        definitions.append(
            RefreshJob(
                f"bills-{code}",
                session_refresh_interval(code, now.date()),
                timedelta(minutes=45),
                (
                    "scripts/run_scheduled_bill_refresh.py",
                    "--target",
                    "{target}",
                    "--session-code",
                    code,
                ),
                "https://www.revisor.mn.gov/bills/",
                "Finish the whole official bill inventory and its vote follow-ups",
                lane="legislative",
            )
        )
    current_code, _ = max(
        (
            (code, definition)
            for code, definition in by_slug.values()
            if definition.session_type == "regular"
        ),
        key=lambda item: (
            item[1].session_number,
            item[1].year_start,
            int(item[0][-4:]),
        ),
    )
    definitions.extend(
        [
            RefreshJob(
                "roster",
                timedelta(days=1),
                timedelta(hours=2),
                (
                    "scripts/refresh_legislative_records.py",
                    "--kind",
                    "roster",
                    "--target",
                    "{target}",
                    "--session-code",
                    current_code,
                ),
                "https://www.leg.mn.gov/",
                "Refresh members, contacts, service and committee membership",
                lane="legislative",
            ),
            RefreshJob(
                "votes",
                timedelta(days=1),
                timedelta(hours=2),
                (
                    "scripts/refresh_legislative_records.py",
                    "--kind",
                    "votes",
                    "--target",
                    "{target}",
                    "--session-code",
                    current_code,
                ),
                "https://www.leg.mn.gov/",
                "Collect missing rolls and rotate through saved rolls for corrections",
                lane="legislative",
            ),
            RefreshJob(
                "sessions",
                timedelta(days=1),
                timedelta(minutes=10),
                ("scripts/check_legislative_sessions.py", "--target", "{target}"),
                "https://www.revisor.mn.gov/bills/status_search.php",
                "Detect unmapped official sessions before rollover",
                review_exit=2,
            ),
        ]
    )
    for name, interval in (("maps", 7), ("candidates", 1), ("zip", 7)):
        definitions.append(
            RefreshJob(
                name,
                timedelta(days=interval),
                timedelta(minutes=10),
                ("scripts/check_supporting_sources.py", "--source", name),
                {
                    "maps": "https://gis.lcc.mn.gov/html/download.html",
                    "candidates": "https://myballotmn.sos.mn.gov/",
                    "zip": "https://www.huduser.gov/portal/datasets/usps_crosswalk.html",
                }[name],
                "Detect official changes for review without replacing approved data",
                review_exit=2,
            )
        )
    return {job.name: job for job in definitions}


def _next_due_at(row: SourceRefreshState, job: RefreshJob) -> datetime:
    """A shorter source cadence advances completed work, never a retry or lease.

    Completion schedules from its pass start, matching finish_job. A stored
    weekly deadline must not suppress the first active-session 4-hour check.
    Deferred, failed and continuing runs keep their own saved resume deadline.
    """
    if (
        row.last_status in {"succeeded", "review_required"}
        and row.failures == 0
        and row.last_started_at is not None
    ):
        return min(row.next_due_at, row.last_started_at + job.interval)
    return row.next_due_at


def due_names(db: Session, *, now: datetime | None = None) -> list[str]:
    now = now or datetime.now(UTC)
    states = {row.name: row for row in db.scalars(select(SourceRefreshState))}
    definitions = jobs(now)
    ready = []
    for name, job in definitions.items():
        row = states.get(name)
        lane = states.get(f"lane:{job.lane}") if job.lane else None
        if row and (
            _next_due_at(row, job) > now
            or (row.lease_expires_at and row.lease_expires_at > now)
        ):
            continue
        if lane and lane.lease_expires_at and lane.lease_expires_at > now:
            continue
        ready.append(name)
    ready.sort(
        key=lambda name: (
            _next_due_at(states[name], definitions[name])
            if name in states
            else datetime.min.replace(tzinfo=UTC),
            name,
        )
    )
    # Start the oldest work in a shared source lane first. Other due work remains
    # durable, and the next independent wake will dispatch it after this finishes.
    used_lanes = set()
    selected = []
    for name in ready:
        lane = definitions[name].lane
        if lane and lane in used_lanes:
            continue
        if lane:
            used_lanes.add(lane)
        selected.append(name)
    return selected


@dataclass(frozen=True)
class Claim:
    job: RefreshJob
    token: uuid.UUID
    started_at: datetime


def claim_job(
    db: Session, job: RefreshJob, *, now: datetime | None = None, force: bool = False
) -> Claim | None:
    now = now or datetime.now(UTC)
    db.execute(
        insert(SourceRefreshState)
        .values(name=job.name, next_due_at=now, failures=0)
        .on_conflict_do_nothing(index_elements=["name"])
    )
    lane = None
    if job.lane:
        lane_name = f"lane:{job.lane}"
        db.execute(
            insert(SourceRefreshState)
            .values(name=lane_name, next_due_at=now, failures=0)
            .on_conflict_do_nothing(index_elements=["name"])
        )
        lane = db.scalar(
            select(SourceRefreshState)
            .where(SourceRefreshState.name == lane_name)
            .with_for_update()
        )
        if lane.lease_expires_at and lane.lease_expires_at > now:
            db.commit()
            return None
    row = db.scalar(
        select(SourceRefreshState)
        .where(SourceRefreshState.name == job.name)
        .with_for_update()
    )
    assert row is not None
    if row.lease_expires_at and row.lease_expires_at > now:
        db.commit()
        return None
    if not force and _next_due_at(row, job) > now:
        db.commit()
        return None
    if row.token:
        old = db.get(SourceRefreshAttempt, row.token)
        if old and old.finished_at is None:
            old.finished_at = now
            old.status = "interrupted"
    token = uuid.uuid4()
    row.token = token
    row.last_started_at = now
    # A platform kills the command before this lease can be stolen. There is
    # margin for process-group cleanup and the final database write.
    row.lease_expires_at = now + job.timeout + timedelta(minutes=15)
    if lane is not None:
        lane.token = token
        lane.lease_expires_at = row.lease_expires_at
    db.add(
        SourceRefreshAttempt(id=token, name=job.name, started_at=now, status="running")
    )
    db.commit()
    return Claim(job, token, now)


def finish_job(
    db: Session,
    claim: Claim,
    *,
    code: int,
    now: datetime | None = None,
    finding: dict | None = None,
) -> bool:
    now = now or datetime.now(UTC)
    lane = None
    if claim.job.lane:
        lane = db.scalar(
            select(SourceRefreshState)
            .where(SourceRefreshState.name == f"lane:{claim.job.lane}")
            .with_for_update()
        )
    row = db.scalar(
        select(SourceRefreshState)
        .where(SourceRefreshState.name == claim.job.name)
        .with_for_update()
    )
    if row is None or row.token != claim.token:
        db.rollback()
        return False
    attempt = db.get(SourceRefreshAttempt, claim.token)
    assert attempt is not None
    attempt.finished_at = now
    attempt.exit_code = code
    review_required = code == claim.job.review_exit
    attempt.status = (
        "succeeded"
        if code == 0
        else "review_required"
        if review_required
        else "deferred"
        if code == 76
        else "continuing"
        if code == 75
        else "failed"
    )
    attempt.finding = finding
    if finding is not None:
        row.finding = finding
    if lane and lane.token == claim.token:
        lane.token = None
        lane.lease_expires_at = None
    row.last_finished_at = now
    row.last_status = attempt.status
    row.token = None
    row.lease_expires_at = None
    if code == 75:
        row.next_due_at = now
    elif code == 76:
        row.next_due_at = now + timedelta(minutes=15)
    elif code == 0 or review_required:
        row.last_checked_at = now
        if code == 0:
            row.last_succeeded_at = now
        row.failures = 0
        row.next_due_at = max(now, claim.started_at + claim.job.interval)
    else:
        row.failures += 1
        row.next_due_at = now + timedelta(
            minutes=min(360, 15 * 2 ** min(row.failures - 1, 5))
        )
    db.commit()
    return True


@dataclass(frozen=True)
class CommandResult:
    code: int
    finding: dict | None = None


def _stop_process(process) -> None:
    if process.poll() is not None:
        return
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait()


def run_command(claim: Claim, *, target: str) -> CommandResult:
    """Stop our entire owned process group on timeout or runner shutdown."""
    env = dict(
        os.environ,
        ALETHICAL_DATABASE_TARGET=target,
        PYTHONPATH=str(ROOT),
        ALETHICAL_REFRESH_JOB_NAME=claim.job.name,
        ALETHICAL_REFRESH_JOB_TOKEN=str(claim.token),
    )
    env.update(
        ALETHICAL_AUTO_BILL_SUMMARY_ENABLED="false", ALETHICAL_EMAIL_ENABLED="false"
    )
    command = [
        sys.executable,
        *(arg.format(target=target) for arg in claim.job.arguments),
    ]
    # Only code-owned review commands emit a retained JSON report. Never retain
    # arbitrary collector logs, source bodies, environment values or credentials.
    with tempfile.TemporaryFile() as report:
        process = subprocess.Popen(
            command,
            cwd=ROOT,
            env=env,
            start_new_session=True,
            stdout=report
            if (claim.job.review_exit or claim.job.capture_json)
            else None,
        )
        previous = signal.getsignal(signal.SIGTERM)

        def shutdown(signum, frame):
            raise KeyboardInterrupt

        signal.signal(signal.SIGTERM, shutdown)
        try:
            code = process.wait(timeout=claim.job.timeout.total_seconds())
        except subprocess.TimeoutExpired:
            code = 124
        finally:
            _stop_process(process)
            signal.signal(signal.SIGTERM, previous)
        finding = None
        if (claim.job.review_exit or claim.job.capture_json) and code in (
            0,
            claim.job.review_exit,
        ):
            report.seek(0)
            body = report.read(131073)
            try:
                finding = json.loads(body) if len(body) <= 131072 else None
                if not isinstance(finding, dict):
                    raise ValueError("Missing structured source finding")
            except (ValueError, UnicodeDecodeError):
                return CommandResult(1)
        return CommandResult(code, finding)


def health(db: Session, *, now: datetime | None = None) -> list[dict]:
    now = now or datetime.now(UTC)
    rows = {row.name: row for row in db.scalars(select(SourceRefreshState))}
    result = []
    for name, job in jobs(now).items():
        row = rows.get(name)
        running = bool(row and row.lease_expires_at and row.lease_expires_at > now)
        last_success = row.last_succeeded_at if row else None
        # A started attempt is not proof of complete source coverage.
        completed = row.last_checked_at if row else None
        overdue = completed is None or now > completed + job.interval + job.timeout
        result.append(
            dict(
                name=name,
                source=job.source,
                purpose=job.purpose,
                status="never_completed" if row is None else row.last_status,
                last_succeeded_at=last_success,
                last_checked_at=completed,
                finding=row.finding if row else None,
                last_started_at=row.last_started_at if row else None,
                next_due_at=row.next_due_at if row else None,
                running=running,
                overdue=overdue,
                failures=row.failures if row else 0,
            )
        )
    return result


def run_due(
    session_factory,
    *,
    target: str,
    names: list[str] | None = None,
    force: bool = False,
    execute=run_command,
    max_seconds: float = 18900,
) -> int:
    available = jobs()
    selected = names if names is not None else list(available)
    unknown = set(selected) - available.keys()
    if unknown:
        raise ValueError(f"Unknown refresh jobs: {', '.join(sorted(unknown))}")
    failed = False
    deadline = time.monotonic() + max_seconds
    queue = list(selected)
    while queue and time.monotonic() < deadline:
        name = queue.pop(0)
        if deadline - time.monotonic() < available[name].timeout.total_seconds():
            continue
        with session_factory() as db:
            claim = claim_job(db, available[name], force=force)
        if claim is None:
            continue
        print(
            json.dumps({"job": name, "run": str(claim.token), "status": "started"}),
            flush=True,
        )
        stopping = False
        try:
            outcome = execute(claim, target=target)
            if isinstance(outcome, int):
                outcome = CommandResult(outcome)
        except KeyboardInterrupt:
            outcome = CommandResult(124)
            stopping = True
        except Exception:
            outcome = CommandResult(1)
        with session_factory() as db:
            recorded = finish_job(db, claim, code=outcome.code, finding=outcome.finding)
        failed |= outcome.code not in (0, 75, 76, claim.job.review_exit) or not recorded
        if outcome.code == 75 and recorded:
            queue.append(name)
        print(
            json.dumps(
                {
                    "job": name,
                    "run": str(claim.token),
                    "exit_code": outcome.code,
                    "recorded": recorded,
                }
            ),
            flush=True,
        )
        if stopping:
            return 130
    return int(failed)
