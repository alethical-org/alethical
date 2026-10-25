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

from sqlalchemy import select, func, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from alethical.db.models import (
    SourceRefreshState,
    SourceRefreshAttempt,
    CampaignFinanceFilingCurrentSnapshot,
)
from alethical.pipeline.legislative_calendar import session_refresh_interval
from alethical.pipeline.sessions import SESSION_DEFINITIONS
from alethical.pipeline.source_record_clearing import MARKERS, drain_source_clearing

ROOT = Path(__file__).resolve().parents[2]
#: Runs only while a committed source change still owes saved-page clearing.
CLEARING_JOB = "source-clearing"
#: Runs only while a money check it can perform, or money page clearing, is owed.
CHECK_JOB = "campaign-rechecks"


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
    priority: int = 0


def jobs(now: datetime | None = None) -> dict[str, RefreshJob]:
    """Return supported source jobs; cadence is not inferred from recent activity."""
    now = now or datetime.now(UTC)
    definitions = [
        RefreshJob(
            "lobbying",
            timedelta(hours=1),
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
            (
                "scripts/refresh_campaign_finance.py",
                "--target",
                "{target}",
                "--collect-only",
            ),
            "https://cfb.mn.gov/",
            "Refresh supported totals and payment files",
            lane="campaign",
            priority=7,
        ),
        RefreshJob(
            "filing-dates",
            timedelta(days=1),
            timedelta(minutes=10),
            (
                "scripts/backfill_campaign_finance_filed_dates.py",
                "--target",
                "{target}",
                "--year-from",
                "2022",
                "--json",
                "--batch-size",
                "25",
                "--max-seconds",
                "120",
            ),
            "https://cfb.mn.gov/",
            "Copy filing dates from official report evidence",
            lane="filing-dates",
            review_exit=2,
        ),
        RefreshJob(
            "refunds",
            timedelta(days=30),
            timedelta(hours=1),
            ("scripts/load_refund_summaries.py", "--target", "{target}"),
            "https://cfb.mn.gov/",
            "Recheck refund source bytes and approved account links",
            lane="refunds",
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
                "--json",
            ),
            "https://cfb.mn.gov/",
            "Recheck retained notice PDFs for corrections",
            lane="notice-discovery",
            review_exit=2,
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
            lane="statements",
        ),
    ]
    definitions.append(
        RefreshJob(
            "filing-dates-recent",
            timedelta(hours=1),
            timedelta(minutes=10),
            (
                "scripts/backfill_campaign_finance_filed_dates.py",
                "--target",
                "{target}",
                "--year-from",
                str(now.year - 1),
                "--json",
                "--batch-size",
                "25",
                "--max-seconds",
                "120",
            ),
            "https://cfb.mn.gov/",
            "Refresh dates on current/recent filed reports before older history",
            lane="filing-dates",
            review_exit=2,
            priority=5,
        )
    )
    for source, interval in (
        ("roster", timedelta(minutes=15)),
        ("maps", timedelta(hours=1)),
        ("lobbying", timedelta(minutes=15)),
    ):
        definitions.append(
            RefreshJob(
                f"{source}-discovery",
                interval,
                timedelta(minutes=3),
                (
                    "scripts/discover_reference_records.py",
                    "--target",
                    "{target}",
                    "--source",
                    source,
                ),
                {
                    "roster": "https://www.house.mn.gov/hinfo/leginfo/memroster.pdf",
                    "maps": "https://gis.lcc.mn.gov/html/download.html",
                    "lobbying": "https://cfb.mn.gov/reports-and-data/self-help/data-downloads/lobbying/",
                }[source],
                "Detect official release signals without replacing checked records",
                capture_json=True,
                lane=f"{source}-discovery",
                priority=4,
            )
        )
    definitions.append(
        RefreshJob(
            CHECK_JOB,
            timedelta(minutes=5),
            timedelta(minutes=5),
            (
                "scripts/refresh_campaign_finance.py",
                "--target",
                "{target}",
                "--recheck-limit",
                "10",
                "--recheck-seconds",
                "120",
                "--recheck-requests",
                "10",
            ),
            "https://cfb.mn.gov/",
            "Finish at most 10 exact committee-year checks with saved progress",
            lane="campaign",
        )
    )
    definitions.append(
        RefreshJob(
            "donor-proof-preparation",
            timedelta(days=1),
            timedelta(hours=3),
            ("scripts/prepare_lobbyist_donor_evidence.py", "--target", "{target}"),
            "https://cfb.mn.gov/",
            "Retain exact-generation donor evidence privately for review",
            lane="donor-preparation",
            capture_json=True,
            review_exit=2,
        )
    )
    definitions.append(
        RefreshJob(
            "notices",
            timedelta(minutes=15)
            if now.month in (7, 8, 10, 11)
            else timedelta(hours=1),
            timedelta(hours=2),
            (
                "scripts/collect_campaign_finance_notices.py",
                "--target",
                "{target}",
                "--json",
            ),
            "https://cfb.mn.gov/",
            "Collect newly posted notices without a hardcoded election year",
            lane="notice-discovery",
            priority=8,
            review_exit=2,
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
    definitions.append(
        RefreshJob(
            f"bills-discovery-{current_code}",
            timedelta(minutes=5)
            if session_refresh_interval(current_code, now.date()) <= timedelta(hours=4)
            else timedelta(minutes=15),
            timedelta(minutes=30),
            (
                "scripts/discover_legislative_records.py",
                "--target",
                "{target}",
                "--session-code",
                current_code,
            ),
            "https://www.revisor.mn.gov/bills/",
            "Refresh dated actions from both chambers in a finite recent window, up to 25 bills per turn",
            lane="legislative",
            priority=5,
        )
    )
    definitions.append(
        RefreshJob(
            f"bills-backdated-discovery-{current_code}",
            timedelta(days=1),
            timedelta(minutes=30),
            (
                "scripts/discover_legislative_records.py",
                "--target",
                "{target}",
                "--session-code",
                current_code,
                "--lookback-days",
                "14",
            ),
            "https://www.revisor.mn.gov/bills/status_search.php",
            "Reconcile a finite 14-day dated-action window for delayed publication",
            lane="legislative",
            priority=1,
        )
    )
    definitions.extend(
        [
            RefreshJob(
                "roster",
                timedelta(hours=4),
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
                min(
                    session_refresh_interval(current_code, now.date()),
                    timedelta(hours=1),
                ),
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
                # Its code-owned summary is kept on failure too, so a failed turn
                # says which counts failed.
                capture_json=True,
                lane="legislative",
                priority=6,
                review_exit=2,
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
    for name, interval in (
        ("maps", timedelta(days=1)),
        ("candidates", timedelta(hours=1)),
        ("zip", timedelta(days=1)),
    ):
        definitions.append(
            RefreshJob(
                name,
                interval,
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
    definitions.extend(
        [
            RefreshJob(
                "campaign-discovery",
                timedelta(minutes=15),
                timedelta(minutes=5),
                ("scripts/discover_campaign_records.py", "--target", "{target}"),
                "https://cfb.mn.gov/",
                "Detect changes to the 6 official register/report lists",
                capture_json=True,
                lane="campaign-discovery",
                priority=7,
            ),
            RefreshJob(
                "fcc",
                timedelta(hours=1),
                timedelta(minutes=90),
                ("scripts/refresh_fcc_records.py", "--target", "{target}"),
                "https://publicfiles.fcc.gov/",
                "Retain KSTP/KARE/KMSP files and resume bounded archive work",
                capture_json=True,
                review_exit=2,
                lane="fcc",
            ),
        ]
    )
    definitions.append(
        RefreshJob(
            CLEARING_JOB,
            timedelta(minutes=5),
            timedelta(minutes=5),
            ("scripts/clear_source_record_pages.py", "--target", "{target}"),
            "https://www.alethical.com/",
            "Clear saved public pages owed by committed source changes",
            capture_json=True,
            lane="source-clearing",
            priority=9,
        )
    )
    return {job.name: job for job in definitions}


FAMILIES = {"campaign", "notices", "legislative", "lobbying", "supporting", "fcc"}


def job_family(name: str) -> str:
    if name in {"notices", "notice-amendments", "statement-amendments"}:
        return "notices"
    if name.startswith("bills-") or name in {
        "votes",
        "roster",
        "roster-discovery",
        "sessions",
    }:
        return "legislative"
    if name in {
        "campaign-money",
        "campaign-rechecks",
        "campaign-discovery",
        "filing-dates",
        "filing-dates-recent",
        "refunds",
        "donor-proof-preparation",
    }:
        return "campaign"
    if name == "lobbying-discovery":
        return "lobbying"
    if name in {"fcc", "lobbying"}:
        return name
    return "supporting"


def enabled_families() -> set[str]:
    value = json.loads(os.getenv("ALETHICAL_SOURCE_REFRESH_FAMILIES", "[]"))
    if not isinstance(value, list) or any(
        not isinstance(v, str) or v not in FAMILIES for v in value
    ):
        raise ValueError(
            "Source refresh families must be a JSON list of supported names"
        )
    return set(value)


def enabled_job(name: str) -> bool:
    if name == CLEARING_JOB:
        return bool(enabled_families())
    return job_family(name) in enabled_families()


def _money_checks_owed(db: Session) -> bool:
    from alethical.pipeline.campaign_finance_recheck_batches import work_owed

    return work_owed(db)


def _clearing_owed(db: Session) -> bool:
    return (
        db.scalar(
            select(SourceRefreshState.name)
            .where(SourceRefreshState.name.in_(MARKERS))
            .limit(1)
        )
        is not None
    )


def load_progress(engine, name: str, token: str) -> dict:
    with engine.connect() as connection:
        value = connection.execute(
            text("""
            SELECT progress FROM source_refresh_state
            WHERE name=:name AND token=CAST(:token AS uuid)
              AND lease_expires_at > clock_timestamp()
        """),
            {"name": name, "token": token},
        ).scalar_one_or_none()
    if value is None:
        raise RuntimeError("The source refresh no longer owns its unexpired job lease")
    return dict(value)


def save_progress(engine, name: str, token: str, progress: dict) -> None:
    with engine.begin() as connection:
        changed = connection.execute(
            text("""
            UPDATE source_refresh_state SET progress=CAST(:progress AS jsonb)
            WHERE name=:name AND token=CAST(:token AS uuid)
              AND lease_expires_at > clock_timestamp()
            RETURNING name
        """),
            {"name": name, "token": token, "progress": json.dumps(progress)},
        ).scalar_one_or_none()
        if changed is None:
            raise RuntimeError(
                "The source refresh lost its lease before saving progress"
            )


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
    definitions = jobs(now)
    active = [name for name in definitions if enabled_job(name)]
    if active:
        db.execute(
            insert(SourceRefreshState)
            .values(
                [{"name": name, "next_due_at": now, "failures": 0} for name in active]
            )
            .on_conflict_do_nothing(index_elements=["name"])
        )
        db.commit()
    if "filing-dates" in active:
        snapshot_id = db.scalar(
            select(CampaignFinanceFilingCurrentSnapshot.snapshot_id)
        )
        if snapshot_id is not None:
            identity = str(snapshot_id)
            for name in ("filing-dates", "filing-dates-recent"):
                if name not in active:
                    continue
                observed = db.get(SourceRefreshState, name)
                signal_row = db.get(SourceRefreshState, f"signal:{name}")
                if (observed.finding or {}).get("filings_snapshot_id") == identity:
                    continue
                if (
                    signal_row
                    and (signal_row.progress or {}).get("filings_snapshot_id")
                    == identity
                ):
                    continue
                request_refresh(
                    db, name, now=now, progress={"filings_snapshot_id": identity}
                )
            db.commit()
    states = {row.name: row for row in db.scalars(select(SourceRefreshState))}
    owed = any(name in states for name in MARKERS)
    idle = set() if owed else {CLEARING_JOB}
    if CHECK_JOB in active and not _money_checks_owed(db):
        idle.add(CHECK_JOB)
    ready = []
    for name, job in definitions.items():
        if not enabled_job(name) or name in idle:
            continue
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

    def urgency(name):
        job = definitions[name]
        row = states.get(name)
        due = _next_due_at(row, job) if row else now
        # Lateness grows without a cap, so old reconciliation eventually outranks
        # fresh discovery. Equal-age jobs retain their durable oldest-first order.
        age = max(0, (now - due).total_seconds()) / 3600
        return (-(age + job.priority), due, name)

    ready.sort(key=urgency)
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


def request_refresh(
    db: Session, name: str, *, now: datetime, progress: dict | None = None
) -> None:
    """Durable source change signal, separate from an in-flight collector's progress."""
    db.execute(
        insert(SourceRefreshState)
        .values(name=name, next_due_at=now, failures=0)
        .on_conflict_do_update(
            index_elements=["name"],
            set_={"next_due_at": func.least(SourceRefreshState.next_due_at, now)},
        )
    )
    values = dict(
        name=f"signal:{name}", next_due_at=now, last_started_at=now, failures=0
    )
    updates = {"last_started_at": now}
    if progress is not None:
        values["progress"] = progress
        updates["progress"] = progress
    db.execute(
        insert(SourceRefreshState)
        .values(**values)
        .on_conflict_do_update(index_elements=["name"], set_=updates)
    )
    # Caller commits this signal together with its observed source fingerprint.


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
    if (
        row is None
        or row.token != claim.token
        or row.lease_expires_at is None
        or row.lease_expires_at <= now
    ):
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
    if finding is not None or code == 0:
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
        row.next_due_at = now + min(claim.job.interval, timedelta(minutes=15))
    elif code == 0 or review_required:
        row.last_checked_at = now
        if code == 0:
            row.last_succeeded_at = now
        row.failures = 0
        row.next_due_at = max(now, claim.started_at + claim.job.interval)
    else:
        row.failures += 1
        row.next_due_at = now + timedelta(
            minutes=min(
                360,
                max(1, claim.job.interval.total_seconds() / 60),
                15 * 2 ** min(row.failures - 1, 5),
            )
        )
    signal_row = db.scalar(
        select(SourceRefreshState)
        .where(SourceRefreshState.name == f"signal:{claim.job.name}")
        .with_for_update()
    )
    if signal_row is not None:
        if (
            code in (0, claim.job.review_exit)
            and signal_row.last_started_at <= claim.started_at
        ):
            db.delete(signal_row)
        elif code in (0, claim.job.review_exit):
            row.next_due_at = now
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
    if (
        target == "production"
        and claim.job.name.startswith("bills-")
        and (
            os.getenv("ALETHICAL_BILL_EMBEDDINGS_APPROVED") != "true"
            or not os.getenv("OPENAI_API_KEY")
        )
    ):
        return CommandResult(
            76,
            {"status": "held", "reason": "approved existing embedding path required"},
        )
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
        if (claim.job.review_exit or claim.job.capture_json) and (
            code in (0, 75, claim.job.review_exit) or claim.job.capture_json
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
        enabled = enabled_job(name)
        overdue = enabled and (
            completed is None or now > completed + job.interval + job.timeout
        )
        if name == CHECK_JOB and enabled and not _money_checks_owed(db):
            overdue = False
        if name == CLEARING_JOB:
            # Late only when a clear failed and no retry has succeeded since;
            # an obligation waiting for a long turn to end is not late.
            failed = [
                datetime.fromisoformat(rows[m].progress["failed_at"])
                for m in MARKERS
                if m in rows and "failed_at" in (rows[m].progress or {})
            ]
            overdue = enabled and any(
                now > since + job.interval + job.timeout for since in failed
            )
        result.append(
            dict(
                name=name,
                enabled=enabled,
                family=job_family(name),
                source=job.source,
                purpose=job.purpose,
                status="disabled"
                if not enabled
                else "never_completed"
                if row is None
                else row.last_status or "never_completed",
                last_succeeded_at=last_success,
                last_checked_at=completed,
                finding=row.finding if row else None,
                last_started_at=row.last_started_at if row else None,
                next_due_at=_next_due_at(row, job) if row else None,
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
    max_turns: int = 1,
) -> int:
    available = jobs()
    selected = names if names is not None else list(available)
    if max_turns < 1:
        raise ValueError("A refresh turn count must be positive")
    unknown = set(selected) - available.keys()
    if unknown:
        raise ValueError(f"Unknown refresh jobs: {', '.join(sorted(unknown))}")
    selected = [
        name for name in selected if (force and names is not None) or enabled_job(name)
    ]
    failed = False
    deadline = time.monotonic() + max_seconds
    queue = list(selected)
    turns = {}
    started = 0
    while queue and time.monotonic() < deadline:
        name = queue.pop(0)
        turns[name] = turns.get(name, 0) + 1
        if deadline - time.monotonic() < available[name].timeout.total_seconds():
            continue
        with session_factory() as db:
            claim = claim_job(db, available[name], force=force)
        if claim is None:
            continue
        started += 1
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
        if name != CLEARING_JOB and not stopping:
            # Even a failed turn can have committed records before it stopped.
            with session_factory() as db:
                owed = _clearing_owed(db)
                engine = db.get_bind()
            if owed and not drain_source_clearing(engine, target=target):
                # The records stay published; the obligation stays for the
                # dedicated clearing job, and this run does not report success.
                failed = True
                print(json.dumps({"job": name, "clearing": "pending"}), flush=True)
        if outcome.code == 75 and recorded and turns[name] < max_turns:
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
    if names is not None and started == 0:
        print(
            json.dumps(
                {
                    "status": "not_started",
                    "reason": "not enabled, not due, leased, or insufficient time",
                }
            ),
            flush=True,
        )
        return 76
    return int(failed)
