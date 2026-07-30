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
            return {
                "content": [{"type": "text", "text": json.dumps(valid)}],
                "usage": {"input_tokens": 11, "cache_read_input_tokens": 2698},
            }

    calls: dict = {}

    def fake_post(url, headers, json, timeout):  # noqa: A002
        calls["url"] = url
        calls["model"] = json["model"]
        calls["has_system"] = bool(json["system"])
        return FakeResp()

    monkeypatch.setattr(ae.requests, "post", fake_post)
    out, usage = ae._call_anthropic("key", "claude-sonnet-5", "sys", "user", 8192)
    assert out["confidence"] in {"low", "medium", "high"}
    assert calls["url"] == ae.ANTHROPIC_API_URL
    assert calls["model"] == "claude-sonnet-5"
    assert calls["has_system"] is True
    # The reported token counts come back so a run can prove the cache was read
    # instead of projecting the saving (#779).
    assert usage["cache_read_input_tokens"] == 2698


def test_call_anthropic_marks_only_the_repeated_instructions_as_cacheable(
    monkeypatch,
) -> None:
    """The instructions carry the cache marker and the bill text does not.

    Caching only pays off while the repeated text sits ahead of the text that
    changes per bill, so this pins the shape rather than the saving: the shared
    instruction block is one marked system block, the bill text is an unmarked user
    message after it, and the marker asks for the hour-long lifetime that survives a
    stalled run (#779)."""
    valid = {key: _placeholder(spec) for key, spec in _summary_props().items()}
    valid["confidence"] = "low"

    class FakeResp:
        status_code = 200

        def raise_for_status(self) -> None:
            pass

        def json(self) -> dict:
            return {"content": [{"type": "text", "text": json.dumps(valid)}]}

    sent: dict = {}

    def fake_post(url, headers, json, timeout):  # noqa: A002
        sent.update(json)
        return FakeResp()

    monkeypatch.setattr(ae.requests, "post", fake_post)
    ae._call_anthropic("key", "claude-sonnet-5", "SYSTEM", "BILL TEXT", 8192)

    blocks = sent["system"]
    assert len(blocks) == 1
    assert blocks[0]["cache_control"] == {"type": "ephemeral", "ttl": "1h"}
    # Unchanged from before caching: the same instructions plus the same schema note.
    assert blocks[0]["text"] == "SYSTEM" + ae._SCHEMA_NOTE
    # The part that varies per bill stays after the cached block, and uncached.
    assert sent["messages"] == [{"role": "user", "content": "BILL TEXT"}]
    assert "BILL TEXT" not in blocks[0]["text"]


def test_warm_cache_writes_the_prefix_without_asking_for_an_answer(
    monkeypatch,
) -> None:
    """The warm-up request carries the same cached instructions as a real call but
    asks for no output, so the bills that follow read the entry instead of each
    paying to create it (#779)."""

    class FakeResp:
        def raise_for_status(self) -> None:
            pass

        def json(self) -> dict:
            return {"usage": {"cache_creation_input_tokens": 2698, "output_tokens": 0}}

    sent: dict = {}

    def fake_post(url, headers, json, timeout):  # noqa: A002
        sent.update(json)
        return FakeResp()

    monkeypatch.setattr(ae.requests, "post", fake_post)
    usage = ae._warm_cache("key", "claude-sonnet-5", "SYSTEM")

    assert sent["max_tokens"] == 0
    # The kept copy is only reusable by the real bills if the warm-up sends the very
    # same marked instructions, so this asserts the text and the marker, not a
    # round-trip through the same builder.
    assert sent["system"] == [
        {
            "type": "text",
            "text": "SYSTEM" + ae._SCHEMA_NOTE,
            "cache_control": {"type": "ephemeral", "ttl": "1h"},
        }
    ]
    assert usage["cache_creation_input_tokens"] == 2698


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


def test_batch_parser_exposes_submit_and_collect() -> None:
    parser = ae.build_parser()
    submit = parser.parse_args(
        ["batch-submit", "--manifest-path", "m", "--jsonl-path", "j", "--dry-run"]
    )
    assert submit.func is ae.batch_submit
    assert submit.dry_run is True
    assert submit.chunk_size == ae.DEFAULT_BATCH_CHUNK_SIZE
    collect = parser.parse_args(["batch-collect", "--manifest-path", "m"])
    assert collect.func is ae.batch_collect


