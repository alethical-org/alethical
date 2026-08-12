"""Calendar-aware, fingerprint-first Minnesota bill refresh scheduling."""

from __future__ import annotations

import argparse
import asyncio
import json
import re
from dataclasses import asdict, dataclass, field
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from oban import Oban
from oban._recorded import decode_recorded
from oban.testing import drain_queue
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session

from alethical.db.models import (
    Bill,
    BillAction,
    IngestionRun,
    IngestionStatus,
    LegislativeSession,
    SourceArtifact,
)
from alethical.db.session import NO_PREPARED_STATEMENTS, database_url_for_target
from alethical.pipeline.minnesota import (
    MinnesotaIngestionError,
    content_hash,
    discover_session_bills,
    fetch_text,
    http_session,
)
from alethical.pipeline.oban import (
    existing_job_id,
    oban_dsn,
    open_pool,
)
from alethical.pipeline.oban_workers import BillSyncChunkWorker
from alethical.pipeline.request_limits import (
    DEFAULT_SOURCE_REQUEST_INTERVAL_SECONDS,
    DatabaseRequestLimiter,
    RateLimitedSession,
    RequestLimiter,
)
from alethical.pipeline.sessions import SESSION_DEFINITIONS, parse_session_code

MINNESOTA_TIME = ZoneInfo("America/Chicago")
RECENT_ACTIVITY_WINDOW = timedelta(days=14)
OFFICIAL_SESSION_PAGE = "https://www.revisor.mn.gov/bills/status_search.php"
SCHEDULE_LOCK_KEY = 6103122631323
SCHEDULE_ADAPTER = "minnesota_scheduled"
SCHEDULE_TARGET_TYPE = "bill_refresh"
SCHEDULED_QUEUE = "scheduled_bill_sync"
DEFAULT_REQUEST_INTERVAL_SECONDS = DEFAULT_SOURCE_REQUEST_INTERVAL_SECONDS
DEFAULT_CHUNK_SIZE = 25
DEFAULT_MAX_BILL_NUMBER = 6000


@dataclass(frozen=True)
class SittingInterval:
    starts_on: date
    ends_on: date


@dataclass(frozen=True)
class SittingSchedule:
    sitting_phase: str
    sitting_interval: timedelta
    intervals: tuple[SittingInterval, ...]


REGULAR_94TH_SCHEDULE = SittingSchedule(
    sitting_phase="regular",
    sitting_interval=timedelta(hours=4),
    intervals=(
        SittingInterval(date(2025, 1, 14), date(2025, 5, 19)),
        SittingInterval(date(2026, 2, 17), date(2026, 5, 18)),
    ),
)

CURRENT_SITTING_SCHEDULES: dict[str, SittingSchedule] = {
    "0942025": REGULAR_94TH_SCHEDULE,
    "0942026": REGULAR_94TH_SCHEDULE,
    "1942025": SittingSchedule(
        sitting_phase="special",
        sitting_interval=timedelta(hours=2),
        intervals=(SittingInterval(date(2025, 6, 9), date(2025, 6, 10)),),
    ),
}
REQUIRED_OFFICIAL_SESSION_CODES = frozenset({"0942025", "1942025"})


class UnknownOfficialSessionError(RuntimeError):
    """The official source listed a session nobody has reviewed and mapped."""


@dataclass(frozen=True)
class RefreshDecision:
    session_code: str
    phase: str
    interval: timedelta
    due: bool
    reason: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "session_code": self.session_code,
            "phase": self.phase,
            "interval_seconds": int(self.interval.total_seconds()),
            "due": self.due,
            "reason": self.reason,
        }


def decide_session_refresh(
    session_code: str,
    *,
    now: datetime,
    last_success_at: datetime | None,
    recent_change_at: datetime | None,
) -> RefreshDecision:
    """Choose the current phase and whether this session is due for a check."""
    schedule = CURRENT_SITTING_SCHEDULES.get(session_code)
    if schedule is None:
        raise UnknownOfficialSessionError(
            f"official session {session_code} has no reviewed sitting schedule"
        )
    if now.tzinfo is None:
        raise ValueError("now must include a timezone")

    local_day = now.astimezone(MINNESOTA_TIME).date()
    phase = "interim"
    interval = timedelta(days=7)
    for sitting in schedule.intervals:
        if sitting.starts_on <= local_day <= sitting.ends_on:
            phase = schedule.sitting_phase
            interval = schedule.sitting_interval
            break
        days_after = (local_day - sitting.ends_on).days
        if 1 <= days_after <= 14:
            phase = "post_adjournment"
            interval = timedelta(hours=4)
            break

    if (
        phase == "interim"
        and recent_change_at is not None
        and now - recent_change_at <= RECENT_ACTIVITY_WINDOW
    ):
        phase = "recent_activity"
        interval = timedelta(hours=4)

    if last_success_at is None:
        due = True
        reason = "first_check"
    else:
        due = now - last_success_at >= interval
        reason = "interval_elapsed" if due else "not_due"
    return RefreshDecision(session_code, phase, interval, due, reason)


