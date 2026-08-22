from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest
import requests
import sentry_sdk
from fastapi import HTTPException, Request

from alethical import monitoring
from alethical.api import problems
from alethical.api.routers import me
from alethical.pipeline import minnesota
from alethical.pipeline import oban as oban_pipeline
from scripts import check_bill_summary_coverage


def _request(path: str, route_template: str) -> Request:
    request = Request(
        {
            "type": "http",
            "method": "POST",
            "scheme": "https",
            "path": path,
            "raw_path": path.encode(),
            "query_string": b"private=words",
            "headers": [],
            "client": ("127.0.0.1", 1234),
            "server": ("api.alethical.com", 443),
        }
    )
    request.scope["route"] = SimpleNamespace(path=route_template)
    return request


def test_error_monitoring_stays_off_without_a_sentry_address(monkeypatch) -> None:
    monkeypatch.delenv("SENTRY_DSN", raising=False)
    monkeypatch.setattr(
        sentry_sdk,
        "init",
        lambda **kwargs: pytest.fail("Sentry should stay off without SENTRY_DSN"),
    )

    assert monitoring.configure_error_monitoring() is False


def test_error_monitoring_enables_only_private_error_events(monkeypatch) -> None:
    configured = {}
    monkeypatch.setenv("SENTRY_DSN", "https://public@example.ingest.sentry.io/123")
    monkeypatch.setenv("RAILWAY_ENVIRONMENT_NAME", "production")
    monkeypatch.setenv("RAILWAY_GIT_COMMIT_SHA", "abc123")
    monkeypatch.setattr(sentry_sdk, "init", lambda **kwargs: configured.update(kwargs))
    monitoring._configure_error_monitoring.cache_clear()

    assert monitoring.configure_error_monitoring() is True

    assert configured["environment"] == "production"
    assert configured["release"] == "abc123"
    assert configured["default_integrations"] is False
    assert configured["send_default_pii"] is False
    assert configured["include_local_variables"] is False
    assert configured["include_source_context"] is False
    assert configured["max_request_body_size"] == "never"
    assert configured["max_breadcrumbs"] == 0
    assert configured["enable_logs"] is False
    assert configured["enable_metrics"] is False
    assert configured["traces_sample_rate"] == 0.0
    assert callable(configured["before_send"])
    monitoring._configure_error_monitoring.cache_clear()


def test_sentry_event_removes_reader_data_before_sending() -> None:
    event = {
        "message": "Question: does this affect ada@example.com?",
        "logentry": {"message": "private chat text"},
        "request": {
            "url": "https://api.alethical.com/api/v1/me/chat/secret?q=private",
            "data": {"content": "my private question"},
            "headers": {"authorization": "Bearer secret"},
        },
        "user": {"id": "account-id", "email": "ada@example.com"},
        "breadcrumbs": [{"message": "private question"}],
        "extra": {"question": "private question"},
        "exception": {
            "values": [
                {
                    "type": "ProviderUnavailable",
                    "value": "request for ada@example.com failed: private question",
                    "stacktrace": {
                        "frames": [
                            {
                                "filename": "alethical/api/routers/me.py",
                                "function": "synthesize_grounded_answer",
                                "vars": {"question": "private question"},
                            }
                        ]
                    },
                }
            ]
        },
        "tags": {
            "alethical.area": "chat",
            "http.route": "/api/v1/me/chat-sessions/{chat_session_id}/messages",
        },
    }

    scrubbed = monitoring._privacy_before_send(event, {})
    serialized = json.dumps(scrubbed)

    assert scrubbed["exception"]["values"][0]["value"] == "ProviderUnavailable"
    assert scrubbed["tags"]["alethical.area"] == "chat"
    assert scrubbed["tags"]["http.route"].endswith("/{chat_session_id}/messages")
    assert "vars" not in scrubbed["exception"]["values"][0]["stacktrace"]["frames"][0]
    for private_value in (
        "ada@example.com",
        "private question",
        "Bearer secret",
        "account-id",
        "/chat/secret",
    ):
        assert private_value not in serialized


