"""First-line rate limiting for public endpoints that call paid/third-party
services (Grounded Ask's OpenAI classify call, the Census/LCC-GIS representative
lookup). See issue #98.

Scope and limits: state is in-memory and per-process, so behind multiple uvicorn
workers or Railway replicas the effective ceiling is
``workers * replicas * max_requests``. That is a deliberate first step — it stops
naive hammering and runaway client loops — not a hard security boundary. A shared
store (Redis) keyed by a trusted-proxy-validated client identity is the
multi-instance follow-up. Keying is documented on ``client_ip`` below.
"""

from __future__ import annotations

import os
import time
from collections import deque

from fastapi import Request

from alethical.api.problems import problem_exception

DEFAULT_ASK_PER_MINUTE = 20
DEFAULT_LOOKUP_PER_MINUTE = 10
# RUM beacons (#516) are cheap DB inserts, but bound them per client so a
# misbehaving or malicious client can't flood the events table. The client also
# samples a small fraction of loads, so a real user sends far fewer than this.
DEFAULT_RUM_PER_MINUTE = 60
_WINDOW_SECONDS = 60.0


class SlidingWindowLimiter:
    """Per-key sliding-window counter. ``allow`` records a hit and returns
    whether the key is still within ``max_requests`` over ``window_seconds``."""

    def __init__(self, max_requests: int, window_seconds: float) -> None:
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._hits: dict[str, deque[float]] = {}

    def allow(self, key: str, now: float) -> bool:
        window_start = now - self.window_seconds
        hits = self._hits.get(key)
        if hits is None:
            hits = deque()
            self._hits[key] = hits
        while hits and hits[0] <= window_start:
            hits.popleft()
        # A rejected request is not recorded, so a hammering client's window can
        # still drain and recover once it backs off.
        if len(hits) >= self.max_requests:
            return False
        hits.append(now)
        return True


def limiter_from_env(
    env_var: str, default_max: int, window_seconds: float = _WINDOW_SECONDS
) -> SlidingWindowLimiter:
    """Build a limiter, letting ops tune the ceiling via env without a code
    change. A missing/invalid/non-positive value falls back to the default."""
    try:
        max_requests = int(os.environ.get(env_var, ""))
    except ValueError:
        max_requests = default_max
    if max_requests <= 0:
        max_requests = default_max
    return SlidingWindowLimiter(max_requests, window_seconds)


def client_ip(request: Request) -> str:
    """Best-effort client identity for rate-limit keying.

    Behind Railway's proxy every request's socket peer is the proxy, so keying
    on ``request.client.host`` would throttle all users as one bucket. The
    left-most ``X-Forwarded-For`` entry is the original client. This trusts XFF,
    which a client could spoof to rotate keys — acceptable for a first-line
    cost/abuse limiter (see module docstring); a trusted-proxy allowlist is the
    hardening follow-up.
    """
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        first = forwarded.split(",")[0].strip()
        if first:
            return first
    client = request.client
    return client.host if client else "unknown"


def rate_limit(state_attr: str, scope: str):
    """FastAPI dependency that enforces the limiter stored at
    ``request.app.state.<state_attr>`` (per-app so tests get fresh state)."""

    def dependency(request: Request) -> None:
        limiter: SlidingWindowLimiter = getattr(request.app.state, state_attr)
        if not limiter.allow(f"{scope}:{client_ip(request)}", time.monotonic()):
            raise problem_exception(
                429,
                "Too Many Requests",
                "Rate limit exceeded — please wait a moment and try again.",
                type_slug="rate-limited",
            )

    return dependency
