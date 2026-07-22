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


def test_call_claude_cli_returns_validated_content(monkeypatch) -> None:
    """The team-plan path parses the Claude Code CLI's `--output-format json`
    envelope (result field), validates the schema, and returns the content. The CLI
    subprocess is mocked so this needs no subscription/CLI/network."""
    valid = {key: _placeholder(spec) for key, spec in _summary_props().items()}
    valid["confidence"] = "high"

    captured: dict = {}

    class FakeProc:
        returncode = 0
        stderr = ""
        stdout = json.dumps({"is_error": False, "result": json.dumps(valid)})

    def fake_run(cmd, capture_output, text, timeout, env=None):
        captured["cmd"] = cmd
        captured["env"] = env
        return FakeProc()

    # API-key vars outrank CLAUDE_CODE_OAUTH_TOKEN in the CLI, so the claude-cli path
    # must strip them from the subprocess env or it would 401 on the unfunded API.
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-should-be-stripped")
    monkeypatch.setenv("ANTHROPIC_AUTH_TOKEN", "should-be-stripped")
    monkeypatch.setattr(ae.subprocess, "run", fake_run)
    out = ae._call_claude_cli("sonnet", "sys", "user")
    assert out["confidence"] == "high"
    # The command shells out to the CLI in headless JSON mode with our prompts.
    cmd = captured["cmd"]
    assert cmd[0] == ae.CLAUDE_CLI_BIN
    assert "-p" in cmd and "user" in cmd
    assert "--model" in cmd and "sonnet" in cmd
    assert "--output-format" in cmd and "json" in cmd
    assert "--system-prompt" in cmd
    # The subprocess env drops the API-key vars so the subscription token wins.
    assert captured["env"] is not None
    assert "ANTHROPIC_API_KEY" not in captured["env"]
    assert "ANTHROPIC_AUTH_TOKEN" not in captured["env"]


def test_call_claude_cli_raises_on_nonzero_exit(monkeypatch) -> None:
    class FakeProc:
        returncode = 1
        stderr = "not logged in"
        stdout = ""

    monkeypatch.setattr(ae.subprocess, "run", lambda *a, **k: FakeProc())
    # Retries then raises — patch sleep so the test is instant.
    monkeypatch.setattr(ae.time, "sleep", lambda *_: None)
    with pytest.raises(RuntimeError, match="claude cli"):
        ae._call_claude_cli("sonnet", "sys", "user")


def test_generate_parser_defaults_to_api_provider_and_accepts_claude_cli() -> None:
    parser = ae.build_parser()
    base = ["generate", "--manifest-path", "m", "--jsonl-path", "j"]
    assert parser.parse_args(base).provider == "api"
    assert (
        parser.parse_args(base + ["--provider", "claude-cli"]).provider == "claude-cli"
    )


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