SESSION_SELECT_RE = re.compile(
    r"<select\b(?=[^>]*(?:id|name)=[\"']session[\"'])[^>]*>(.*?)</select>",
    flags=re.I | re.S,
)
SESSION_OPTION_RE = re.compile(r"\bvalue=[\"'](\d{7,8})[\"']", flags=re.I)


def parse_official_session_codes(html_text: str) -> tuple[str, ...]:
    """Read the Revisor search form's legislative-session choices."""
    session_select = SESSION_SELECT_RE.search(html_text)
    session_codes = (
        tuple(dict.fromkeys(SESSION_OPTION_RE.findall(session_select.group(1))))
        if session_select
        else ()
    )
    if not session_codes:
        raise UnknownOfficialSessionError(
            "the official session page returned no session codes; refusing writes"
        )
    return session_codes


def validate_official_session_codes(
    session_codes: tuple[str, ...],
) -> tuple[str, ...]:
    """Return current/new codes, refusing any without reviewed ingest and cadence."""
    current_legislature = max(
        definition.session_number for definition in SESSION_DEFINITIONS.values()
    )
    monitored = tuple(
        code
        for code in session_codes
        if parse_session_code(code)[0] >= current_legislature
    )
    if not monitored:
        raise UnknownOfficialSessionError(
            "the official session page listed no current legislative session"
        )
    missing = sorted(REQUIRED_OFFICIAL_SESSION_CODES - set(session_codes))
    unknown = sorted(
        code
        for code in monitored
        if code not in SESSION_DEFINITIONS or code not in CURRENT_SITTING_SCHEDULES
    )
    problems: list[str] = []
    if missing:
        problems.append("omitted expected session code(s): " + ", ".join(missing))
    if unknown:
        problems.append("unmapped official session code(s): " + ", ".join(unknown))
    if problems:
        raise UnknownOfficialSessionError("; ".join(problems))
    return monitored


def accepted_fingerprint_baseline(
    run_hash: str | None, action_hashes: tuple[str, ...]
) -> str | None:
    """Use only a hash tied unambiguously to the last accepted bill record."""
    if run_hash:
        return run_hash
    distinct = {value for value in action_hashes if value}
    return next(iter(distinct)) if len(distinct) == 1 else None


@dataclass(frozen=True)
class RefreshPlan:
    run_key: str
    created_at: datetime
    session_codes: tuple[str, ...]
    decisions: dict[str, dict[str, Any]]
    unchanged_bill_keys: tuple[str, ...]
    changed_bill_keys: tuple[str, ...]
    chunks: tuple[dict[str, Any], ...]
    full_session_codes: tuple[str, ...] = ()
    source_fingerprints: dict[str, str] = field(default_factory=dict)
    status_signatures_before: dict[str, str | None] = field(default_factory=dict)
    preflight_failures: tuple[dict[str, Any], ...] = ()

    def to_dict(self) -> dict[str, Any]:
        value = asdict(self)
        value["created_at"] = self.created_at.astimezone(UTC).isoformat()
        return value

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> "RefreshPlan":
        return cls(
            run_key=str(value["run_key"]),
            created_at=datetime.fromisoformat(str(value["created_at"])),
            session_codes=tuple(value.get("session_codes", [])),
            decisions=dict(value.get("decisions", {})),
            unchanged_bill_keys=tuple(value.get("unchanged_bill_keys", [])),
            changed_bill_keys=tuple(value.get("changed_bill_keys", [])),
            chunks=tuple(value.get("chunks", [])),
            full_session_codes=tuple(value.get("full_session_codes", [])),
            source_fingerprints=dict(value.get("source_fingerprints", {})),
            status_signatures_before=dict(value.get("status_signatures_before", {})),
            preflight_failures=tuple(value.get("preflight_failures", [])),
        )


