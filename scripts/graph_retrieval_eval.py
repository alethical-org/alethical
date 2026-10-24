"""Private evidence retrieval trial. See docs/research/retrieval/graph-evaluation/README.md.

No stage writes to a database or changes an answer route. `embed` is dry-run by
 default; --execute permits one bounded OpenAI request, cached to a new file.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

import requests
from sqlalchemy import create_engine

from alethical.db.session import NO_PREPARED_STATEMENTS, database_url_for_target
from alethical.eval.graph_eval import compare, digest
from alethical.eval.graph_snapshot import export_snapshot

MODEL = "text-embedding-3-small"
MAX_QUERY_BYTES = 20_000


def read(path: str) -> dict:
    return json.loads(Path(path).read_text())


def write_new(path: str, value: dict) -> None:
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    # No overwrite switch: snapshots, labels and results are immutable run inputs.
    with destination.open("x") as handle:
        handle.write(
            json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False) + "\n"
        )


def embed(args) -> None:
    manifest = read(args.questions)
    questions = sorted({case["question"] for case in manifest["cases"]})
    total_bytes = sum(len(q.encode()) for q in questions)
    if not questions or len(questions) > 50 or total_bytes > MAX_QUERY_BYTES:
        raise ValueError(
            "Query input exceeds the bounded 50-question / 20000-byte trial"
        )
    if Path(args.output).exists():
        raise ValueError("Output already exists; reuse it rather than pay again")
    estimate = {
        "questions": len(questions),
        "utf8_bytes": total_bytes,
        "conservative_token_bound": total_bytes,
        "model": MODEL,
        "price_usd_per_million_input_tokens": 0.02,
        "cost_bound_usd": total_bytes * 0.02 / 1_000_000,
        "price_source": "https://developers.openai.com/api/docs/models/text-embedding-3-small",
        "api_requests": 1,
        "execute": args.execute,
    }
    print(json.dumps(estimate))
    if not args.execute:
        return
    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        raise ValueError("OPENAI_API_KEY unavailable; no hash fallback is permitted")
    response = requests.post(
        "https://api.openai.com/v1/embeddings",
        headers={"Authorization": f"Bearer {key}"},
        json={"model": MODEL, "input": questions},
        timeout=60,
    )
    if response.status_code != 200:
        raise RuntimeError(
            f"Embedding request failed with HTTP {response.status_code}; no automatic retry"
        )
    body = response.json()
    rows = sorted(body.get("data", []), key=lambda row: row["index"])
    if [r["index"] for r in rows] != list(range(len(questions))):
        raise ValueError("Embedding response is incomplete")
    import numpy as np

    if any(
        not isinstance(r.get("embedding"), list)
        or any(type(v) not in (int, float) for v in r["embedding"])
        for r in rows
    ):
        raise ValueError("Invalid embedding response")
    matrix = np.asarray([r["embedding"] for r in rows])
    if (
        matrix.shape != (len(questions), 1536)
        or not np.isfinite(matrix).all()
        or (np.linalg.norm(matrix, axis=1) == 0).any()
    ):
        raise ValueError("Invalid embedding response")
    write_new(
        args.output,
        {
            "model": MODEL,
            "questions_digest": digest(questions),
            "usage": body.get("usage"),
            "vectors": dict(zip(questions, matrix.tolist())),
            "cost_preflight": estimate,
        },
    )


def snapshot(args) -> None:
    cases = read(args.questions)["cases"]
    vectors = read(args.vectors) if args.vectors else None
    if vectors and (
        vectors["model"] != MODEL
        or vectors["questions_digest"] != digest(sorted({c["question"] for c in cases}))
    ):
        raise ValueError("Vectors do not match the requested questions and model")
    if Path(args.output).exists():
        raise ValueError("Snapshot output already exists")
    engine = create_engine(
        database_url_for_target(args.target),
        connect_args={**NO_PREPARED_STATEMENTS, "connect_timeout": 10},
        hide_parameters=True,
    )
    try:
        value = export_snapshot(
            engine,
            sorted({c["bill_key"] for c in cases}),
            MODEL,
            query_vectors=vectors["vectors"] if vectors else None,
            questions=cases if vectors else None,
        )
    finally:
        engine.dispose()
    write_new(args.output, value)
    print(json.dumps(value["manifest"]))


def run(args) -> None:
    if Path(args.output).exists():
        raise ValueError("Report output already exists")
    result = compare(
        read(args.snapshot),
        read(args.manifest),
        read(args.vectors) if args.vectors else None,
        budget=args.character_budget,
    )
    root = Path(__file__).resolve().parents[1]
    result["code_commit"] = subprocess.check_output(
        ["git", "rev-parse", "HEAD"], text=True, cwd=root
    ).strip()
    paths = [
        "alethical/eval/graph_eval.py",
        "alethical/eval/graph_snapshot.py",
        "alethical/eval/retrieval_eval.py",
        "scripts/graph_retrieval_eval.py",
    ]
    result["code_digest"] = digest({p: (root / p).read_text() for p in paths})
    write_new(args.output, result)
    print(
        json.dumps(
            {
                "screen": result["screen"],
                "arms": {
                    name: {
                        split: {k: v for k, v in values.items() if k != "metrics"}
                        for split, values in splits.items()
                    }
                    for name, splits in result["summaries"].items()
                },
            }
        )
    )


def review(args) -> None:
    """Inspect a frozen comparison without ranking again or calling a model."""
    if Path(args.output).exists():
        raise ValueError("Review output already exists")
    inputs = (read(args.snapshot), read(args.manifest), read(args.report))
    if args.command == "diagnose":
        from alethical.eval.evidence_diagnostics import diagnose

        result = diagnose(*inputs)
    else:
        from alethical.eval.answer_trial import prepare_answer_trial

        result = prepare_answer_trial(*inputs, arm=args.arm)
    root = Path(__file__).resolve().parents[1]
    paths = [
        "alethical/eval/evidence_diagnostics.py",
        "alethical/eval/answer_trial.py",
        "alethical/eval/graph_eval.py",
        "scripts/graph_retrieval_eval.py",
        "scripts/answer_eval.py",
        "alethical/api/routers/me.py",
    ]
    result["code_commit"] = subprocess.check_output(
        ["git", "rev-parse", "HEAD"], text=True, cwd=root
    ).strip()
    result["code_digest"] = digest({p: (root / p).read_text() for p in paths})
    write_new(args.output, result)
    # Questions, source excerpts and review prompts stay in the private output.
    print(json.dumps({"stage": args.command, "output": args.output}))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    emb = commands.add_parser(
        "embed", help="price a bounded batch; --execute calls OpenAI once"
    )
    emb.add_argument("--questions", required=True)
    emb.add_argument("--output", required=True)
    emb.add_argument("--execute", action="store_true")
    emb.set_defaults(func=embed)
    snap = commands.add_parser(
        "snapshot", help="bounded read-only public civic data copy"
    )
    snap.add_argument("--questions", required=True)
    snap.add_argument("--vectors")
    snap.add_argument("--target", choices=["local", "production"], default="local")
    snap.add_argument("--output", required=True)
    snap.set_defaults(func=snapshot)
    compare_parser = commands.add_parser(
        "run", help="offline comparison; makes no network calls"
    )
    compare_parser.add_argument("--snapshot", required=True)
    compare_parser.add_argument("--manifest", required=True)
    compare_parser.add_argument("--vectors")
    compare_parser.add_argument("--character-budget", type=int, default=6000)
    compare_parser.add_argument("--output", required=True)
    compare_parser.set_defaults(func=run)
    for command, help_text in (
        ("diagnose", "offline coverage and evidence-budget diagnostics"),
        ("prepare-answers", "offline bill-text answer review packets; no model calls"),
    ):
        review_parser = commands.add_parser(command, help=help_text)
        review_parser.add_argument("--snapshot", required=True)
        review_parser.add_argument("--manifest", required=True)
        review_parser.add_argument("--report", required=True)
        review_parser.add_argument("--output", required=True)
        if command == "prepare-answers":
            review_parser.add_argument("--arm", default="production_reference")
        review_parser.set_defaults(func=review)
    args = parser.parse_args()
    try:
        args.func(args)
    except Exception as exc:
        # Database/API exceptions can include connection credentials or response
        # bodies. Keep the CLI error bounded; validation errors are local only.
        message = (
            str(exc)
            if isinstance(exc, (ValueError, FileExistsError))
            else type(exc).__name__
        )
        print(f"Evaluation stopped: {message}", file=sys.stderr)
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
