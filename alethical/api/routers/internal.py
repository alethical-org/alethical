from __future__ import annotations

import html
import json
import os
import secrets

from fastapi import APIRouter, Depends, Header, Query
from fastapi.responses import HTMLResponse
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from alethical.api.problems import problem_exception
from alethical.db.schema import load_schema
from alethical.db.session import get_db

schema = load_schema()
IngestionRun = schema.IngestionRun

router = APIRouter()


def require_internal_token(x_internal_token: str | None = Header(default=None)):
    expected = os.environ.get("INTERNAL_API_TOKEN", "dev-internal-token")
    # Use secrets.compare_digest to prevent timing attacks
    if not x_internal_token or not secrets.compare_digest(x_internal_token, expected):
        raise problem_exception(401, "Unauthorized", "Valid internal token required")


def require_internal_dashboard_token(
    x_internal_token: str | None = Header(default=None),
    token: str | None = Query(default=None),
):
    expected = os.environ.get("INTERNAL_API_TOKEN", "dev-internal-token")
    # Use secrets.compare_digest to prevent timing attacks
    # Note: Using tokens in query parameters is generally discouraged as they may leak in logs
    is_valid_header = x_internal_token and secrets.compare_digest(
        x_internal_token, expected
    )
    is_valid_query = token and secrets.compare_digest(token, expected)

    if not is_valid_header and not is_valid_query:
        raise problem_exception(401, "Unauthorized", "Valid internal token required")


@router.get("/ingestion-runs")
def ingestion_runs(_=Depends(require_internal_token), db: Session = Depends(get_db)):
    rows = db.scalars(
        select(IngestionRun).order_by(IngestionRun.started_at.desc())
    ).all()
    data = [
        {
            "id": str(row.id),
            "adapter": row.adapter,
            "target_type": row.target_type,
            "target_key": row.target_key,
            "status": row.status.value,
            "started_at": row.started_at,
            "finished_at": row.finished_at,
        }
        for row in rows
    ]
    return {
        "data": data,
        "page": {"limit": len(data), "next_cursor": None, "has_more": False},
    }


def _jsonable(value):
    try:
        json.dumps(value)
        return value
    except TypeError:
        return str(value)


def _decode_oban_return(meta: dict | None):
    if not isinstance(meta, dict) or not meta.get("return"):
        return None
    try:
        from oban._recorded import decode_recorded

        return _jsonable(decode_recorded(meta["return"]))
    except Exception as exc:  # pragma: no cover - defensive around private oban API
        return {"decode_error": str(exc), "raw": meta.get("return")}


def _pretty_json(value) -> str:
    if value is None:
        return ""
    return html.escape(json.dumps(value, indent=2, sort_keys=True, default=str))


def _load_oban_dashboard_data(
    db: Session, *, state: str | None, queue: str | None, limit: int
):
    exists = db.execute(
        text("select to_regclass('public.oban_jobs') is not null")
    ).scalar()
    if not exists:
        return {
            "installed": False,
            "counts_by_state": [],
            "counts_by_queue": [],
            "jobs": [],
        }

    filters = []
    params: dict[str, object] = {"limit": limit}
    if state:
        filters.append("state = :state")
        params["state"] = state
    if queue:
        filters.append("queue = :queue")
        params["queue"] = queue
    where = f"where {' and '.join(filters)}" if filters else ""

    counts_by_state = db.execute(
        text(
            """
            select state::text as state, count(*)::int as count
            from oban_jobs
            group by state
            order by count desc, state
            """
        )
    ).mappings()
    counts_by_queue = db.execute(
        text(
            """
            select queue, state::text as state, count(*)::int as count
            from oban_jobs
            group by queue, state
            order by queue, state
            """
        )
    ).mappings()
    jobs = db.execute(
        text(
            f"""
            select
              id,
              state::text as state,
              queue,
              worker,
              args,
              meta,
              errors,
              attempt,
              max_attempts,
              inserted_at,
              scheduled_at,
              attempted_at,
              completed_at,
              cancelled_at,
              discarded_at
            from oban_jobs
            {where}
            order by inserted_at desc, id desc
            limit :limit
            """
        ),
        params,
    ).mappings()
    job_data = []
    for row in jobs:
        row_dict = dict(row)
        row_dict["return"] = _decode_oban_return(row_dict.get("meta"))
        job_data.append(row_dict)
    return {
        "installed": True,
        "counts_by_state": [dict(row) for row in counts_by_state],
        "counts_by_queue": [dict(row) for row in counts_by_queue],
        "jobs": job_data,
    }