@dataclass(frozen=True)
class RefreshReport:
    run_key: str
    text_changed_bill_keys: tuple[str, ...]
    status_only_bill_keys: tuple[str, ...]
    metadata_only_bill_keys: tuple[str, ...]
    unchanged_bill_keys: tuple[str, ...]
    rejected: tuple[dict[str, Any], ...]
    failed_bill_keys: tuple[str, ...]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def classify_refresh_results(
    plan: RefreshPlan,
    completed_results: list[dict[str, Any]],
    *,
    status_signatures_after: dict[str, str | None] | None = None,
) -> RefreshReport:
    """Put every discovered bill into one exact, non-overlapping result list."""
    accepted: set[str] = set()
    text_changed: set[str] = set()
    rejected_by_key: dict[str, dict[str, Any]] = {}
    for result in completed_results:
        accepted.update(str(key) for key in result.get("bill_keys", []))
        text_changed.update(
            str(key) for key in result.get("text_changed_bill_keys", [])
        )
        for rejection in result.get("bill_refresh_rejections", []):
            bill_key = str(rejection.get("bill_key") or "")
            if bill_key:
                rejected_by_key[bill_key] = dict(rejection)

    planned_changed = set(plan.changed_bill_keys)
    rejected_keys = set(rejected_by_key) & planned_changed
    accepted -= rejected_keys
    text_changed &= accepted & planned_changed
    non_text_accepted = (accepted & planned_changed) - text_changed
    after = status_signatures_after or {}
    status_only = {
        bill_key
        for bill_key in non_text_accepted
        if plan.status_signatures_before.get(bill_key) != after.get(bill_key)
    }
    metadata_only = non_text_accepted - status_only
    preflight_failed = {
        str(item.get("bill_key") or "")
        for item in plan.preflight_failures
        if item.get("bill_key")
    }
    failed = planned_changed - accepted - rejected_keys
    failed.update(preflight_failed)

    return RefreshReport(
        run_key=plan.run_key,
        text_changed_bill_keys=tuple(sorted(text_changed)),
        status_only_bill_keys=tuple(sorted(status_only)),
        metadata_only_bill_keys=tuple(sorted(metadata_only)),
        unchanged_bill_keys=tuple(sorted(set(plan.unchanged_bill_keys))),
        rejected=tuple(rejected_by_key[key] for key in sorted(rejected_keys)),
        failed_bill_keys=tuple(sorted(failed)),
    )


def scheduled_chunk_job(
    *,
    run_key: str,
    chunk_index: int,
    bill_keys: list[str],
    targets: list[dict[str, Any]],
    source_fingerprints: dict[str, str],
    request_interval_seconds: float,
    database_target: str,
    include_rag: bool,
):
    """Build a retry-safe bill job on a queue no unrelated work uses."""
    identity = content_hash(
        json.dumps(
            [
                {
                    "bill_key": bill_key,
                    "fingerprint": source_fingerprints.get(bill_key),
                    "target": target,
                }
                for bill_key, target in zip(bill_keys, targets, strict=True)
            ],
            sort_keys=True,
            separators=(",", ":"),
        )
    )[:16]
    task_key = f"scheduled-bill-refresh:{run_key}:chunk-{chunk_index:04d}:{identity}"
    return BillSyncChunkWorker.new(
        {
            "task_key": task_key,
            "database_target": database_target,
            "oban_target": database_target,
            "dry_run": False,
            "allow_writes": True,
            "targets": targets,
            "include_rag": include_rag,
            "rag_target": database_target,
            "request_interval_seconds": request_interval_seconds,
        },
        queue=scheduled_queue(run_key),
        max_attempts=1,
    )


def scheduled_queue(run_key: str) -> str:
    """Give each run a private queue so it cannot drain another run's jobs."""
    return f"{SCHEDULED_QUEUE}_{content_hash(run_key)[:16]}"


_BILL_KEY_SESSION_RE = re.compile(
    r"^(?P<legislature>\d+)-(?P<year>\d{4})(?:s(?P<special>\d+))?-"
)


def _plan_bill_session_codes(
    plan: dict[str, Any], session_codes: set[str]
) -> dict[str, str]:
    """Map saved bill results back to the official session that produced them."""
    bill_sessions: dict[str, str] = {}
    for chunk in plan.get("chunks", []):
        if not isinstance(chunk, dict):
            continue
        bill_keys = chunk.get("bill_keys", [])
        targets = chunk.get("targets", [])
        for bill_key, target in zip(bill_keys, targets):
            if not isinstance(target, dict):
                continue
            session_code = str(target.get("session_code") or "")
            if session_code in session_codes:
                bill_sessions[str(bill_key)] = session_code
    for failure in plan.get("preflight_failures", []):
        if not isinstance(failure, dict):
            continue
        bill_key = str(failure.get("bill_key") or "")
        session_code = str(failure.get("session_code") or "")
        if bill_key and session_code in session_codes:
            bill_sessions[bill_key] = session_code

    for bill_key in set(plan.get("changed_bill_keys", [])) | set(
        plan.get("unchanged_bill_keys", [])
    ):
        bill_key = str(bill_key)
        if bill_key in bill_sessions:
            continue
        match = _BILL_KEY_SESSION_RE.match(bill_key)
        if match is None:
            continue
        session_code = "".join(
            (
                match.group("special") or "0",
                match.group("legislature"),
                match.group("year"),
            )
        )
        if session_code in session_codes:
            bill_sessions[bill_key] = session_code
    return bill_sessions


