"""Bounded, private host activity for explicitly authorized jobs (protocol 1).

CLI: [--state-dir DIR] begin --job-id ID --title TITLE --platform claude|codex
(--session-id ID | --session-hash HASH) --repo-root PATH [--ui] [--deployable] [--trial-eligible]; bind
(or resume) --job-id ID --platform HOST (--session-id ID | --session-hash HASH); hook --platform HOST
[--installed-version 1]; status [--job-id ID]; trial-start [--target 10];
trial-report. --state-dir also works after the command. Begin is an operator's
explicit registration, not an authorization inferred from activity. Begin never
updates an existing job. Bind never changes its outcome or actual starting time.

Private state defaults to ~/.local/state/alethical-agent-jobs. jobs.jsonl is the
existing outcome ledger; events.sqlite3 is schema 1 with jobs (job_id, hashed
Git common directory, registered UTC), bindings (platform, SHA256 session ID,
job_id), events (job_id, protocol_version, platform, recognized hook_event_name,
SHA256 session/turn/tool_use/agent IDs, received UTC, optional deduplication key),
trials (id, started UTC, target), and trial_members (trial_id, position, job_id).
SHA256 hashes use purpose-separated strings. No payload contents or paths are
saved. SQLite serializes writers with a 1-second lock timeout; an unavailable or
invalid store causes a fixed safe warning rather than a traceback in a hook.

Hooks read at most 1 MiB. Bound sessions follow their job across directories.
Unbound sessions use Git common-directory identity only to detect a registered
repository, never to create a job or bind a session. Unsupported events and
unrelated sessions produce no output and do not create state. Hook stdout is
empty or host hook JSON with fixed additionalContext on SessionStart or
UserPromptSubmit. It never blocks, completes, continues, or relaunches work.

Deduplication uses tool-use IDs for tool events and turn/prompt IDs for prompt
submission. Other events remain separate observations: a stop hook can continue
and fire again within the same turn, and a helper may receive follow-up work.
Event presence does not establish full host coverage, a working result, help,
repeats, or AI cost.
Trial membership is assigned at begin, under the writer transaction, to the first
new explicitly eligible jobs after trial-start, including unfinished outcomes.
A crash after ledger publication but before sidecar commit leaves an unbound
started job. Bind with --repo-root repairs its binding, but cannot recover its
trial eligibility; it remains outside the cohort rather than being selected later.
Trial eligibility is an operator attestation of an approved low-risk job; neither
this helper nor a trial launches jobs, schedules work, or benchmarks models.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import re
import sqlite3
import subprocess
import sys
from collections import Counter
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

# Only this installed sibling is trusted; hook cwd and PYTHONPATH are not.
_spec = importlib.util.spec_from_file_location(
    "agent_job_outcomes", Path(__file__).resolve().parent / "agent_job_outcomes.py"
)
if _spec is None or _spec.loader is None:
    raise RuntimeError("Job outcome helper is unavailable")
outcomes = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = outcomes
_spec.loader.exec_module(outcomes)

PROTOCOL_VERSION = 1
MAX_INPUT_BYTES = 1024 * 1024
GIT_PATHS = ("/usr/bin/git", "/opt/homebrew/bin/git", "/usr/local/bin/git")
DEFAULT_STATE_DIR = Path.home() / ".local/state/alethical-agent-jobs"
DB_NAME = "events.sqlite3"
EVENT_NAMES = frozenset(
    {
        "SessionStart",
        "UserPromptSubmit",
        "PostToolUse",
        "PostToolUseFailure",
        "SubagentStart",
        "SubagentStop",
        "Stop",
        "StopFailure",
        "Interrupt",
        "SessionEnd",
    }
)
CONTEXT_EVENTS = frozenset({"SessionStart", "UserPromptSubmit"})
MISSING_CONTEXT = (
    "Job activity registration is missing for this session. Explicitly register "
    "the authorized job or bind this session to its existing job before working. "
    "Activity alone does not register or finish a job."
)
STALE_CONTEXT = (
    "The job activity hook installation is stale. Update the local installation "
    "before relying on recorded activity. Activity does not prove job completion."
)
ERROR_CONTEXT = (
    "Job activity could not be recorded safely. Repair the local job activity "
    "store before relying on it. Job outcomes were not changed by this hook."
)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def digest(kind: str, value: str) -> str:
    return hashlib.sha256(f"{kind}\0{value}".encode("utf-8")).hexdigest()


def safe_id(value: object) -> str | None:
    return value if isinstance(value, str) and 0 < len(value) <= 4096 else None


def job_id(value: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", value):
        raise ValueError("invalid job identity")
    return value


def repository_hash(path: object) -> str | None:
    if not isinstance(path, (str, Path)) or not str(path) or len(str(path)) > 4096:
        return None
    try:
        executable = next(
            (
                candidate
                for candidate in GIT_PATHS
                if Path(candidate).is_file() and os.access(candidate, os.X_OK)
            ),
            None,
        )
        if executable is None:
            return None
        result = subprocess.run(
            [executable, "-C", str(path), "rev-parse", "--git-common-dir"],
            capture_output=True,
            text=True,
            timeout=2,
            check=False,
        )
        if result.returncode or len(result.stdout) > 4096:
            return None
        common = Path(result.stdout.strip())
        if not common.is_absolute():
            common = Path(path) / common
        return digest("repository", str(common.resolve(strict=True)))
    except (OSError, ValueError, subprocess.SubprocessError):
        return None


def private_directory(path: Path) -> None:
    if path.is_symlink():
        raise ValueError("unsafe state location")
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(path, 0o700)
    for name in (DB_NAME, "jobs.jsonl", "jobs.jsonl.lock"):
        candidate = path / name
        if candidate.is_symlink():
            raise ValueError("unsafe state file")
        if candidate.exists():
            os.chmod(candidate, 0o600)


def initialize(connection: sqlite3.Connection) -> None:
    version = connection.execute("PRAGMA user_version").fetchone()[0]
    if version not in (0, PROTOCOL_VERSION):
        raise ValueError("unsupported state version")
    statements = (
        "CREATE TABLE IF NOT EXISTS jobs (job_id TEXT PRIMARY KEY, repo_hash TEXT NOT NULL, registered_at TEXT NOT NULL)",
        "CREATE TABLE IF NOT EXISTS bindings (platform TEXT NOT NULL, session_hash TEXT NOT NULL, job_id TEXT NOT NULL REFERENCES jobs(job_id), PRIMARY KEY(platform, session_hash))",
        "CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(job_id), protocol_version INTEGER NOT NULL, platform TEXT NOT NULL, hook_event_name TEXT NOT NULL, session_hash TEXT NOT NULL, turn_hash TEXT, tool_use_hash TEXT, agent_hash TEXT, received_at TEXT NOT NULL, dedupe_key TEXT UNIQUE)",
        "CREATE TABLE IF NOT EXISTS trials (id INTEGER PRIMARY KEY, started_at TEXT NOT NULL, target INTEGER NOT NULL)",
        "CREATE TABLE IF NOT EXISTS trial_members (trial_id INTEGER NOT NULL REFERENCES trials(id), position INTEGER NOT NULL, job_id TEXT NOT NULL UNIQUE REFERENCES jobs(job_id), PRIMARY KEY(trial_id, position))",
    )
    for statement in statements:
        connection.execute(statement)
    connection.execute(f"PRAGMA user_version = {PROTOCOL_VERSION}")


@contextmanager
def database(state_dir: Path, *, write: bool = False):
    path = state_dir / DB_NAME
    if state_dir.is_symlink() or path.is_symlink():
        raise ValueError("unsafe state location")
    if write:
        private_directory(state_dir)
        descriptor = os.open(path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        os.close(descriptor)
        os.chmod(path, 0o600)
        connection = sqlite3.connect(path, timeout=1)
    else:
        connection = sqlite3.connect(
            path.resolve().as_uri() + "?mode=ro", uri=True, timeout=1
        )
    connection.row_factory = sqlite3.Row
    try:
        connection.execute("PRAGMA foreign_keys = ON")
        if write:
            connection.execute("BEGIN IMMEDIATE")
            initialize(connection)
        elif (
            connection.execute("PRAGMA user_version").fetchone()[0] != PROTOCOL_VERSION
        ):
            raise ValueError("unsupported state version")
        yield connection
        if write:
            connection.commit()
    finally:
        connection.close()


def registration_session_hash(args: argparse.Namespace) -> str:
    supplied = getattr(args, "session_hash", None)
    if supplied is not None:
        if not re.fullmatch(r"[0-9a-f]{64}", supplied):
            raise ValueError("invalid session hash")
        return supplied
    session = safe_id(getattr(args, "session_id", None))
    if session is None:
        raise ValueError("invalid session identity")
    return digest("session", session)


def assert_rebind_allowed(
    connection: sqlite3.Connection,
    state_dir: Path,
    platform: str,
    session_hash: str,
    identity: str,
) -> None:
    previous = connection.execute(
        "SELECT job_id FROM bindings WHERE platform = ? AND session_hash = ?",
        (platform, session_hash),
    ).fetchone()
    if previous and previous["job_id"] != identity:
        _, latest = outcomes.read_ledger(state_dir / "jobs.jsonl")
        prior_job = latest.get(previous["job_id"])
        if prior_job is None or prior_job["state"] not in {"completed", "failed"}:
            raise ValueError("session still belongs to unfinished work")


def bind(
    connection: sqlite3.Connection,
    state_dir: Path,
    platform: str,
    session_hash: str,
    identity: str,
) -> None:
    if not re.fullmatch(r"[0-9a-f]{64}", session_hash):
        raise ValueError("invalid session hash")
    if not connection.execute(
        "SELECT 1 FROM jobs WHERE job_id = ?", (identity,)
    ).fetchone():
        raise ValueError("job is not registered")
    assert_rebind_allowed(connection, state_dir, platform, session_hash, identity)
    connection.execute(
        "INSERT INTO bindings VALUES (?, ?, ?) ON CONFLICT(platform, session_hash) DO UPDATE SET job_id=excluded.job_id",
        (platform, session_hash, identity),
    )


def load_binding(state_dir: Path, platform: str, session_id: str) -> str | None:
    """Read a binding without creating or modifying any private state."""
    with database(state_dir) as connection:
        row = connection.execute(
            "SELECT job_id FROM bindings WHERE platform = ? AND session_hash = ?",
            (platform, digest("session", session_id)),
        ).fetchone()
        return row["job_id"] if row else None


def begin(args: argparse.Namespace) -> dict:
    identity = job_id(args.job_id)
    session = registration_session_hash(args)
    repo_hash = repository_hash(args.repo_root)
    if (
        session is None
        or repo_hash is None
        or not args.title.strip()
        or len(args.title) > 1000
    ):
        raise ValueError("invalid registration")
    with database(args.state_dir, write=True) as connection:
        if connection.execute(
            "SELECT 1 FROM jobs WHERE job_id = ?", (identity,)
        ).fetchone():
            raise ValueError("existing job requires bind")
        assert_rebind_allowed(
            connection, args.state_dir, args.platform, session, identity
        )
        record = outcomes.template(identity, args.title, f"{args.platform}:{session}")
        record.update(
            state="in_progress",
            started_at=utc_now(),
            ui=args.ui,
            deployable=args.deployable,
        )
        # Publish the outcome before the sidecar commit. A crash may leave an
        # unbound job, never a falsely started binding. Bind repairs that case.
        outcomes.save_record(args.state_dir / "jobs.jsonl", record)
        os.chmod(args.state_dir / "jobs.jsonl", 0o600)
        connection.execute(
            "INSERT INTO jobs VALUES (?, ?, ?)",
            (identity, repo_hash, record["started_at"]),
        )
        bind(connection, args.state_dir, args.platform, session, identity)
        if args.trial_eligible:
            trial = connection.execute(
                "SELECT id, target FROM trials ORDER BY id DESC LIMIT 1"
            ).fetchone()
            if trial:
                size = connection.execute(
                    "SELECT COUNT(*) FROM trial_members WHERE trial_id = ?",
                    (trial["id"],),
                ).fetchone()[0]
                if size < trial["target"]:
                    connection.execute(
                        "INSERT INTO trial_members VALUES (?, ?, ?)",
                        (trial["id"], size + 1, identity),
                    )
    return {
        "job_id": identity,
        "state": "in_progress",
        "started_at": record["started_at"],
    }


def bind_existing(args: argparse.Namespace) -> dict:
    identity = job_id(args.job_id)
    with database(args.state_dir, write=True) as connection:
        _, latest = outcomes.read_ledger(args.state_dir / "jobs.jsonl")
        record = latest.get(identity)
        if record is None or record["started_at"] is None:
            raise ValueError("job has not started")
        # Existing ledger-only jobs need a repo identity supplied explicitly.
        if not connection.execute(
            "SELECT 1 FROM jobs WHERE job_id = ?", (identity,)
        ).fetchone():
            repo_hash = repository_hash(args.repo_root)
            if repo_hash is None:
                raise ValueError("unbound ledger job needs its repository")
            connection.execute(
                "INSERT INTO jobs VALUES (?, ?, ?)",
                (identity, repo_hash, record["started_at"]),
            )
        bind(
            connection,
            args.state_dir,
            args.platform,
            registration_session_hash(args),
            identity,
        )
    return {
        "job_id": identity,
        "state": record["state"],
        "started_at": record["started_at"],
    }


def context(event: str, text: str) -> dict | None:
    if not isinstance(event, str) or event not in CONTEXT_EVENTS:
        return None
    return {"hookSpecificOutput": {"hookEventName": event, "additionalContext": text}}


def registration_context(
    event: str, platform: str, session_hash: str, *, terminal: bool = False
) -> dict | None:
    text = MISSING_CONTEXT
    if terminal:
        text = "The previous job finished or failed. Explicitly register the next authorized job before working. Activity does not create a new job."
    return context(event, f"{text} Platform: {platform}. Session hash: {session_hash}.")


def hook(
    state_dir: Path, platform: str, payload: dict, installed_version: int | None = None
) -> dict | None:
    event = payload.get("hook_event_name")
    if not isinstance(event, str) or event not in EVENT_NAMES:
        return None
    session = safe_id(payload.get("session_id"))
    if session is None:
        return None
    if not (state_dir / DB_NAME).exists():
        return None
    session_hash = digest("session", session)
    with database(state_dir) as connection:
        bound = connection.execute(
            "SELECT job_id FROM bindings WHERE platform = ? AND session_hash = ?",
            (platform, session_hash),
        ).fetchone()
        if bound is None:
            repo_hash = repository_hash(payload.get("cwd"))
            related = (
                repo_hash
                and connection.execute(
                    "SELECT 1 FROM jobs WHERE repo_hash = ?", (repo_hash,)
                ).fetchone()
            )
            if not related:
                return None
            return (
                context(event, STALE_CONTEXT)
                if installed_version not in (None, PROTOCOL_VERSION)
                else registration_context(event, platform, session_hash)
            )
        if event in CONTEXT_EVENTS:
            _, latest = outcomes.read_ledger(state_dir / "jobs.jsonl")
            current = latest.get(bound["job_id"])
            if current is None:
                raise ValueError("bound job is unavailable")
            if current["state"] in {"completed", "failed"}:
                return registration_context(
                    event, platform, session_hash, terminal=True
                )
    hashes = {
        name: digest(name, value)
        if (
            value := safe_id(payload.get(name + "_id"))
            or (
                safe_id(payload.get("prompt_id"))
                if platform == "claude" and name == "turn"
                else None
            )
        )
        else None
        for name in ("turn", "tool_use", "agent")
    }
    # A turn ID cannot distinguish several tool calls in that same turn.
    identity_kind = {
        "PostToolUse": "tool_use",
        "PostToolUseFailure": "tool_use",
        "UserPromptSubmit": "turn",
    }.get(event)
    identity_hash = hashes.get(identity_kind) if identity_kind else None
    dedupe = (
        digest(
            "event",
            json.dumps([platform, session_hash, event, identity_kind, identity_hash]),
        )
        if identity_hash
        else None
    )
    with database(state_dir, write=True) as connection:
        connection.execute(
            "INSERT OR IGNORE INTO events (job_id, protocol_version, platform, hook_event_name, session_hash, turn_hash, tool_use_hash, agent_hash, received_at, dedupe_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                bound["job_id"],
                PROTOCOL_VERSION,
                platform,
                event,
                session_hash,
                hashes["turn"],
                hashes["tool_use"],
                hashes["agent"],
                utc_now(),
                dedupe,
            ),
        )
    return (
        context(event, STALE_CONTEXT)
        if installed_version not in (None, PROTOCOL_VERSION)
        else None
    )


def job_summary(record: dict, events: list[sqlite3.Row]) -> dict:
    return {
        "job_id": record["job_id"],
        "title": record["title"],
        "state": record["state"],
        "started_at": record["started_at"],
        "finished_at": record["finished_at"],
        "host_events": dict(
            sorted(Counter(event["hook_event_name"] for event in events).items())
        ),
        "host_events_by_platform": {
            platform: dict(
                sorted(
                    Counter(
                        event["hook_event_name"]
                        for event in events
                        if event["platform"] == platform
                    ).items()
                )
            )
            for platform in ("claude", "codex")
        },
        "platforms_observed": sorted({event["platform"] for event in events}),
        "event_observations": len(events),
        "events_without_deduplication_identity": sum(
            event["dedupe_key"] is None for event in events
        ),
        "human_interventions": record["human_interventions"],
        "repeats": record["repeats"],
        "ai_cost_usd": record["ai_cost_usd"],
    }


def status(state_dir: Path, identity: str | None = None) -> dict:
    _, latest = outcomes.read_ledger(state_dir / "jobs.jsonl")
    with database(state_dir) as connection:
        registered = {
            row["job_id"] for row in connection.execute("SELECT job_id FROM jobs")
        }
        selected = [
            record
            for key, record in latest.items()
            if identity is None or key == identity
        ]
        events = list(connection.execute("SELECT * FROM events"))
        return {
            "protocol_version": PROTOCOL_VERSION,
            "coverage": "Observed events only; complete host activity coverage is unknown",
            "completion_basis": "Outcome ledger attestations; host events never complete jobs",
            "jobs": [
                job_summary(
                    record,
                    [event for event in events if event["job_id"] == record["job_id"]],
                )
                | {"bound_registration_present": record["job_id"] in registered}
                for record in selected
            ],
        }


def trial_start(state_dir: Path, target: int) -> dict:
    if not 1 <= target <= 100:
        raise ValueError("invalid trial target")
    with database(state_dir, write=True) as connection:
        if connection.execute("SELECT 1 FROM trials").fetchone():
            raise ValueError("prospective trial already exists")
        started = utc_now()
        cursor = connection.execute(
            "INSERT INTO trials (started_at, target) VALUES (?, ?)", (started, target)
        )
        return {"trial_id": cursor.lastrowid, "started_at": started, "target": target}


def trial_report(state_dir: Path) -> dict:
    _, latest = outcomes.read_ledger(state_dir / "jobs.jsonl")
    with database(state_dir) as connection:
        trial = connection.execute(
            "SELECT * FROM trials ORDER BY id DESC LIMIT 1"
        ).fetchone()
        if trial is None:
            raise ValueError("prospective trial has not started")
        members = list(
            connection.execute(
                "SELECT position, job_id FROM trial_members WHERE trial_id = ? ORDER BY position",
                (trial["id"],),
            )
        )
        events = list(connection.execute("SELECT * FROM events"))
        return {
            "trial_id": trial["id"],
            "started_at": trial["started_at"],
            "target": trial["target"],
            "enrolled_jobs": len(members),
            "outcomes": outcomes.report(
                {member["job_id"]: latest[member["job_id"]] for member in members}
            ),
            "selection": "First newly registered explicitly eligible approved low-risk jobs; unfinished jobs included",
            "coverage": "Observed events only; full host coverage and model comparisons are unknown",
            "jobs": [
                job_summary(
                    latest[member["job_id"]],
                    [event for event in events if event["job_id"] == member["job_id"]],
                )
                | {"position": member["position"]}
                for member in members
            ],
        }


def read_payload(stream) -> dict:
    data = stream.read(MAX_INPUT_BYTES + 1)
    if len(data) > MAX_INPUT_BYTES:
        raise ValueError("oversized hook input")
    value = json.loads(data)
    if not isinstance(value, dict):
        raise ValueError("invalid hook input")
    return value


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description=__doc__)
    root.add_argument("--state-dir", type=Path, default=DEFAULT_STATE_DIR)
    commands = root.add_subparsers(dest="command", required=True)
    for name in (
        "begin",
        "bind",
        "resume",
        "hook",
        "status",
        "trial-start",
        "trial-report",
    ):
        command = commands.add_parser(name)
        command.add_argument("--state-dir", type=Path, default=argparse.SUPPRESS)
        if name in {"begin", "bind", "resume"}:
            command.add_argument("--job-id", required=True)
            command.add_argument(
                "--platform", choices=("claude", "codex"), required=True
            )
            session_group = command.add_mutually_exclusive_group(required=True)
            session_group.add_argument("--session-id")
            session_group.add_argument("--session-hash")
            command.add_argument("--repo-root", type=Path, required=name == "begin")
        if name == "begin":
            command.add_argument("--title", required=True)
            command.add_argument("--ui", action="store_true")
            command.add_argument("--deployable", action="store_true")
            command.add_argument("--trial-eligible", action="store_true")
        if name == "hook":
            command.add_argument(
                "--platform", choices=("claude", "codex"), required=True
            )
            command.add_argument("--installed-version", type=int)
        if name == "status":
            command.add_argument("--job-id", type=job_id)
        if name == "trial-start":
            command.add_argument("--target", type=int, default=10)
    return root


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    payload: dict = {}
    try:
        if args.command == "begin":
            output = begin(args)
        elif args.command in {"bind", "resume"}:
            output = bind_existing(args)
        elif args.command == "hook":
            payload = read_payload(getattr(sys.stdin, "buffer", sys.stdin))
            output = hook(
                args.state_dir, args.platform, payload, args.installed_version
            )
        elif args.command == "status":
            output = status(args.state_dir, args.job_id)
        elif args.command == "trial-start":
            output = trial_start(args.state_dir, args.target)
        else:
            output = trial_report(args.state_dir)
        if output is not None:
            print(json.dumps(output, sort_keys=True, allow_nan=False))
        return 0
    except (OSError, ValueError, TypeError, KeyError, sqlite3.Error, RecursionError):
        if args.command == "hook":
            print(ERROR_CONTEXT, file=sys.stderr)
            warning = context(payload.get("hook_event_name", ""), ERROR_CONTEXT)
            if warning:
                print(json.dumps(warning))
            return 0  # Observation must not block or change host decisions.
        print(
            "Job activity state is unavailable or the request is invalid.",
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
