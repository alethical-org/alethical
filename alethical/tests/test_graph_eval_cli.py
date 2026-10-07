"""Offline tests for the private evaluator's bounded, explicit paid-call path."""

import json
from argparse import Namespace
from types import SimpleNamespace

import pytest

from scripts import graph_retrieval_eval as cli


@pytest.fixture(autouse=True)
def prohibit_real_network_and_keys(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    def forbidden(*args, **kwargs):
        pytest.fail("An offline evaluator test attempted a real network request")

    monkeypatch.setattr(cli.requests.sessions.Session, "request", forbidden)


@pytest.fixture
def embed_args(tmp_path):
    questions = tmp_path / "questions.json"
    questions.write_text(
        json.dumps(
            {
                "cases": [
                    {"question": "Who authored HF1?"},
                    {"question": "What funds schools?"},
                    {"question": "Who authored HF1?"},
                ]
            }
        )
    )
    return Namespace(
        questions=str(questions), output=str(tmp_path / "vectors.json"), execute=False
    )


def mock_batch(monkeypatch, payload, *, status=200):
    calls = []
    monkeypatch.setenv("OPENAI_API_KEY", "offline-placeholder-not-a-real-key")

    def post(url, **kwargs):
        calls.append({"url": url, **kwargs})
        return SimpleNamespace(status_code=status, json=lambda: payload)

    monkeypatch.setattr(cli.requests, "post", post)
    return calls


def valid_batch():
    return {
        # Reverse response order deliberately; indexes identify the input question.
        "data": [
            {"index": 1, "embedding": [2.0] + [0.0] * 1535},
            {"index": 0, "embedding": [1.0] + [0.0] * 1535},
        ],
        "usage": {"prompt_tokens": 11, "total_tokens": 11},
    }


@pytest.mark.parametrize("key_available", [False, True])
def test_dry_run_has_no_network_and_no_output(
    embed_args, monkeypatch, capsys, key_available
):
    if key_available:
        monkeypatch.setenv("OPENAI_API_KEY", "offline-placeholder-not-a-real-key")
    cli.embed(embed_args)
    preflight = json.loads(capsys.readouterr().out)
    assert preflight["execute"] is False
    assert preflight["questions"] == 2
    assert preflight["api_requests"] == 1
    assert preflight["utf8_bytes"] == len(
        "Who authored HF1?".encode() + "What funds schools?".encode()
    )
    assert not cli.Path(embed_args.output).exists()


def test_existing_output_blocks_execute_before_network(embed_args):
    embed_args.execute = True
    original = b"saved vectors must stay unchanged\n"
    cli.Path(embed_args.output).write_bytes(original)
    with pytest.raises(ValueError, match="Output already exists"):
        cli.embed(embed_args)
    assert cli.Path(embed_args.output).read_bytes() == original


def test_execute_without_key_stops_without_fake_vectors(embed_args):
    embed_args.execute = True
    with pytest.raises(ValueError, match="no hash fallback"):
        cli.embed(embed_args)
    assert not cli.Path(embed_args.output).exists()


def test_exactly_one_batch_is_cached_with_question_hash_usage_and_cost(
    embed_args, monkeypatch, capsys
):
    embed_args.execute = True
    calls = mock_batch(monkeypatch, valid_batch())
    cli.embed(embed_args)
    assert len(calls) == 1
    assert calls[0]["url"] == "https://api.openai.com/v1/embeddings"
    assert calls[0]["json"] == {
        "model": cli.MODEL,
        "input": ["What funds schools?", "Who authored HF1?"],
    }
    assert calls[0]["timeout"] == 60
    cached = cli.read(embed_args.output)
    assert cached["model"] == cli.MODEL
    assert cached["questions_digest"] == cli.digest(calls[0]["json"]["input"])
    assert cached["usage"] == {"prompt_tokens": 11, "total_tokens": 11}
    assert cached["vectors"]["What funds schools?"][0] == 1.0
    assert cached["vectors"]["Who authored HF1?"][0] == 2.0
    assert all(len(vector) == 1536 for vector in cached["vectors"].values())
    assert cached["cost_preflight"] == json.loads(capsys.readouterr().out)
    assert "offline-placeholder" not in cli.Path(embed_args.output).read_text()
    with pytest.raises(ValueError, match="Output already exists"):
        cli.embed(embed_args)
    assert len(calls) == 1


@pytest.mark.parametrize(
    "bad",
    [
        "incomplete",
        "duplicate",
        "short",
        "zero",
        "nan",
        "infinite",
        "boolean",
        "mixed_boolean",
    ],
)
def test_bad_response_never_becomes_a_cached_success(embed_args, monkeypatch, bad):
    payload = valid_batch()
    if bad == "incomplete":
        payload["data"].pop()
    elif bad == "duplicate":
        payload["data"][0]["index"] = 0
    elif bad == "short":
        for row in payload["data"]:
            row["embedding"] = [1.0] * 1535
    elif bad == "zero":
        payload["data"][0]["embedding"] = [0.0] * 1536
    elif bad == "boolean":
        for row in payload["data"]:
            row["embedding"] = [True] * 1536
    elif bad == "mixed_boolean":
        payload["data"][0]["embedding"][0] = True
    else:
        payload["data"][0]["embedding"][0] = float("nan" if bad == "nan" else "inf")
    calls = mock_batch(monkeypatch, payload)
    embed_args.execute = True
    with pytest.raises(ValueError, match="response"):
        cli.embed(embed_args)
    assert len(calls) == 1
    assert not cli.Path(embed_args.output).exists()


def test_http_failure_has_no_automatic_retry_or_cached_output(embed_args, monkeypatch):
    calls = mock_batch(monkeypatch, {}, status=429)
    embed_args.execute = True
    with pytest.raises(RuntimeError, match="HTTP 429.*no automatic retry"):
        cli.embed(embed_args)
    assert len(calls) == 1
    assert not cli.Path(embed_args.output).exists()


@pytest.mark.parametrize(
    "questions", [[], [f"question-{n}" for n in range(51)], ["é" * 10_001]]
)
def test_input_bounds_stop_execute_before_network(embed_args, questions):
    cli.Path(embed_args.questions).write_text(
        json.dumps({"cases": [{"question": question} for question in questions]})
    )
    embed_args.execute = True
    with pytest.raises(ValueError, match="bounded 50-question / 20000-byte"):
        cli.embed(embed_args)
    assert not cli.Path(embed_args.output).exists()


def test_write_new_never_replaces_existing_bytes(tmp_path):
    output = tmp_path / "private" / "result.json"
    cli.write_new(str(output), {"original": "α"})
    original = output.read_bytes()
    assert json.loads(original) == {"original": "α"}
    assert original.endswith(b"\n")
    with pytest.raises(FileExistsError):
        cli.write_new(str(output), {"replacement": True})
    assert output.read_bytes() == original


def test_existing_report_and_snapshot_block_before_input_or_database_reads(tmp_path):
    output = tmp_path / "existing.json"
    output.write_text("preserve me")
    args = Namespace(
        output=str(output), snapshot="missing", manifest="missing", vectors=None
    )
    with pytest.raises(ValueError, match="Report output already exists"):
        cli.run(args)
    # snapshot reads its question file before inspecting the destination.
    questions = tmp_path / "questions.json"
    questions.write_text('{"cases": []}')
    args.questions = str(questions)
    with pytest.raises(ValueError, match="Snapshot output already exists"):
        cli.snapshot(args)
    assert output.read_text() == "preserve me"