def _session_history(
    db: Session, session_codes: tuple[str, ...], *, now: datetime
) -> tuple[
    dict[str, datetime | None],
    dict[str, datetime | None],
    dict[str, set[str]],
]:
    """Read last checks, recent changes, and unfinished bills per session."""
    last_check = dict.fromkeys(session_codes)
    recent_change = dict.fromkeys(session_codes)
    pending_retry = {code: set() for code in session_codes}
    outcome_seen: set[str] = set()
    runs = db.scalars(
        select(IngestionRun)
        .where(
            IngestionRun.adapter == SCHEDULE_ADAPTER,
            IngestionRun.target_type == SCHEDULE_TARGET_TYPE,
            IngestionRun.finished_at.is_not(None),
            IngestionRun.status.in_(
                [IngestionStatus.succeeded, IngestionStatus.failed]
            ),
        )
        .order_by(IngestionRun.finished_at.desc())
        .limit(1000)
    ).all()
    for run in runs:
        if run.finished_at is None:
            continue
        stats = run.stats or {}
        checked_codes = set(stats.get("session_codes", []))
        plan = stats.get("plan")
        full_codes = (
            set(plan.get("full_session_codes", plan.get("session_codes", [])))
            if isinstance(plan, dict)
            else set()
        )
        checked_at = run.finished_at
        if isinstance(plan, dict) and plan.get("created_at"):
            try:
                checked_at = datetime.fromisoformat(str(plan["created_at"]))
            except ValueError:
                checked_at = run.finished_at
        bill_sessions = (
            _plan_bill_session_codes(plan, set(session_codes))
            if isinstance(plan, dict)
            else {}
        )
        unfinished = {str(key) for key in stats.get("failed_bill_keys", []) if key}
        unfinished.update(
            str(item.get("bill_key"))
            for item in stats.get("rejected", [])
            if item.get("bill_key")
        )
        if isinstance(plan, dict) and not {
            "failed_bill_keys",
            "rejected",
        }.issubset(stats):
            unfinished.update(str(key) for key in plan.get("changed_bill_keys", []))
        finished = {
            str(key)
            for field_name in (
                "text_changed_bill_keys",
                "status_only_bill_keys",
                "metadata_only_bill_keys",
                "unchanged_bill_keys",
            )
            for key in stats.get(field_name, [])
        }
        for bill_key in sorted(unfinished | finished):
            if bill_key in outcome_seen:
                continue
            session_code = bill_sessions.get(bill_key)
            if session_code is None:
                continue
            outcome_seen.add(bill_key)
            if bill_key in unfinished:
                pending_retry[session_code].add(bill_key)
        changed_keys = {
            str(key)
            for field_name in (
                "text_changed_bill_keys",
                "status_only_bill_keys",
                "metadata_only_bill_keys",
            )
            for key in stats.get(field_name, [])
        }
        changed_by_code = {
            code: any(bill_sessions.get(bill_key) == code for bill_key in changed_keys)
            for code in session_codes
        }
        for code in checked_codes & set(session_codes):
            if last_check[code] is None and code in full_codes:
                last_check[code] = checked_at
            if (
                changed_by_code[code]
                and recent_change[code] is None
                and now - checked_at <= RECENT_ACTIVITY_WINDOW
            ):
                recent_change[code] = checked_at
    return last_check, recent_change, pending_retry


def _status_signature_payload(db: Session, bill_key: str) -> dict[str, Any] | None:
    bill = db.scalar(select(Bill).where(Bill.bill_key == bill_key))
    if bill is None:
        return None
    actions = db.execute(
        select(
            BillAction.chamber_id,
            BillAction.action_number,
            BillAction.action_group,
            BillAction.action_text,
            BillAction.action_description,
            BillAction.committee_name,
            BillAction.action_at,
            BillAction.journal_page,
            BillAction.roll_call_text,
        )
        .where(BillAction.bill_id == bill.id)
        .order_by(BillAction.chamber_id, BillAction.action_number)
    ).all()
    return {
        "current_status": bill.current_status,
        "current_status_code": bill.current_status_code,
        "status_key": bill.status_key,
        "status_rank": bill.status_rank,
        "latest_action_at": bill.latest_action_at.isoformat()
        if bill.latest_action_at
        else None,
        "actions": [
            [
                str(row[0]) if row[0] else None,
                row[1],
                row[2],
                row[3],
                row[4],
                row[5],
                row[6].isoformat() if row[6] else None,
                row[7],
                row[8],
            ]
            for row in actions
        ],
    }


def _bill_status_signatures(db: Session, bill_keys: list[str]) -> dict[str, str | None]:
    """Fingerprint only public bill status and action history, not all metadata."""
    signatures: dict[str, str | None] = {}
    for bill_key in bill_keys:
        payload = _status_signature_payload(db, bill_key)
        signatures[bill_key] = (
            content_hash(json.dumps(payload, sort_keys=True, separators=(",", ":")))
            if payload is not None
            else None
        )
    return signatures


