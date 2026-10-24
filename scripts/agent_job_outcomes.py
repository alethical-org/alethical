"""Private, hand-run job outcome ledger. Supplied evidence is an attestation.

No network calls, AI calls, release actions, or permission changes are performed.
"""

from __future__ import annotations

import argparse
import fcntl
import json
import math
import os
import re
import statistics
import sys
import tempfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

STATES = {"planned", "in_progress", "paused", "blocked", "failed", "completed"}
KINDS = {"checks", "review", "browser", "live"}
FIELDS = {
    "job_id",
    "title",
    "agent",
    "state",
    "started_at",
    "finished_at",
    "result_commit",
    "release_commit",
    "ui",
    "deployable",
    "human_interventions",
    "repeats",
    "ai_cost_usd",
    "evidence",
}
EVIDENCE_FIELDS = {"kind", "commit", "checked_at", "outcome", "reference", "observer"}
STORED_FIELDS = {"revision", "recorded_at"}


def timestamp(value: object, field: str) -> datetime:
    if not isinstance(value, str):
        raise ValueError(f"{field} must be a timezone-aware timestamp")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"{field} must be a timezone-aware timestamp") from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError(f"{field} needs a timezone")
    return parsed


def text_field(value: object, field: str) -> None:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} must be nonempty text")


def commit_field(value: object, field: str) -> None:
    if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{40}", value):
        raise ValueError(f"{field} must be a full lowercase 40-character commit")


def validate(record: dict, *, now: datetime | None = None) -> None:
    """Check consistency, never claim that an evidence source was independently read."""
    now = now or datetime.now(timezone.utc)
    if not isinstance(record, dict) or set(record) != FIELDS:
        raise ValueError("job fields must match the template exactly")
    for field in ("job_id", "title", "agent", "state"):
        text_field(record[field], field)
    if record["state"] not in STATES:
        raise ValueError("unknown job state")
    for field in ("ui", "deployable"):
        if type(record[field]) is not bool:
            raise ValueError(f"{field} must be true or false")
    for field in ("human_interventions", "repeats"):
        value = record[field]
        if value is not None and (type(value) is not int or value < 0):
            raise ValueError(f"{field} must be a nonnegative integer or null")
    cost = record["ai_cost_usd"]
    if cost is not None and (
        type(cost) not in (int, float) or not math.isfinite(cost) or cost < 0
    ):
        raise ValueError("ai_cost_usd must be finite and nonnegative, or null")
    start = (
        timestamp(record["started_at"], "started_at")
        if record["started_at"] is not None
        else None
    )
    finish = (
        timestamp(record["finished_at"], "finished_at")
        if record["finished_at"] is not None
        else None
    )
    if (start and start > now) or (finish and finish > now):
        raise ValueError("job timestamps cannot be in the future")
    if finish and (not start or finish < start):
        raise ValueError("finished_at must follow started_at")
    if record["state"] == "planned" and start is not None:
        raise ValueError("planned jobs cannot have started_at")
    if record["state"] not in {"planned", "paused"} and start is None:
        raise ValueError("a started job needs started_at")
    if record["state"] in {"completed", "failed"}:
        if finish is None:
            raise ValueError("a terminal job needs finished_at")
    elif finish is not None:
        raise ValueError("an unfinished job cannot have finished_at")
    for field in ("result_commit", "release_commit"):
        if record[field] is not None:
            commit_field(record[field], field)
    if not record["deployable"] and record["release_commit"] is not None:
        raise ValueError("a nondeployable job cannot claim a release commit")
    evidence = record["evidence"]
    if not isinstance(evidence, list):
        raise ValueError("evidence must be a list")
    seen = set()
    target = (
        record["release_commit"] if record["deployable"] else record["result_commit"]
    )
    for entry in evidence:
        if not isinstance(entry, dict) or set(entry) != EVIDENCE_FIELDS:
            raise ValueError("evidence fields must match the template exactly")
        for field in ("kind", "outcome", "reference", "observer"):
            text_field(entry[field], f"evidence.{field}")
        if entry["kind"] not in KINDS or entry["kind"] in seen:
            raise ValueError("each evidence kind must be known and appear once")
        seen.add(entry["kind"])
        if entry["outcome"] not in {"passed", "failed"}:
            raise ValueError("evidence outcome must be passed or failed")
        commit_field(entry["commit"], "evidence.commit")
        checked = timestamp(entry["checked_at"], "evidence.checked_at")
        if not start or checked < start or checked > (finish or now):
            raise ValueError("evidence must be dated within the job's working time")
        if (
            entry["kind"] == "review"
            and entry["observer"].strip() == record["agent"].strip()
        ):
            raise ValueError("review must name an independent reviewer")
        if record["state"] == "completed" and (
            entry["commit"] != target or entry["outcome"] != "passed"
        ):
            raise ValueError("completion evidence must pass on the exact final commit")
    if record["state"] == "completed":
        if record["result_commit"] is None or target is None:
            raise ValueError(
                "completion needs result and, when deployable, release commits"
            )
        required = {"checks", "review"}
        if record["ui"]:
            required.add("browser")
        if record["deployable"]:
            required.add("live")
        if not required <= seen:
            raise ValueError(
                f"completion is missing evidence: {', '.join(sorted(required - seen))}"
            )