def test_message_params_is_identical_for_live_and_batch(monkeypatch) -> None:
    """The batch envelope must wrap the same words the live call sends, or the two
    paths would quietly produce different summaries for the same bill.

    Since #779 the two bodies differ in exactly one way, deliberately: the live call
    asks the API to keep the repeated instructions on hand and the batch call does
    not, because inside the bulk queue that can cost more than it saves (reasoning in
    `message_params`). That difference is a billing marker, never wording — so this
    asserts both halves: the live body is the kept-instructions build, and setting
    that aside leaves it word-for-word what the batch path sends."""
    captured: dict = {}

    class FakeResp:
        status_code = 200

        def raise_for_status(self) -> None:
            pass

        def json(self) -> dict:
            return {"content": [{"type": "text", "text": "{}"}]}

    def fake_post(url, headers, json, timeout):  # noqa: A002
        # First call only: the retry loop nudges max_tokens upward on a bad reply.
        captured.setdefault("live", dict(json))
        return FakeResp()

    monkeypatch.setattr(ae.requests, "post", fake_post)
    monkeypatch.setattr(ae.time, "sleep", lambda *_: None)
    with pytest.raises(RuntimeError):
        # "{}" fails schema validation; we only want the captured payload.
        ae._call_anthropic("key", "claude-sonnet-5", "sys", "user", 8192)

    live = captured["live"]
    batch = ae.message_params("claude-sonnet-5", "sys", "user", 8192)
    assert live == ae.message_params(
        "claude-sonnet-5", "sys", "user", 8192, cache_instructions=True
    )
    # The batch body is untouched by #779: instructions as a plain block of text with
    # no marker on it, exactly as it was before the option existed.
    assert isinstance(batch["system"], str)
    assert batch["system"] == "sys" + ae._SCHEMA_NOTE
    # Same words in both, and the marker is the only difference between the bodies.
    assert live["system"][0]["text"] == batch["system"]
    assert {k: v for k, v in live.items() if k != "system"} == {
        k: v for k, v in batch.items() if k != "system"
    }


def test_batch_submit_dry_run_reports_without_spending(tmp_path, capsys) -> None:
    """A dry run must never touch the network — this is the check that lets us
    price a 3,222-bill run before deciding to pay for it."""
    run_dir = _prepared_run(tmp_path, count=3)
    args = ae.build_parser().parse_args(
        [
            "batch-submit",
            "--manifest-path",
            str(run_dir["manifest"]),
            "--jsonl-path",
            str(run_dir["jsonl"]),
            "--run-dir",
            str(run_dir["dir"]),
            "--dry-run",
        ]
    )
    ae.batch_submit(args)
    report = json.loads(capsys.readouterr().out)
    assert report["dry_run"] is True
    assert report["to_submit"] == 3
    assert report["estimated_input_tokens"] > 0
    assert not (run_dir["dir"] / "batch.json").exists()


def test_batch_submit_persists_batch_ids_and_maps_custom_ids(
    tmp_path, monkeypatch, capsys
) -> None:
    """Batch ids hit disk before the command returns, so a killed terminal can
    still collect a job Anthropic is already billing us for."""
    run_dir = _prepared_run(tmp_path, count=3)
    posted: list = []

    class FakeResp:
        def __init__(self, index: int) -> None:
            self.index = index

        def raise_for_status(self) -> None:
            pass

        def json(self) -> dict:
            return {"id": f"msgbatch_{self.index}"}

    def fake_post(url, headers, json, timeout):  # noqa: A002
        posted.append(json["requests"])
        return FakeResp(len(posted) - 1)

    monkeypatch.setattr(ae.requests, "post", fake_post)
    args = ae.build_parser().parse_args(
        [
            "batch-submit",
            "--manifest-path",
            str(run_dir["manifest"]),
            "--jsonl-path",
            str(run_dir["jsonl"]),
            "--run-dir",
            str(run_dir["dir"]),
            "--chunk-size",
            "2",
        ]
    )
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    args.api_key = None
    ae.batch_submit(args)

    assert [len(chunk) for chunk in posted] == [2, 1]
    state = json.loads((run_dir["dir"] / "batch.json").read_text())
    assert [b["id"] for b in state["batches"]] == ["msgbatch_0", "msgbatch_1"]
    # Anthropic's custom_id charset excludes dots, so ids are positional and mapped back.
    assert set(state["custom_id_map"]) == {"req-000000", "req-000001", "req-000002"}
    assert sorted(state["custom_id_map"].values()) == ["bill.1", "bill.2", "bill.3"]
    # Deliberately NOT asking the API to keep the repeated instructions on hand here
    # (#779, #784): inside the bulk queue that is best-effort, and the calls that miss
    # pay a premium instead, so on a 3,222-bill run it swings between saving ~$9 and
    # costing ~$10. Turning it on for the fast lane must not turn it on for this one.
    for chunk in posted:
        for request in chunk:
            assert isinstance(request["params"]["system"], str)
            assert "cache_control" not in json.dumps(request["params"])
    capsys.readouterr()


def test_batch_submit_refuses_to_resubmit_a_live_batch(tmp_path, monkeypatch) -> None:
    """Submitting twice would pay twice. The saved state file is the guard."""
    run_dir = _prepared_run(tmp_path, count=1)
    (run_dir["dir"] / "batch.json").write_text("{}")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    args = ae.build_parser().parse_args(
        [
            "batch-submit",
            "--manifest-path",
            str(run_dir["manifest"]),
            "--jsonl-path",
            str(run_dir["jsonl"]),
            "--run-dir",
            str(run_dir["dir"]),
        ]
    )
    args.api_key = None
    with pytest.raises(SystemExit, match="already exists"):
        ae.batch_submit(args)


