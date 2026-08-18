"""Privacy-safe production error reporting.

Sentry receives only errors this module sends deliberately. Framework hooks,
request bodies, log records, performance traces, and local variable snapshots
stay off so a reader's question or account details cannot become a second copy.
"""

from __future__ import annotations

from functools import lru_cache
import os
from typing import Any, Mapping

import sentry_sdk

_REPORTED_ATTRIBUTE = "_alethical_error_reported"
_SAFE_TAG_KEYS = frozenset(
    {
        "bill_key",
        "http.method",
        "http.route",
        "http.status_code",
        "ingestion.adapter",
        "ingestion.discarded",
        "ingestion.queue",
        "ingestion.retryable",
        "ingestion.target_key",
        "ingestion.target_type",
        "provider",
    }
)


def _privacy_before_send(event: dict[str, Any], hint: dict[str, Any]) -> dict[str, Any]:
    """Keep the error type and stack, and remove every reader-data carrier."""
    del hint
    for key in ("breadcrumbs", "extra", "logentry", "message", "request", "user"):
        event.pop(key, None)

    exception = event.get("exception")
    values = exception.get("values", []) if isinstance(exception, dict) else []
    for value in values:
        if not isinstance(value, dict):
            continue
        # Exception messages can contain provider replies, database parameters,
        # typed questions, or email addresses. The class and stack are enough to
        # group the event and find the broken line.
        value["value"] = value.get("type") or "Error"
        stacktrace = value.get("stacktrace")
        frames = stacktrace.get("frames", []) if isinstance(stacktrace, dict) else []
        for frame in frames:
            if isinstance(frame, dict):
                frame.pop("vars", None)
    return event


@lru_cache(maxsize=8)
def _configure_error_monitoring(
    dsn: str | None, environment: str, release: str | None
) -> bool:
    if not dsn:
        return False
    sentry_sdk.init(
        dsn=dsn,
        environment=environment,
        release=release,
        default_integrations=False,
        auto_enabling_integrations=False,
        send_default_pii=False,
        include_local_variables=False,
        include_source_context=False,
        max_request_body_size="never",
        max_breadcrumbs=0,
        enable_logs=False,
        enable_metrics=False,
        auto_session_tracking=False,
        send_client_reports=False,
        propagate_traces=False,
        traces_sample_rate=0.0,
        before_send=_privacy_before_send,
        server_name="alethical-api",
    )
    return True


def configure_error_monitoring() -> bool:
    """Enable Sentry when its project address is present; otherwise do nothing."""
    return _configure_error_monitoring(
        os.environ.get("SENTRY_DSN"),
        os.environ.get("RAILWAY_ENVIRONMENT_NAME", "local"),
        os.environ.get("RAILWAY_GIT_COMMIT_SHA"),
    )


def error_was_reported(error: Exception) -> bool:
    return bool(getattr(error, _REPORTED_ATTRIBUTE, False))


def capture_operational_error(
    error: Exception,
    *,
    area: str,
    operation: str,
    tags: Mapping[str, str] | None = None,
) -> str | None:
    """Send one failure with a small allowlist of public operational labels."""
    if error_was_reported(error) or not configure_error_monitoring():
        return None
    try:
        setattr(error, _REPORTED_ATTRIBUTE, True)
    except Exception:
        pass

    with sentry_sdk.new_scope() as scope:
        scope.set_tag("alethical.area", area)
        scope.set_tag("alethical.operation", operation)
        for key, value in sorted((tags or {}).items()):
            if key in _SAFE_TAG_KEYS:
                scope.set_tag(key, value[:200])
        scope.fingerprint = ["{{ default }}", area, operation]
        return sentry_sdk.capture_exception(error)


def send_verification_event() -> str | None:
    """Send one synthetic event after setup, with no request or reader attached."""
    return capture_operational_error(
        RuntimeError("Alethical monitoring verification"),
        area="monitoring",
        operation="verification",
    )


if __name__ == "__main__":
    event_id = send_verification_event()
    if event_id is None:
        raise SystemExit("SENTRY_DSN is not set; no verification event was sent")
    sentry_sdk.flush(timeout=5)
    print(f"Sent Sentry verification event {event_id}")