def test_one_failure_is_sent_once_with_only_named_safe_tags(monkeypatch) -> None:
    sent = []

    class _Scope:
        def __init__(self) -> None:
            self.tags = {}
            self.fingerprint = None

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return None

        def set_tag(self, key, value) -> None:
            self.tags[key] = value

    scope = _Scope()
    monkeypatch.setattr(monitoring, "configure_error_monitoring", lambda: True)
    monkeypatch.setattr(sentry_sdk, "new_scope", lambda: scope)
    monkeypatch.setattr(
        sentry_sdk,
        "capture_exception",
        lambda error: (
            sent.append((error, dict(scope.tags), scope.fingerprint)) or "event-id"
        ),
    )
    error = RuntimeError("the reader's private question")

    first = monitoring.capture_operational_error(
        error,
        area="chat",
        operation="provider-request",
        tags={"provider": "openai", "bill_key": "94-2025-HF719"},
    )
    second = monitoring.capture_operational_error(
        error,
        area="chat",
        operation="provider-request",
        tags={"provider": "openai", "bill_key": "94-2025-HF719"},
    )

    assert first is not None
    assert second is None
    assert len(sent) == 1
    assert scope.tags == {
        "alethical.area": "chat",
        "alethical.operation": "provider-request",
        "bill_key": "94-2025-HF719",
        "provider": "openai",
    }
    assert scope.fingerprint == ["{{ default }}", "chat", "provider-request"]
    assert "private question" not in json.dumps(scope.tags)


@pytest.mark.asyncio
async def test_server_errors_are_reported_with_a_route_pattern_not_the_real_address(
    monkeypatch,
) -> None:
    captured = []
    request = _request(
        "/api/v1/me/chat-sessions/private-session/messages",
        "/api/v1/me/chat-sessions/{chat_session_id}/messages",
    )
    request.state.failure_area = "chat"
    cause = RuntimeError("private reader text")
    error = HTTPException(status_code=502, detail="Answer service unavailable")
    error.__cause__ = cause
    monkeypatch.setattr(
        problems,
        "capture_operational_error",
        lambda exception, **kwargs: captured.append((exception, kwargs)),
    )

    response = await problems.http_exception_handler(request, error)

    assert response.status_code == 502
    assert captured == [
        (
            cause,
            {
                "area": "chat",
                "operation": "http-502",
                "tags": {
                    "http.method": "POST",
                    "http.route": "/api/v1/me/chat-sessions/{chat_session_id}/messages",
                    "http.status_code": "502",
                },
            },
        )
    ]
    assert "private-session" not in json.dumps(captured[0][1])


@pytest.mark.asyncio
async def test_expected_client_errors_do_not_create_alerts(monkeypatch) -> None:
    request = _request("/api/v1/me", "/api/v1/me")
    monkeypatch.setattr(
        problems,
        "capture_operational_error",
        lambda *args, **kwargs: pytest.fail("4xx requests should stay quiet"),
    )

    response = await problems.http_exception_handler(
        request, HTTPException(status_code=401, detail="Sign in required")
    )

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_unexpected_errors_are_reported_but_not_shown_to_the_reader(
    monkeypatch,
) -> None:
    captured = []
    request = _request("/api/v1/bills/private-value", "/api/v1/bills/{bill_id}")
    error = RuntimeError("database included private reader text")
    monkeypatch.setattr(
        problems,
        "capture_operational_error",
        lambda exception, **kwargs: captured.append((exception, kwargs)),
    )

    response = await problems.unexpected_exception_handler(request, error)

    assert response.status_code == 500
    assert captured[0][0] is error
    assert captured[0][1]["area"] == "server"
    assert captured[0][1]["tags"]["http.route"] == "/api/v1/bills/{bill_id}"
    assert b"private reader text" not in response.body
    assert b"unexpected error" in response.body.lower()