@router.get("/oban/jobs")
def oban_jobs(
    _=Depends(require_internal_token),
    db: Session = Depends(get_db),
    state: str | None = None,
    queue: str | None = None,
    limit: int = Query(default=50, ge=1, le=200),
):
    data = _load_oban_dashboard_data(db, state=state, queue=queue, limit=limit)
    return {"data": data}


def _pill(label: str, value: int, href: str = "") -> str:
    body = (
        f"<strong>{html.escape(str(value))}</strong><span>{html.escape(label)}</span>"
    )
    if href:
        return f'<a class="pill" href="{html.escape(href)}">{body}</a>'
    return f'<div class="pill">{body}</div>'


def _render_job_row(job: dict) -> str:
    task_key = ""
    args = job.get("args")
    if isinstance(args, dict):
        task_key = str(args.get("task_key") or args.get("job_key") or "")
    worker = str(job.get("worker") or "").split(".")[-1]
    timestamps = [
        ("inserted", job.get("inserted_at")),
        ("scheduled", job.get("scheduled_at")),
        ("attempted", job.get("attempted_at")),
        ("completed", job.get("completed_at")),
        ("cancelled", job.get("cancelled_at")),
        ("discarded", job.get("discarded_at")),
    ]
    timestamp_markup = "".join(
        f"<dt>{label}</dt><dd>{html.escape(str(value))}</dd>"
        for label, value in timestamps
        if value
    )
    details = f"""
      <details>
        <summary>details</summary>
        <div class="details-grid">
          <section><h3>Args</h3><pre>{_pretty_json(job.get("args"))}</pre></section>
          <section><h3>Return</h3><pre>{_pretty_json(job.get("return"))}</pre></section>
          <section><h3>Errors</h3><pre>{_pretty_json(job.get("errors"))}</pre></section>
        </div>
      </details>
    """
    return f"""
      <tr>
        <td class="mono">#{job["id"]}</td>
        <td><span class="state state-{html.escape(str(job["state"]))}">{html.escape(str(job["state"]))}</span></td>
        <td>{html.escape(str(job["queue"]))}</td>
        <td>{html.escape(worker)}</td>
        <td class="mono task">{html.escape(task_key)}</td>
        <td>{html.escape(str(job["attempt"]))}/{html.escape(str(job["max_attempts"]))}</td>
        <td><dl>{timestamp_markup}</dl></td>
        <td>{details}</td>
      </tr>
    """