def _bill_fingerprint_baselines(
    db: Session, bill_keys: list[str]
) -> dict[str, str | None]:
    """Load each bill's unambiguous last accepted status-XML fingerprint."""
    if not bill_keys:
        return {}
    run_hashes: dict[str, str | None] = {}
    for bill_key, stats in db.execute(
        select(Bill.bill_key, IngestionRun.stats)
        .outerjoin(IngestionRun, Bill.ingestion_run_id == IngestionRun.id)
        .where(Bill.bill_key.in_(bill_keys))
    ):
        value = (stats or {}).get("source_status_fingerprint")
        run_hashes[str(bill_key)] = str(value) if value else None

    action_hashes: dict[str, list[str]] = {}
    for bill_key, digest in db.execute(
        select(Bill.bill_key, SourceArtifact.content_hash)
        .join(BillAction, BillAction.bill_id == Bill.id)
        .join(SourceArtifact, SourceArtifact.id == BillAction.source_artifact_id)
        .where(Bill.bill_key.in_(bill_keys))
    ):
        action_hashes.setdefault(str(bill_key), []).append(str(digest))

    return {
        bill_key: accepted_fingerprint_baseline(
            run_hashes.get(bill_key), tuple(action_hashes.get(bill_key, []))
        )
        for bill_key in bill_keys
    }


def _stored_bill_keys(db: Session, session_code: str) -> set[str]:
    definition = SESSION_DEFINITIONS[session_code]
    return set(
        db.scalars(
            select(Bill.bill_key)
            .join(LegislativeSession, LegislativeSession.id == Bill.session_id)
            .where(LegislativeSession.slug == definition.slug)
        ).all()
    )


def build_refresh_plan(
    db: Session,
    *,
    run_key: str,
    now: datetime,
    request_interval_seconds: float = DEFAULT_REQUEST_INTERVAL_SECONDS,
    max_bill_number: int = DEFAULT_MAX_BILL_NUMBER,
    chunk_size: int = DEFAULT_CHUNK_SIZE,
    bill_key: str | None = None,
    request_limiter: RequestLimiter | None = None,
) -> RefreshPlan:
    """Validate sessions, decide what is due, then run the cheap fingerprint pass."""
    limiter = request_limiter or DatabaseRequestLimiter(
        db.get_bind() if hasattr(db, "get_bind") else db,
        interval_seconds=request_interval_seconds,
    )
    source_session = RateLimitedSession(http_session(), limiter)
    session_page = fetch_text(source_session, OFFICIAL_SESSION_PAGE)
    official_codes = validate_official_session_codes(
        parse_official_session_codes(session_page)
    )

    last_check, recent_change, pending_retry = _session_history(
        db, official_codes, now=now
    )
    decisions = {
        code: decide_session_refresh(
            code,
            now=now,
            last_success_at=last_check[code],
            recent_change_at=recent_change[code],
        )
        for code in official_codes
    }
    full_due_codes = {code for code, decision in decisions.items() if decision.due}
    checked_codes = tuple(
        code
        for code in official_codes
        if bill_key or code in full_due_codes or pending_retry[code]
    )

    unchanged: list[str] = []
    changed: list[str] = []
    source_fingerprints: dict[str, str] = {}
    changed_targets: list[tuple[str, dict[str, str]]] = []
    preflight_failures: list[dict[str, Any]] = []
    scoped_bill_found = False
    pending_found: set[str] = set()

    for session_code in checked_codes:
        discovered = discover_session_bills(
            source_session,
            session_code=session_code,
            max_bill_number=max_bill_number,
        )
        if bill_key:
            discovered = [item for item in discovered if item.bill_key == bill_key]
            scoped_bill_found = scoped_bill_found or bool(discovered)
        elif session_code not in full_due_codes:
            discovered = [
                item
                for item in discovered
                if item.bill_key in pending_retry[session_code]
            ]
            pending_found.update(item.bill_key for item in discovered)
        discovered_keys = [item.bill_key for item in discovered]
        baselines = _bill_fingerprint_baselines(db, discovered_keys)

        if not bill_key and session_code in full_due_codes:
            missing = sorted(_stored_bill_keys(db, session_code) - set(discovered_keys))
            preflight_failures.extend(
                {
                    "bill_key": missing_key,
                    "session_code": session_code,
                    "stage": "discovery",
                    "reason": "stored bill was absent from the official session list",
                }
                for missing_key in missing
            )

        for item in discovered:
            try:
                xml_text = fetch_text(source_session, item.status_xml_uri)
            except MinnesotaIngestionError as exc:
                preflight_failures.append(
                    {
                        "bill_key": item.bill_key,
                        "session_code": session_code,
                        "stage": "fingerprint",
                        "reason": str(exc),
                    }
                )
                continue
            fingerprint = content_hash(xml_text)
            source_fingerprints[item.bill_key] = fingerprint
            if baselines.get(item.bill_key) == fingerprint:
                unchanged.append(item.bill_key)
                continue
            changed.append(item.bill_key)
            changed_targets.append(
                (
                    item.bill_key,
                    {
                        "chamber": item.chamber,
                        "bill_number": str(item.file_number),
                        "session_code": item.session_code,
                    },
                )
            )

    if bill_key and not scoped_bill_found:
        preflight_failures.append(
            {
                "bill_key": bill_key,
                "stage": "discovery",
                "reason": "bill was absent from every current official session list",
            }
        )
    if not bill_key:
        pending_keys = set().union(*pending_retry.values())
        already_failed = {
            str(item.get("bill_key") or "") for item in preflight_failures
        }
        preflight_failures.extend(
            {
                "bill_key": missing_key,
                "session_code": next(
                    code for code, keys in pending_retry.items() if missing_key in keys
                ),
                "stage": "retry_discovery",
                "reason": "unfinished bill was absent from every current session list",
            }
            for missing_key in sorted(pending_keys - pending_found)
            if checked_codes
            and missing_key not in changed
            and missing_key not in unchanged
            and missing_key not in already_failed
        )

    chunks: list[dict[str, Any]] = []
    for offset in range(0, len(changed_targets), max(1, chunk_size)):
        group = changed_targets[offset : offset + max(1, chunk_size)]
        chunks.append(
            {
                "chunk_index": len(chunks) + 1,
                "bill_keys": [item[0] for item in group],
                "targets": [item[1] for item in group],
            }
        )

    return RefreshPlan(
        run_key=run_key,
        created_at=now,
        session_codes=checked_codes,
        decisions={
            code: {
                **decision.to_dict(),
                "pending_retry_count": len(pending_retry[code]),
            }
            for code, decision in decisions.items()
        },
        unchanged_bill_keys=tuple(sorted(set(unchanged))),
        changed_bill_keys=tuple(sorted(set(changed))),
        chunks=tuple(chunks),
        full_session_codes=tuple(
            code for code in checked_codes if code in full_due_codes and not bill_key
        ),
        source_fingerprints=source_fingerprints,
        status_signatures_before=_bill_status_signatures(db, sorted(set(changed))),
        preflight_failures=tuple(preflight_failures),
    )