def test_chat_provider_failures_are_reported_without_the_question(monkeypatch) -> None:
    class _Chunk:
        citation_label = "Section 1"
        chunk_text = "Public bill text"

    captured = []
    monkeypatch.setenv("OPENAI_API_KEY", "test-openai-key")
    monkeypatch.delenv("OPENAI_RAG_CHAT_MODEL", raising=False)
    monkeypatch.setattr(
        me.requests,
        "post",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            requests.ConnectionError("reader question leaked here")
        ),
    )
    monkeypatch.setattr(
        me,
        "capture_operational_error",
        lambda exception, **kwargs: captured.append((exception, kwargs)),
    )

    with pytest.raises(HTTPException, match="RAG chat synthesis failed"):
        me.synthesize_grounded_answer(
            "my private question", [_Chunk()], bill_key="94-2025-HF719"
        )

    assert captured[0][1] == {
        "area": "chat",
        "operation": "provider-request",
        "tags": {"bill_key": "94-2025-HF719", "provider": "openai"},
    }
    assert "private question" not in json.dumps(captured[0][1])


def test_failed_ingestion_is_reported_with_public_run_labels(monkeypatch) -> None:
    captured = []
    run = SimpleNamespace(
        adapter="minnesota_live",
        target_type="bill",
        target_key="94-2025-HF719",
        status=None,
        finished_at=None,
        stats=None,
        error_text=None,
    )
    pipeline = minnesota.MinnesotaIngestionPipeline.__new__(
        minnesota.MinnesotaIngestionPipeline
    )
    monkeypatch.setattr(
        minnesota,
        "capture_operational_error",
        lambda exception, **kwargs: captured.append((exception, kwargs)),
    )
    error = RuntimeError("provider response body")

    pipeline.fail_run(run, error, {"records": 0})

    assert run.status == minnesota.IngestionStatus.failed
    assert captured == [
        (
            error,
            {
                "area": "ingestion",
                "operation": "run-failed",
                "tags": {
                    "ingestion.adapter": "minnesota_live",
                    "ingestion.target_key": "94-2025-HF719",
                    "ingestion.target_type": "bill",
                },
            },
        )
    ]


def test_failed_queued_ingestion_creates_one_summary_alert(monkeypatch) -> None:
    captured = []
    monkeypatch.setattr(
        oban_pipeline,
        "capture_operational_error",
        lambda exception, **kwargs: captured.append((exception, kwargs)),
    )

    oban_pipeline.report_drain_failures(
        "source_sync", {"completed": 18, "retryable": 2, "discarded": 1}
    )

    assert captured[0][1] == {
        "area": "ingestion",
        "operation": "queue-drain-failed",
        "tags": {
            "ingestion.discarded": "1",
            "ingestion.queue": "source_sync",
            "ingestion.retryable": "2",
        },
    }


def test_successful_queue_drain_stays_quiet(monkeypatch) -> None:
    monkeypatch.setattr(
        oban_pipeline,
        "capture_operational_error",
        lambda *args, **kwargs: pytest.fail("successful jobs should stay quiet"),
    )

    oban_pipeline.report_drain_failures(
        "source_sync", {"completed": 20, "retryable": 0, "discarded": 0}
    )


@pytest.mark.asyncio
async def test_queue_drain_command_reports_its_failed_jobs(monkeypatch) -> None:
    class _Pool:
        async def close(self) -> None:
            return None

    async def _open_pool(dsn: str):
        assert dsn == "postgresql://test"
        return _Pool()

    async def _drain_queue(**kwargs):
        return {"completed": 18, "retryable": 2, "discarded": 1}

    reported = []
    monkeypatch.setattr(oban_pipeline, "open_pool", _open_pool)
    monkeypatch.setattr(oban_pipeline, "Oban", lambda **kwargs: object())
    monkeypatch.setattr(oban_pipeline, "drain_queue", _drain_queue)
    monkeypatch.setattr(
        oban_pipeline,
        "report_drain_failures",
        lambda queue, result: reported.append((queue, result)),
    )

    await oban_pipeline.drain(
        SimpleNamespace(
            dsn="postgresql://test", target="local", queue="source_sync", concurrency=1
        )
    )

    assert reported == [
        (
            "source_sync",
            {"completed": 18, "retryable": 2, "discarded": 1},
        )
    ]


