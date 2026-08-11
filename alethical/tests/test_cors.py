from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from alethical.api.main import create_app


PREVIEW_ORIGIN = "https://alethical-lv8nmskcq-alethical.vercel.app"
PREVIEW_ORIGIN_REGEX = r"^https://alethical-[a-z0-9]{9}-alethical\.vercel\.app$"
PRODUCTION_ORIGIN = "https://www.alethical.com"


def _client_with_cors(
    monkeypatch: pytest.MonkeyPatch,
    *,
    exact_origins: str = PRODUCTION_ORIGIN,
    origin_regex: str | None = PREVIEW_ORIGIN_REGEX,
) -> TestClient:
    monkeypatch.setenv("ALETHICAL_CORS_ORIGINS", exact_origins)
    if origin_regex is None:
        monkeypatch.delenv("ALETHICAL_CORS_ORIGIN_REGEX", raising=False)
    else:
        monkeypatch.setenv("ALETHICAL_CORS_ORIGIN_REGEX", origin_regex)
    return TestClient(create_app())


def _simple_get(client: TestClient, origin: str):
    return client.get("/api/v1/bills/94-2025-SF1832", headers={"Origin": origin})


def _preflight(client: TestClient, origin: str):
    return client.options(
        "/api/v1/bills",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization",
        },
    )


@pytest.mark.parametrize("origin", [PRODUCTION_ORIGIN, PREVIEW_ORIGIN])
def test_exact_and_preview_origins_are_allowed_on_simple_get_and_preflight(
    monkeypatch: pytest.MonkeyPatch, origin: str
):
    client = _client_with_cors(monkeypatch)

    simple = _simple_get(client, origin)
    preflight = _preflight(client, origin)

    assert simple.status_code == 200
    assert simple.headers["access-control-allow-origin"] == origin
    assert preflight.status_code == 200
    assert preflight.headers["access-control-allow-origin"] == origin


def test_preview_origin_is_blocked_when_the_optional_pattern_is_unset(
    monkeypatch: pytest.MonkeyPatch,
):
    client = _client_with_cors(monkeypatch, origin_regex=None)

    simple = _simple_get(client, PREVIEW_ORIGIN)
    preflight = _preflight(client, PREVIEW_ORIGIN)

    assert "access-control-allow-origin" not in simple.headers
    assert preflight.status_code == 400
    assert "access-control-allow-origin" not in preflight.headers


@pytest.mark.parametrize(
    "origin",
    [
        "https://wrong-lv8nmskcq-alethical.vercel.app",
        "https://alethical-lv8nmskcq-wrong.vercel.app",
        "http://alethical-lv8nmskcq-alethical.vercel.app",
        "https://alethical-git-main-alethical.vercel.app",
        "https://anything.vercel.app",
        "https://alethical-LV8NMSKCQ-alethical.vercel.app",
        "https://alethical-lv8nmskc-alethical.vercel.app",
        "https://alethical-lv8nmskcq0-alethical.vercel.app",
        "https://alethical-lv8nmskcq-alethical.vercel.app:443",
        "https://alethical-lv8nmskcq-alethical.vercel.app/path",
        "https://alethical-lv8nmskcq-alethicalXvercel.app",
    ],
)
def test_preview_origin_lookalikes_are_blocked(
    monkeypatch: pytest.MonkeyPatch, origin: str
):
    client = _client_with_cors(monkeypatch)

    simple = _simple_get(client, origin)
    preflight = _preflight(client, origin)

    assert simple.status_code == 200
    assert "access-control-allow-origin" not in simple.headers
    assert preflight.status_code == 400
    assert "access-control-allow-origin" not in preflight.headers
