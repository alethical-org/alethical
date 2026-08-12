"""One polite request pace shared by concurrent Minnesota source workers."""

from __future__ import annotations

from typing import Any, Protocol

from sqlalchemy import text

SOURCE_REQUEST_LOCK_KEY = 61031226313231
DEFAULT_SOURCE_REQUEST_INTERVAL_SECONDS = 0.25


class RequestLimiter(Protocol):
    def wait(self) -> None: ...


class DatabaseRequestLimiter:
    """Space source requests across every process using the same database."""

    def __init__(
        self,
        bind: Any,
        *,
        interval_seconds: float,
        lock_key: int = SOURCE_REQUEST_LOCK_KEY,
    ) -> None:
        if interval_seconds < 0:
            raise ValueError("request interval cannot be negative")
        self._bind = bind
        self.interval_seconds = interval_seconds
        self.lock_key = lock_key

    def wait(self) -> None:
        if self.interval_seconds == 0:
            return
        # Production uses a transaction-pooling database connection. A
        # transaction-scoped lock is therefore the only lock guaranteed to stay
        # attached to this request from acquisition through release.
        with self._bind.begin() as connection:
            connection.execute(
                text("select pg_advisory_xact_lock(:lock_key)"),
                {"lock_key": self.lock_key},
            )
            # Sleeping while the shared lock is held makes request starts at
            # least this far apart, including workers in separate processes.
            connection.execute(
                text("select pg_sleep(:interval_seconds)"),
                {"interval_seconds": self.interval_seconds},
            )


class RateLimitedSession:
    """A requests-compatible session whose GET calls share one limiter."""

    def __init__(self, session: Any, limiter: RequestLimiter) -> None:
        self._session = session
        self._limiter = limiter

    def get(self, url: str, **kwargs: Any) -> Any:
        self._limiter.wait()
        return self._session.get(url, **kwargs)

    def close(self) -> None:
        close = getattr(self._session, "close", None)
        if close is not None:
            close()

    def __enter__(self) -> "RateLimitedSession":
        return self

    def __exit__(self, *args: Any) -> None:
        del args
        self.close()