@pytest.mark.asyncio
async def test_ai_summary_drain_recovers_committed_ready_requests_first(
    monkeypatch,
) -> None:
    events: list[str] = []

    class _Pool:
        async def close(self) -> None:
            events.append("close")

    async def _reconcile(**kwargs):
        assert kwargs == {
            "database_target": "local",
            "oban_target": "local",
            "oban_dsn": "postgresql://test",
        }
        events.append("reconcile")
        return [{"inserted": True}]

    async def _open_pool(dsn: str):
        assert dsn == "postgresql://test"
        events.append("open")
        return _Pool()

    async def _drain_queue(**_kwargs):
        events.append("drain")
        return {"completed": 1, "retryable": 0, "discarded": 0}

    monkeypatch.setattr(
        "alethical.pipeline.bill_summary_requests.reconcile_ready_requests",
        _reconcile,
    )
    monkeypatch.setattr(oban_pipeline, "open_pool", _open_pool)
    monkeypatch.setattr(oban_pipeline, "Oban", lambda **kwargs: object())
    monkeypatch.setattr(oban_pipeline, "drain_queue", _drain_queue)

    await oban_pipeline.drain(
        SimpleNamespace(
            dsn="postgresql://test",
            target="local",
            queue="ai_summary",
            concurrency=1,
        )
    )

    assert events == ["reconcile", "open", "drain", "close"]


@pytest.mark.asyncio
async def test_completed_ai_summary_job_does_not_hide_a_ready_request() -> None:
    captured_states: list[list[str]] = []

    class _Cursor:
        async def fetchone(self):
            return None

    class _Connection:
        async def execute(self, _sql, parameters):
            captured_states.append(parameters[3])
            return _Cursor()

    class _ConnectionContext:
        async def __aenter__(self):
            return _Connection()

        async def __aexit__(self, *_args):
            return None

    class _Pool:
        def connection(self):
            return _ConnectionContext()

    pool = _Pool()
    await oban_pipeline.existing_job_id(
        pool,
        worker="BillSummaryRequestWorker",
        queue="ai_summary",
        task_key="bill-summary-request:test",
    )
    await oban_pipeline.existing_job_id(
        pool,
        worker="BillSyncChunkWorker",
        queue="bill_sync",
        task_key="bill-sync:test",
    )

    assert "completed" not in captured_states[0]
    assert "completed" in captured_states[1]


def test_summary_gap_alert_is_bounded_but_keeps_the_full_report() -> None:
    gaps = [
        SimpleNamespace(
            bill_key=f"94-2026-HF{number}",
            request_status="outdated_prompt_context",
            source_text_fingerprint=f"{number:064x}"[-64:],
        )
        for number in range(10_000)
    ]

    issue_report = check_bill_summary_coverage.issue_report(gaps)

    assert len(issue_report) < 50_000
    assert "SUMMARY GAPS: 10000" in issue_report
    assert "94-2026-HF0" in issue_report
    assert "9,900 more gaps are in the attached workflow report" in issue_report

    workflow = Path(".github/workflows/bill-summary-coverage.yml").read_text(
        encoding="utf-8"
    )
    assert "--issue-report-path summary-issue-report.txt" in workflow
    assert "actions/upload-artifact@" in workflow
    assert "report=$(cat summary-issue-report.txt" in workflow
    assert 'echo "result=gaps" >> "$GITHUB_OUTPUT"' in workflow
    assert "steps.summary_check.outputs.result == 'gaps'" in workflow
    assert "steps.summary_check.outputs.result != 'gaps'" in workflow