def _find_or_start_run(db: Session, run_key: str) -> IngestionRun:
    run = db.scalars(
        select(IngestionRun)
        .where(
            IngestionRun.adapter == SCHEDULE_ADAPTER,
            IngestionRun.target_type == SCHEDULE_TARGET_TYPE,
            IngestionRun.target_key == run_key,
        )
        .order_by(IngestionRun.started_at.desc())
    ).first()
    if run is None:
        run = IngestionRun(
            adapter=SCHEDULE_ADAPTER,
            target_type=SCHEDULE_TARGET_TYPE,
            target_key=run_key,
            status=IngestionStatus.running,
            stats={"run_key": run_key},
        )
        db.add(run)
        db.flush()
    elif run.status != IngestionStatus.succeeded:
        run.status = IngestionStatus.running
        run.finished_at = None
        run.error_text = None
    return run


def _save_plan(db: Session, run: IngestionRun, plan: RefreshPlan) -> None:
    stats = dict(run.stats or {})
    stats.update(
        {
            "run_key": plan.run_key,
            "session_codes": list(plan.session_codes),
            "decisions": plan.decisions,
            "plan": plan.to_dict(),
        }
    )
    run.stats = stats
    db.commit()


async def _enqueue_scheduled_chunks(
    pool: Any,
    plan: RefreshPlan,
    *,
    request_interval_seconds: float,
    database_target: str,
    include_rag: bool,
) -> list[str]:
    oban = Oban(pool=pool, queues={})
    task_keys: list[str] = []
    for chunk in plan.chunks:
        job = scheduled_chunk_job(
            run_key=plan.run_key,
            chunk_index=int(chunk["chunk_index"]),
            bill_keys=list(chunk["bill_keys"]),
            targets=list(chunk["targets"]),
            source_fingerprints=plan.source_fingerprints,
            request_interval_seconds=request_interval_seconds,
            database_target=database_target,
            include_rag=include_rag,
        )
        task_key = str(job.args["task_key"])
        task_keys.append(task_key)
        existing = await existing_job_id(
            pool,
            worker=job.worker,
            queue=job.queue,
            task_key=task_key,
        )
        if existing is None:
            await oban.enqueue(job)
    return task_keys


async def _drain_scheduled_chunks(pool: Any, *, queue: str, concurrency: int) -> None:
    oban = Oban(pool=pool, queues={queue: max(1, concurrency)})
    await asyncio.gather(
        *[
            drain_queue(
                queue=queue,
                oban=oban,
                with_safety=True,
                with_scheduled=False,
            )
            for _ in range(max(1, concurrency))
        ]
    )