def test_batch_collect_reports_not_ready_without_writing(
    tmp_path, monkeypatch, capsys
) -> None:
    """A batch still running must produce no output rows — a half-collected run
    would look complete to `apply`."""
    run_dir = _prepared_run(tmp_path, count=1)
    _write_batch_state(run_dir, {"req-000000": "bill.1"})

    class FakeResp:
        def raise_for_status(self) -> None:
            pass

        def json(self) -> dict:
            return {
                "processing_status": "in_progress",
                "request_counts": {"processing": 1},
            }

    monkeypatch.setattr(ae.requests, "get", lambda *a, **k: FakeResp())
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    args = ae.build_parser().parse_args(
        [
            "batch-collect",
            "--manifest-path",
            str(run_dir["manifest"]),
            "--run-dir",
            str(run_dir["dir"]),
        ]
    )
    args.api_key = None
    ae.batch_collect(args)
    assert json.loads(capsys.readouterr().out)["ready"] is False
    assert not list((run_dir["dir"] / "outputs").glob("*.jsonl"))


def test_batch_collect_writes_successes_and_skips_failures(
    tmp_path, monkeypatch, capsys
) -> None:
    """A failed or malformed result must leave that bill pending rather than
    writing a broken summary over a live page."""
    run_dir = _prepared_run(tmp_path, count=3)
    _write_batch_state(
        run_dir,
        {"req-000000": "bill.1", "req-000001": "bill.2", "req-000002": "bill.3"},
    )
    valid = {key: _placeholder(spec) for key, spec in _summary_props().items()}
    valid["confidence"] = "medium"
    results = "\n".join(
        [
            json.dumps(
                {
                    "custom_id": "req-000000",
                    "result": {
                        "type": "succeeded",
                        "message": {
                            "content": [{"type": "text", "text": json.dumps(valid)}]
                        },
                    },
                }
            ),
            json.dumps({"custom_id": "req-000001", "result": {"type": "errored"}}),
            json.dumps(
                {
                    "custom_id": "req-000002",
                    "result": {
                        "type": "succeeded",
                        "message": {"content": [{"type": "text", "text": "not json"}]},
                    },
                }
            ),
        ]
    )

    class StatusResp:
        def raise_for_status(self) -> None:
            pass

        def json(self) -> dict:
            return {"processing_status": "ended", "request_counts": {"succeeded": 1}}

    class ResultsResp:
        text = results

        def raise_for_status(self) -> None:
            pass

    def fake_get(url, headers, timeout):
        return ResultsResp() if url.endswith("/results") else StatusResp()

    monkeypatch.setattr(ae.requests, "get", fake_get)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    args = ae.build_parser().parse_args(
        [
            "batch-collect",
            "--manifest-path",
            str(run_dir["manifest"]),
            "--run-dir",
            str(run_dir["dir"]),
        ]
    )
    args.api_key = None
    ae.batch_collect(args)

    report = json.loads(capsys.readouterr().out)
    assert report["ready"] is True
    assert report["written"] == 1
    assert report["problems"] == 2
    written = sorted(p.name for p in (run_dir["dir"] / "outputs").glob("*.jsonl"))
    assert written == ["bill.1.jsonl"]
    row = json.loads((run_dir["dir"] / "outputs" / "bill.1.jsonl").read_text())
    # Identical envelope to the live path, so `apply` cannot tell them apart.
    assert row["custom_id"] == "bill.1"
    assert row["response"]["status_code"] == 200


def _prepared_run(tmp_path, *, count: int) -> dict:
    """Write the manifest + request JSONL that `prepare` would have produced."""
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    ids = [f"bill.{n}" for n in range(1, count + 1)]
    manifest = tmp_path / "ai-enrichment-test.manifest.json"
    manifest.write_text(
        json.dumps(
            {
                "model": "claude:claude-sonnet-5",
                "items": [
                    {
                        "custom_id": cid,
                        "bill_id": cid,
                        "bill_key": cid,
                        "bill_version_id": cid,
                        "model": "claude:claude-sonnet-5",
                        "source_version_hash": "h",
                    }
                    for cid in ids
                ],
            }
        )
    )
    jsonl = tmp_path / "ai-enrichment-test.jsonl"
    jsonl.write_text(
        "\n".join(
            json.dumps(
                {
                    "custom_id": cid,
                    "body": {
                        "input": [
                            {"role": "system", "content": "SYS"},
                            {"role": "user", "content": f"bill text {cid}"},
                        ]
                    },
                }
            )
            for cid in ids
        )
    )
    return {"dir": run_dir, "manifest": manifest, "jsonl": jsonl}


def _write_batch_state(run_dir: dict, id_map: dict) -> None:
    (run_dir["dir"] / "batch.json").write_text(
        json.dumps(
            {
                "model": "claude-sonnet-5",
                "model_name": "claude:claude-sonnet-5",
                "batches": [{"id": "msgbatch_0", "request_count": len(id_map)}],
                "custom_id_map": id_map,
            }
        )
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