@router.get("/oban", response_class=HTMLResponse)
def oban_dashboard(
    _=Depends(require_internal_dashboard_token),
    db: Session = Depends(get_db),
    token: str | None = None,
    state: str | None = None,
    queue: str | None = None,
    limit: int = Query(default=50, ge=1, le=200),
):
    data = _load_oban_dashboard_data(db, state=state, queue=queue, limit=limit)
    if not data["installed"]:
        body = """
          <main>
            <h1>Oban Jobs</h1>
            <p class="empty">The Oban schema is not installed in this database yet.</p>
          </main>
        """
    else:
        token_param = f"&token={html.escape(token)}" if token else ""
        states = "".join(
            _pill(
                str(row["state"]),
                int(row["count"]),
                f"/internal/v1/oban?state={row['state']}&limit={limit}{token_param}",
            )
            for row in data["counts_by_state"]
        )
        queues = "".join(
            _pill(
                f"{row['queue']} / {row['state']}",
                int(row["count"]),
                f"/internal/v1/oban?queue={row['queue']}&state={row['state']}&limit={limit}{token_param}",
            )
            for row in data["counts_by_queue"]
        )
        rows = "".join(_render_job_row(job) for job in data["jobs"])
        rows = (
            rows
            or '<tr><td colspan="8" class="empty">No jobs match this filter.</td></tr>'
        )
        active_filters = " ".join(
            part
            for part in [
                f"state={html.escape(state)}" if state else "",
                f"queue={html.escape(queue)}" if queue else "",
            ]
            if part
        )
        body = f"""
          <main>
            <header>
              <div>
                <p class="eyebrow">Alethical Pipeline</p>
                <h1>Oban Jobs</h1>
              </div>
              <a class="button" href="/internal/v1/oban?limit={limit}{token_param}">Clear filters</a>
            </header>
            <p class="muted">Auto-refreshes every 10 seconds. {active_filters}</p>
            <section>
              <h2>States</h2>
              <div class="pills">{states}</div>
            </section>
            <section>
              <h2>Queues</h2>
              <div class="pills">{queues}</div>
            </section>
            <section>
              <h2>Recent Jobs</h2>
              <div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>State</th>
                      <th>Queue</th>
                      <th>Worker</th>
                      <th>Task key</th>
                      <th>Attempts</th>
                      <th>Timestamps</th>
                      <th>Payload</th>
                    </tr>
                  </thead>
                  <tbody>{rows}</tbody>
                </table>
              </div>
            </section>
          </main>
        """
    return HTMLResponse(
        f"""
        <!doctype html>
        <html lang="en">
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <meta http-equiv="refresh" content="10">
            <title>Oban Jobs</title>
            <style>
              :root {{
                color-scheme: light;
                font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                background: #f6f7f9;
                color: #1f2933;
              }}
              body {{ margin: 0; }}
              main {{ max-width: 1280px; margin: 0 auto; padding: 32px 24px 56px; }}
              header {{ display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 10px; }}
              h1 {{ margin: 0; font-size: 28px; letter-spacing: 0; }}
              h2 {{ margin: 28px 0 12px; font-size: 16px; letter-spacing: 0; }}
              h3 {{ margin: 0 0 8px; font-size: 13px; }}
              .eyebrow {{ margin: 0 0 4px; color: #667085; font-size: 13px; font-weight: 700; text-transform: uppercase; }}
              .muted, .empty {{ color: #667085; }}
              .button, .pill {{ border: 1px solid #d0d5dd; border-radius: 8px; background: #fff; color: inherit; text-decoration: none; }}
              .button {{ padding: 9px 12px; font-size: 14px; }}
              .pills {{ display: flex; flex-wrap: wrap; gap: 10px; }}
              .pill {{ display: inline-flex; align-items: baseline; gap: 8px; padding: 10px 12px; }}
              .pill strong {{ font-size: 18px; }}
              .pill span {{ color: #475467; font-size: 13px; }}
              .table-wrap {{ overflow-x: auto; border: 1px solid #d0d5dd; border-radius: 8px; background: #fff; }}
              table {{ width: 100%; border-collapse: collapse; min-width: 1120px; }}
              th, td {{ padding: 12px; border-bottom: 1px solid #eaecf0; text-align: left; vertical-align: top; font-size: 13px; }}
              th {{ color: #475467; background: #f9fafb; font-size: 12px; text-transform: uppercase; }}
              tr:last-child td {{ border-bottom: 0; }}
              .mono {{ font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }}
              .task {{ max-width: 260px; overflow-wrap: anywhere; }}
              .state {{ display: inline-flex; border-radius: 999px; padding: 3px 8px; font-size: 12px; font-weight: 700; background: #eef2ff; color: #3538cd; }}
              .state-completed {{ background: #ecfdf3; color: #027a48; }}
              .state-executing, .state-available, .state-retryable, .state-scheduled {{ background: #fffaeb; color: #b54708; }}
              .state-discarded, .state-cancelled {{ background: #fef3f2; color: #b42318; }}
              dl {{ display: grid; grid-template-columns: 70px minmax(180px, 1fr); gap: 3px 8px; margin: 0; }}
              dt {{ color: #667085; }}
              dd {{ margin: 0; }}
              details summary {{ cursor: pointer; color: #175cd3; }}
              .details-grid {{ display: grid; grid-template-columns: repeat(3, minmax(260px, 1fr)); gap: 12px; margin-top: 10px; }}
              pre {{ overflow: auto; max-height: 280px; margin: 0; padding: 10px; border-radius: 8px; background: #101828; color: #f9fafb; font-size: 12px; }}
            </style>
          </head>
          <body>{body}</body>
        </html>
        """
    )