async def _recorded_results(
    pool: Any, task_keys: list[str], *, queue: str
) -> list[dict[str, Any]]:
    if not task_keys:
        return []
    async with pool.connection() as connection:
        cursor = await connection.execute(
            """
            select id, state, args, meta
            from oban_jobs
            where queue = %s
              and args->>'task_key' = any(%s)
            order by id desc
            """,
            (queue, task_keys),
        )
        rows = await cursor.fetchall()

    latest: dict[str, tuple[Any, ...]] = {}
    for row in rows:
        args = row[2] or {}
        task_key = str(args.get("task_key") or "")
        if task_key and task_key not in latest:
            latest[task_key] = row

    completed: list[dict[str, Any]] = []
    for task_key in task_keys:
        row = latest.get(task_key)
        if row is None or str(row[1]) != "completed":
            continue
        meta = row[3] or {}
        if not meta.get("recorded") or not meta.get("return"):
            continue
        value = decode_recorded(str(meta["return"]))
        if isinstance(value, dict):
            completed.append(value)
    return completed


async def execute_refresh_plan(
    plan: RefreshPlan,
    *,
    database_url: str,
    database_target: str,
    include_rag: bool,
    request_interval_seconds: float,
    concurrency: int,
) -> list[dict[str, Any]]:
    """Resume or run only this schedule's isolated bill chunks."""
    pool = await open_pool(oban_dsn(database_url))
    try:
        queue = scheduled_queue(plan.run_key)
        task_keys = await _enqueue_scheduled_chunks(
            pool,
            plan,
            request_interval_seconds=request_interval_seconds,
            database_target=database_target,
            include_rag=include_rag,
        )
        await _drain_scheduled_chunks(pool, queue=queue, concurrency=concurrency)
        return await _recorded_results(pool, task_keys, queue=queue)
    finally:
        await pool.close()


def _report_payload(
    plan: RefreshPlan, report: RefreshReport, *, status: str
) -> dict[str, Any]:
    value = report.to_dict()
    value.update(
        {
            "status": status,
            "created_at": plan.created_at.astimezone(UTC).isoformat(),
            "session_codes": list(plan.session_codes),
            "decisions": plan.decisions,
            "preflight_failures": list(plan.preflight_failures),
            "counts": {
                "text_changed": len(report.text_changed_bill_keys),
                "status_only": len(report.status_only_bill_keys),
                "metadata_only": len(report.metadata_only_bill_keys),
                "unchanged": len(report.unchanged_bill_keys),
                "rejected": len(report.rejected),
                "failed": len(report.failed_bill_keys),
            },
        }
    )
    return value


def _finish_run(
    db: Session,
    run: IngestionRun,
    plan: RefreshPlan,
    report: RefreshReport,
) -> dict[str, Any]:
    incomplete = bool(report.failed_bill_keys or report.rejected)
    status = "failed" if incomplete else "succeeded"
    payload = _report_payload(plan, report, status=status)
    run.status = IngestionStatus.failed if incomplete else IngestionStatus.succeeded
    run.finished_at = datetime.now(UTC)
    run.error_text = (
        f"{len(report.failed_bill_keys) + len(report.rejected)} bill(s) did not finish"
        if incomplete
        else None
    )
    run.stats = {**dict(run.stats or {}), **payload}
    db.commit()
    return payload


def _write_report(path: str, payload: dict[str, Any]) -> None:
    report_path = Path(path)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")


def _parse_now(value: str | None) -> datetime:
    if not value:
        return datetime.now(UTC)
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("--now must include a timezone")
    return parsed.astimezone(UTC)


