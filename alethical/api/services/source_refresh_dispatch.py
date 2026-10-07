"""Wake fixed public-record workflows without collecting records in the API.

GitHub cron is a backup clock. This small dispatcher reads durable due dates and
uses a dedicated App installation token restricted to this repository and Actions
write. It never accepts a workflow, branch, command, or credential from a request.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
import os
import uuid

import httpx
import jwt
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from alethical.db.models import SourceRefreshState
from alethical.pipeline.record_refresh import _next_due_at, due_names, jobs

API = "https://api.github.com"
REPOSITORY = "alethical-org/alethical"
REPOSITORY_ID = 1188303032
WORKFLOW = "source-record-refresh.yml"
COOLDOWN = timedelta(minutes=30)
FAILURE_COOLDOWN = timedelta(minutes=5)
LEASE = timedelta(minutes=5)


@dataclass(frozen=True)
class AppConfig:
    app_id: str
    installation_id: str
    private_key: str = field(repr=False)


def configuration() -> AppConfig | None:
    if os.getenv("ALETHICAL_SOURCE_REFRESH_DISPATCH_ENABLED", "").lower() != "true":
        return None
    app_id = os.getenv("ALETHICAL_SOURCE_REFRESH_APP_ID", "")
    installation = os.getenv("ALETHICAL_SOURCE_REFRESH_INSTALLATION_ID", "")
    key = os.getenv("ALETHICAL_SOURCE_REFRESH_PRIVATE_KEY", "")
    if not app_id.isdigit() or not installation.isdigit() or not key.strip():
        raise ValueError("Source refresh App configuration is incomplete")
    return AppConfig(app_id, installation, key)


def _headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2026-03-10",
    }


def installation_token(client: httpx.Client, config: AppConfig, now: datetime) -> str:
    signed = jwt.encode(
        {
            "iat": int(now.timestamp()) - 60,
            "exp": int(now.timestamp()) + 540,
            "iss": config.app_id,
        },
        config.private_key,
        algorithm="RS256",
    )
    response = client.post(
        f"{API}/app/installations/{config.installation_id}/access_tokens",
        headers=_headers(signed),
        json={"repository_ids": [REPOSITORY_ID], "permissions": {"actions": "write"}},
    )
    if response.status_code != 201:
        raise ValueError("GitHub rejected the dedicated App credential")
    body = response.json()
    if not isinstance(body, dict):
        raise ValueError("GitHub returned an invalid installation response")
    permissions = body.get("permissions", {})
    if (
        not isinstance(permissions, dict)
        or permissions.get("actions") != "write"
        or any(k not in {"actions", "metadata"} for k in permissions)
        or permissions.get("metadata", "read") != "read"
        or not isinstance(body.get("token"), str)
        or not body["token"]
    ):
        raise ValueError("GitHub returned unexpected installation permissions")
    return body["token"]


def _claim(db, name: str, now: datetime) -> uuid.UUID | None:
    job = jobs(now)[name]
    source = db.get(SourceRefreshState, name)
    if source and (
        _next_due_at(source, job) > now
        or (source.lease_expires_at and source.lease_expires_at > now)
    ):
        return None
    if job.lane:
        lane = db.get(SourceRefreshState, f"lane:{job.lane}")
        if lane and lane.lease_expires_at and lane.lease_expires_at > now:
            return None
    key = f"dispatch:{name}"
    db.execute(
        insert(SourceRefreshState)
        .values(name=key, next_due_at=now, failures=0)
        .on_conflict_do_nothing(index_elements=["name"])
    )
    row = db.scalar(
        select(SourceRefreshState)
        .where(SourceRefreshState.name == key)
        .with_for_update()
    )
    if row.next_due_at > now or (row.lease_expires_at and row.lease_expires_at > now):
        db.commit()
        return None
    token = uuid.uuid4()
    row.token = token
    row.lease_expires_at = now + LEASE
    row.last_started_at = now
    db.commit()
    return token


def _finish(
    db, name: str, token: uuid.UUID, now: datetime, accepted: bool, run_id: int | None
) -> None:
    row = db.scalar(
        select(SourceRefreshState)
        .where(SourceRefreshState.name == f"dispatch:{name}")
        .with_for_update()
    )
    if row is None or row.token != token:
        db.rollback()
        return
    row.token = None
    row.lease_expires_at = None
    row.last_finished_at = now
    row.last_status = "dispatched" if accepted else "dispatch_failed"
    row.next_due_at = now + (COOLDOWN if accepted else FAILURE_COOLDOWN)
    if accepted:
        row.last_dispatched_at = now
        row.failures = 0
        row.progress = {"workflow_run_id": run_id} if run_id else {}
    else:
        row.failures += 1
    db.commit()


def dispatch_due(
    session_factory,
    *,
    now: datetime | None = None,
    client: httpx.Client | None = None,
    stop_event=None,
    max_dispatches: int = 3,
) -> list[dict]:
    """One bounded sweep. Call off the API event loop, about once per minute.

    Accepted means queued at GitHub, never collected or published. An ambiguous
    response waits through the failure cooldown before retrying; collector leases
    make that retry safe if GitHub accepted the first request.
    """
    config = configuration()
    if config is None:
        return []
    now = now or datetime.now(UTC)
    if client is None:
        with httpx.Client(timeout=10, follow_redirects=False) as owned_client:
            return dispatch_due(
                session_factory,
                now=now,
                client=owned_client,
                stop_event=stop_event,
                max_dispatches=max_dispatches,
            )
    result = []
    access_token = None
    with session_factory() as db:
        due = due_names(db, now=now)
    for name in due:
        if len(result) >= max_dispatches or (stop_event and stop_event.is_set()):
            break
        with session_factory() as db:
            claim = _claim(db, name, now)
        if claim is None:
            continue
        accepted, run_id = False, None
        try:
            if access_token is None:
                access_token = installation_token(client, config, now)
            response = client.post(
                f"{API}/repos/{REPOSITORY}/actions/workflows/{WORKFLOW}/dispatches",
                headers=_headers(access_token),
                json={"ref": "main", "inputs": {"job": name}},
            )
            accepted = response.status_code in (200, 204)
            if response.status_code == 200:
                body = response.json()
                value = body.get("workflow_run_id") if isinstance(body, dict) else None
                run_id = value if type(value) is int and value > 0 else None
        except (httpx.HTTPError, ValueError, jwt.PyJWTError):
            # Exception bodies may contain credentials or response contents.
            # Durable status is enough for the operational monitor.
            pass
        with session_factory() as db:
            _finish(db, name, claim, now, accepted, run_id)
        result.append(
            {"job": name, "status": "dispatched" if accepted else "dispatch_failed"}
        )
    return result