def template(job_id: str, title: str, agent: str) -> dict:
    return {
        "job_id": job_id,
        "title": title,
        "agent": agent,
        "state": "planned",
        "started_at": None,
        "finished_at": None,
        "result_commit": None,
        "release_commit": None,
        "ui": False,
        "deployable": False,
        "human_interventions": None,
        "repeats": None,
        "ai_cost_usd": None,
        "evidence": [],
    }


def validate_update(record: dict, previous: dict) -> None:
    if any(record[key] != previous[key] for key in ("agent", "title")) or (
        previous["started_at"] is not None
        and record["started_at"] != previous["started_at"]
    ):
        raise ValueError("updates cannot change the job's identity or starting time")
    if previous["started_at"] is not None and any(
        previous[field] and not record[field] for field in ("ui", "deployable")
    ):
        raise ValueError("updates cannot remove started UI or release obligations")


def read_ledger(path: Path) -> tuple[list[dict], dict[str, dict]]:
    rows: list[dict] = []
    latest: dict[str, dict] = {}
    if not path.exists():
        return rows, latest
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        try:
            row = json.loads(line)
            if not isinstance(row, dict) or set(row) != FIELDS | STORED_FIELDS:
                raise ValueError("unexpected saved fields")
            recorded = timestamp(row["recorded_at"], "recorded_at")
            if recorded > datetime.now(timezone.utc):
                raise ValueError("saved timestamp cannot be in the future")
            job = {key: row[key] for key in FIELDS}
            validate(job, now=recorded)
            previous = latest.get(job["job_id"])
            expected = previous["revision"] + 1 if previous else 1
            if type(row["revision"]) is not int or row["revision"] != expected:
                raise ValueError("duplicate or missing revision")
            if previous and recorded < timestamp(
                previous["recorded_at"], "recorded_at"
            ):
                raise ValueError("saved revisions are out of time order")
            if previous:
                validate_update(job, previous)
            latest[job["job_id"]] = row
            rows.append(row)
        except (ValueError, TypeError, KeyError) as exc:
            raise ValueError(f"invalid ledger line {number}: {exc}") from exc
    return rows, latest


