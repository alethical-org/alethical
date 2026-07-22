from __future__ import annotations

import json

import pytest

from alethical.pipeline import anthropic_enrichment as ae


def test_system_and_user_splits_prepared_request() -> None:
    request = {
        "body": {
            "input": [
                {"role": "system", "content": "SYS"},
                {"role": "user", "content": "USER"},
            ]
        }
    }
    assert ae._system_and_user(request) == ("SYS", "USER")


def test_system_and_user_tolerates_missing_parts() -> None:
    assert ae._system_and_user({}) == ("", "")
    assert ae._system_and_user({"body": {"input": [{"content": "only-system"}]}}) == (
        "only-system",
        "",
    )


def test_extract_json_tolerates_surrounding_prose_and_fences() -> None:
    payload = {"summary": "does a thing", "key_points": ["one"]}
    text = "Here you go:\n```json\n" + json.dumps(payload) + "\n```\nthanks!"
    assert ae._extract_json(text) == payload


def test_extract_json_raises_without_object() -> None:
    with pytest.raises(ValueError):
        ae._extract_json("no json here")


def test_call_anthropic_returns_validated_content(monkeypatch) -> None:
    """The happy path: a valid schema-shaped reply is parsed and returned. The
    live API call is mocked so this runs without credits/network."""
    valid = {key: _placeholder(spec) for key, spec in _summary_props().items()}
    valid["confidence"] = "medium"  # enum-constrained field

    class FakeResp:
        status_code = 200

        def raise_for_status(self) -> None:
            pass

        def json(self) -> dict:
            return {"content": [{"type": "text", "text": json.dumps(valid)}]}

    calls: dict = {}

    def fake_post(url, headers, json, timeout):  # noqa: A002
        calls["url"] = url
        calls["model"] = json["model"]
        calls["has_system"] = bool(json["system"])
        return FakeResp()

    monkeypatch.setattr(ae.requests, "post", fake_post)
    out = ae._call_anthropic("key", "claude-sonnet-5", "sys", "user", 8192)
    assert out["confidence"] in {"low", "medium", "high"}
    assert calls["url"] == ae.ANTHROPIC_API_URL
    assert calls["model"] == "claude-sonnet-5"
    assert calls["has_system"] is True


def _summary_props() -> dict:
    return ae.SUMMARY_SCHEMA["properties"]


def _placeholder(spec: dict):
    t = spec.get("type")
    if t == "string":
        return "x"
    if t == "array":
        return []
    if t == "boolean":
        return False
    if t == "integer":
        return 0
    if t == "object":
        return {k: _placeholder(v) for k, v in spec.get("properties", {}).items()}
    # confidence enum is a string
    return "medium"
