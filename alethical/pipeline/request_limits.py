"""Shared source pacing, including cooldowns after a state's busy response.

Reservations use the database clock and commit before sleeping or requesting data.
This works across processes and transaction-pooled PostgreSQL connections.
"""

from __future__ import annotations

import time
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from typing import Any
from urllib.parse import urlsplit

import requests
from sqlalchemy import text

DEFAULT_SOURCE_REQUEST_INTERVAL_SECONDS = 0.5
MAX_COOLDOWN_SECONDS = 3600


def retry_after_seconds(value: str | None, *, now: datetime | None = None) -> float:
    if not value:
        return 1.0
    try:
        seconds = float(value)
    except ValueError:
        try:
            date = parsedate_to_datetime(value)
            seconds = (date - (now or datetime.now(UTC))).total_seconds()
        except (ValueError, TypeError, OverflowError):
            return 1.0
    return max(0.0, min(seconds, MAX_COOLDOWN_SECONDS))


class DatabaseRequestLimiter:
    def __init__(
        self,
        engine: Any,
        *,
        interval_seconds: float = DEFAULT_SOURCE_REQUEST_INTERVAL_SECONDS,
    ):
        if interval_seconds <= 0:
            raise ValueError("The source request interval must be positive")
        self.engine = engine
        self.interval_seconds = interval_seconds

    @staticmethod
    def key(url: str) -> str:
        hostname = (urlsplit(url).hostname or "").lower().removeprefix("www.")
        if not hostname:
            raise ValueError("A source request must have a hostname")
        return hostname

    def wait(self, url: str) -> None:
        # Re-check cooldown at the reserved instant. Another worker can receive
        # Retry-After while this worker is waiting for its previously reserved slot.
        while True:
            with self.engine.begin() as connection:
                seconds = connection.execute(
                    text("""
                    INSERT INTO source_request_limits(host, next_request_at, blocked_until)
                    VALUES (:host, clock_timestamp() + :interval * interval '1 second', clock_timestamp())
                    ON CONFLICT (host) DO UPDATE SET next_request_at =
                        GREATEST(source_request_limits.next_request_at,
                                 source_request_limits.blocked_until, clock_timestamp())
                        + :interval * interval '1 second'
                    RETURNING GREATEST(0, EXTRACT(EPOCH FROM
                        (next_request_at - :interval * interval '1 second' - clock_timestamp())))
                """),
                    {"host": self.key(url), "interval": self.interval_seconds},
                ).scalar_one()
            if seconds > 0:
                time.sleep(float(seconds))
            with self.engine.connect() as connection:
                blocked = connection.execute(
                    text("""
                    SELECT blocked_until > clock_timestamp()
                    FROM source_request_limits WHERE host = :host
                """),
                    {"host": self.key(url)},
                ).scalar_one()
            if not blocked:
                return

    def defer(self, url: str, seconds: float) -> None:
        with self.engine.begin() as connection:
            connection.execute(
                text("""
                INSERT INTO source_request_limits(host, next_request_at, blocked_until)
                VALUES (:host, clock_timestamp(), clock_timestamp() + :seconds * interval '1 second')
                ON CONFLICT (host) DO UPDATE SET blocked_until = GREATEST(
                    source_request_limits.blocked_until, EXCLUDED.blocked_until)
            """),
                {
                    "host": self.key(url),
                    "seconds": max(1.0, min(seconds, MAX_COOLDOWN_SECONDS)),
                },
            )


class RateLimitedSession:
    def __init__(self, session: requests.Session, limiter: DatabaseRequestLimiter):
        self.session = session
        self.limiter = limiter
        self.headers = session.headers

    def get(self, url: str, **kwargs: Any) -> requests.Response:
        self.limiter.wait(url)
        response = self.session.get(url, **kwargs)
        if response.status_code in {429, 503}:
            self.limiter.defer(
                url, retry_after_seconds(response.headers.get("Retry-After"))
            )
        return response

    def close(self) -> None:
        self.session.close()