def save_record(
    path: Path,
    record: dict,
    *,
    update: bool = False,
    expected_revision: int | None = None,
) -> dict:
    """Serialize cooperating writers; publish a whole new append-only history atomically."""
    validate(record)
    path.parent.mkdir(parents=True, exist_ok=True)
    lock = path.with_name(path.name + ".lock")
    with lock.open("a", encoding="utf-8") as handle:
        os.chmod(lock, 0o600)
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        rows, latest = read_ledger(path)
        previous = latest.get(record["job_id"])
        if update != (previous is not None):
            raise ValueError("update needs an existing job; record needs a new job_id")
        if expected_revision is not None and (
            type(expected_revision) is not int
            or previous is None
            or previous["revision"] != expected_revision
        ):
            raise ValueError("job changed during verification")
        if previous:
            validate_update(record, previous)
        row = {
            **record,
            "revision": previous["revision"] + 1 if previous else 1,
            "recorded_at": datetime.now(timezone.utc).isoformat(),
        }
        rows.append(row)
        temporary: str | None = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                dir=path.parent,
                prefix=f".{path.name}.",
                delete=False,
            ) as output:
                temporary = output.name
                for item in rows:
                    output.write(
                        json.dumps(item, sort_keys=True, allow_nan=False) + "\n"
                    )
                output.flush()
                os.fsync(output.fileno())
            os.replace(temporary, path)
            temporary = None
            directory = os.open(path.parent, os.O_RDONLY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
        finally:
            if temporary is not None:
                os.unlink(temporary)
        return row


def report(latest: dict[str, dict]) -> dict:
    jobs = list(latest.values())
    started = [job for job in jobs if job["started_at"] is not None]
    completed = [job for job in started if job["state"] == "completed"]
    known_help = [job for job in completed if job["human_interventions"] is not None]
    without_help = sum(job["human_interventions"] == 0 for job in known_help)
    durations = [
        (
            timestamp(job["finished_at"], "finished_at")
            - timestamp(job["started_at"], "started_at")
        ).total_seconds()
        for job in completed
    ]
    metrics = {}
    for field in ("human_interventions", "repeats", "ai_cost_usd"):
        known = [job[field] for job in started if job[field] is not None]
        metrics[field] = {
            "known_total": sum(known) if known else None,
            "known_jobs": len(known),
            "unknown_jobs": len(started) - len(known),
        }
    return {
        "evidence_basis": "attested; supplied sources are not independently fetched",
        "registered_jobs": len(jobs),
        "started_jobs": len(started),
        "states": dict(sorted(Counter(job["state"] for job in jobs).items())),
        "recorded_completed_jobs": len(completed),
        "recorded_completion_rate": len(completed) / len(started) if started else None,
        "completed_without_human_intervention": without_help,
        "completed_with_known_interventions": len(known_help),
        "completed_with_unknown_interventions": len(completed) - len(known_help),
        "known_intervention_completion_coverage": len(known_help) / len(completed)
        if completed
        else None,
        "completion_without_intervention_rate_all_started": without_help / len(started)
        if started
        else None,
        "seconds_to_recorded_working_result": {
            "known_jobs": len(durations),
            "median": statistics.median(durations) if durations else None,
            "maximum": max(durations) if durations else None,
        },
        "metrics_all_started_jobs": metrics,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    draft = sub.add_parser(
        "template", help="print a blank job record with unknown measurements"
    )
    for name in ("job-id", "title", "agent"):
        draft.add_argument(f"--{name}", required=True)
    for name in ("record", "update"):
        command = sub.add_parser(
            name,
            help="save a new job"
            if name == "record"
            else "save the next snapshot of an existing job",
        )
        command.add_argument("--ledger", type=Path, required=True)
        command.add_argument("--input", type=Path, required=True)
    summary = sub.add_parser(
        "report", help="report latest job snapshots, including failures and unknowns"
    )
    summary.add_argument("--ledger", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == "template":
            output = template(args.job_id, args.title, args.agent)
        elif args.command == "report":
            if not args.ledger.exists():
                raise ValueError("ledger does not exist")
            _, latest = read_ledger(args.ledger)
            output = report(latest)
        else:
            record = json.loads(args.input.read_text(encoding="utf-8"))
            saved = save_record(args.ledger, record, update=args.command == "update")
            output = {
                "job_id": saved["job_id"],
                "revision": saved["revision"],
                "state": saved["state"],
            }
        print(json.dumps(output, indent=2, allow_nan=False))
    except (ValueError, OSError, TypeError) as exc:
        # Input can contain private content. Never echo it or a decoder's input excerpt.
        message = (
            "input is not valid JSON"
            if isinstance(exc, json.JSONDecodeError)
            else str(exc)
        )
        print(f"Cannot {args.command}: {message}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