def run_scheduled_refresh(args: argparse.Namespace) -> int:
    if not re.fullmatch(r"[A-Za-z0-9._:-]{1,160}", args.run_key):
        raise ValueError("--run-key must be 1-160 safe identifier characters")
    if args.fingerprint_only and not args.bill_key:
        raise ValueError("--fingerprint-only requires --bill-key")
    if not 1 <= args.concurrency <= 8:
        raise ValueError("--concurrency must be between 1 and 8")
    if (
        args.target == "production"
        and args.request_interval_seconds < DEFAULT_REQUEST_INTERVAL_SECONDS
    ):
        raise ValueError(
            "production source requests cannot run faster than the shared "
            f"{DEFAULT_REQUEST_INTERVAL_SECONDS}-second interval"
        )
    if not args.fingerprint_only and not args.allow_writes:
        raise ValueError("a scheduled refresh requires --allow-writes")
    if (
        args.target == "production"
        and not args.fingerprint_only
        and not args.include_rag
    ):
        raise ValueError(
            "production refreshes require --include-rag so changed search text "
            "commits with changed bill text"
        )

    now = _parse_now(args.now)
    database_url = str(database_url_for_target(args.target))
    engine = create_engine(
        database_url,
        pool_pre_ping=True,
        connect_args=NO_PREPARED_STATEMENTS,
    )
    run: IngestionRun | None = None
    payload: dict[str, Any]
    # Hold a transaction-scoped lock on its own connection. Production uses a
    # transaction pooler, so a session lock could jump to a different backend
    # after a commit and silently stop protecting the run.
    with engine.connect() as lock_connection, lock_connection.begin():
        locked = bool(
            lock_connection.scalar(
                text("select pg_try_advisory_xact_lock(:key)"),
                {"key": SCHEDULE_LOCK_KEY},
            )
        )
        if not locked:
            payload = {
                "run_key": args.run_key,
                "status": "skipped",
                "reason": "another scheduled bill refresh holds the production lock",
            }
            _write_report(args.report_path, payload)
            print(json.dumps(payload, indent=2, sort_keys=True))
            return 0

        with Session(engine) as db:
            try:
                if not args.fingerprint_only:
                    run = _find_or_start_run(db, args.run_key)
                    if run.status == IngestionStatus.succeeded:
                        payload = dict(run.stats)
                        _write_report(args.report_path, payload)
                        print(json.dumps(payload, indent=2, sort_keys=True))
                        return 0

                saved_plan = (run.stats or {}).get("plan") if run is not None else None
                if isinstance(saved_plan, dict) and saved_plan.get(
                    "preflight_failures"
                ):
                    # A retry must re-check transient source failures. Completed
                    # child chunks are safe to resume, but a failed cheap pass is
                    # not a durable plan.
                    saved_plan = None
                plan = (
                    RefreshPlan.from_dict(saved_plan)
                    if isinstance(saved_plan, dict)
                    else build_refresh_plan(
                        db,
                        run_key=args.run_key,
                        now=now,
                        request_interval_seconds=args.request_interval_seconds,
                        max_bill_number=args.max_bill_number,
                        chunk_size=args.chunk_size,
                        bill_key=args.bill_key,
                        request_limiter=DatabaseRequestLimiter(
                            engine,
                            interval_seconds=args.request_interval_seconds,
                        ),
                    )
                )

                if args.fingerprint_only:
                    payload = {
                        "run_key": plan.run_key,
                        "status": "fingerprint_only",
                        "session_codes": list(plan.session_codes),
                        "decisions": plan.decisions,
                        "changed_bill_keys": list(plan.changed_bill_keys),
                        "unchanged_bill_keys": list(plan.unchanged_bill_keys),
                        "preflight_failures": list(plan.preflight_failures),
                    }
                    _write_report(args.report_path, payload)
                    print(json.dumps(payload, indent=2, sort_keys=True))
                    return 1 if plan.changed_bill_keys or plan.preflight_failures else 0

                assert run is not None
                _save_plan(db, run, plan)
                completed = asyncio.run(
                    execute_refresh_plan(
                        plan,
                        database_url=database_url,
                        database_target=args.target,
                        include_rag=args.include_rag,
                        request_interval_seconds=args.request_interval_seconds,
                        concurrency=args.concurrency,
                    )
                )
                # Child workers commit through separate database connections.
                # Expire this session so the after-signature reads those changes.
                db.expire_all()
                report = classify_refresh_results(
                    plan,
                    completed,
                    status_signatures_after=_bill_status_signatures(
                        db, list(plan.changed_bill_keys)
                    ),
                )
                payload = _finish_run(db, run, plan, report)
                _write_report(args.report_path, payload)
                print(json.dumps(payload, indent=2, sort_keys=True))
                return 1 if report.failed_bill_keys or report.rejected else 0
            except Exception as exc:
                if run is not None:
                    run.status = IngestionStatus.failed
                    run.finished_at = datetime.now(UTC)
                    run.error_text = str(exc)
                    run.stats = {
                        **dict(run.stats or {}),
                        "run_key": args.run_key,
                        "status": "failed",
                        "error": str(exc),
                    }
                    db.commit()
                payload = {
                    "run_key": args.run_key,
                    "status": "failed",
                    "error": str(exc),
                }
                _write_report(args.report_path, payload)
                print(json.dumps(payload, indent=2, sort_keys=True))
                return 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run a safe, calendar-aware Minnesota bill refresh."
    )
    parser.add_argument("--run-key", required=True)
    parser.add_argument("--target", choices=["local", "production"], default="local")
    parser.add_argument("--report-path", default="bill-refresh-report.json")
    parser.add_argument("--now", default=None)
    parser.add_argument("--bill-key", default=None)
    parser.add_argument("--fingerprint-only", action="store_true")
    parser.add_argument("--allow-writes", action="store_true")
    parser.add_argument("--include-rag", action="store_true")
    parser.add_argument("--max-bill-number", type=int, default=DEFAULT_MAX_BILL_NUMBER)
    parser.add_argument("--chunk-size", type=int, default=DEFAULT_CHUNK_SIZE)
    parser.add_argument("--concurrency", type=int, default=4)
    parser.add_argument(
        "--request-interval-seconds",
        type=float,
        default=DEFAULT_REQUEST_INTERVAL_SECONDS,
    )
    return parser


def main() -> None:
    raise SystemExit(run_scheduled_refresh(build_parser().parse_args()))


if __name__ == "__main__":
    main()
