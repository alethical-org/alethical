#!/usr/bin/env python3
"""Generate bill AI enrichments with an Anthropic (Claude) model.

The enrichment-model decision (benchmarked in #377) is Claude Sonnet 5 with
extended thinking OFF: ~95% key-point citation coverage (≈Opus) at ~40% the cost
and ~5x the speed of Opus, and far above the OpenAI models (gpt-5.2 ~48%,
gpt-4o-mini ~44%). This module is the production runner for that decision — the
Claude counterpart to the OpenAI-batch path (`ai_enrichment.py`) and the
codex-headless path (`codex_enrichment.py`). All three consume the SAME
`SYSTEM_PROMPT` + `SUMMARY_SCHEMA` baked into the `prepare` request JSONL, so the
plain-language rule (#520) applies uniformly.

Two billing paths for the `generate` step (`--provider`, default `api`):
  * `api` — calls the Anthropic API (`api.anthropic.com`) with `ANTHROPIC_API_KEY`.
    Spends the API account's prepaid credits.
  * `claude-cli` — the "team plan" path: shells out to the Claude Code CLI in
    headless mode (`claude -p ... --output-format json`), which authenticates with
    the Claude *subscription* (Team plan + overage) instead of an API key. Needs no
    API credit — useful when the API account is unfunded. Requires the `claude` CLI
    on PATH, a CLI-recognized `--model` alias (e.g. `sonnet`), and a valid
    subscription login for headless use: set `CLAUDE_CODE_OAUTH_TOKEN` to a token
    minted by `claude setup-token` (one-time, interactive; ~1-year token). This path
    strips `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` from the CLI's environment
    because they outrank the OAuth token in the CLI's auth precedence. Both paths
    produce the identical output rows, so the downstream `apply` is unchanged.

Flow (mirrors the codex path so it is idempotent and resumable):
  1. `python -m alethical.pipeline.ai_enrichment prepare ...` -> request JSONL + manifest
  2. `python -m alethical.pipeline.anthropic_enrichment generate --manifest-path M
     --jsonl-path J --run-dir DIR [--provider api|claude-cli] [--model ...] [--concurrency N]`
     -> per-bill outputs/<id>.jsonl (skips ones already written) + combined.output.jsonl
  3. `python -m alethical.pipeline.ai_enrichment apply --manifest-path DIR/<...>.codex.manifest.json
     --output-path DIR/combined.output.jsonl [--dry-run]`

The generated output rows use the same shape the apply path already reads
(`{"custom_id", "response": {"status_code": 200, "body": {"output_text": ...}}}`).
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

import requests

from alethical.pipeline.ai_enrichment import SUMMARY_SCHEMA
from alethical.pipeline.codex_enrichment import (
    combine_output_files,
    load_jsonl_requests,
    load_manifest_items,
    output_row,
    safe_custom_id,
    validate_summary_shape,
    write_codex_manifest,
)

ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
DEFAULT_MODEL = "claude-sonnet-5"
DEFAULT_MAX_TOKENS = 8192
DEFAULT_CONCURRENCY = 8
MAX_ATTEMPTS = 4
# Team-plan path: the Claude Code CLI binary (overridable for tests / non-PATH installs).
CLAUDE_CLI_BIN = os.environ.get("ALETHICAL_CLAUDE_CLI", "claude")
# Tools disallowed for the headless generation call — this is a pure text-to-JSON
# task, so the model never needs to act; belt-and-suspenders since --system-prompt
# already replaces the coding-agent default prompt.
_CLI_DISALLOWED_TOOLS = "Bash Edit Write Read WebFetch WebSearch Glob Grep"


def _system_and_user(request: dict[str, Any]) -> tuple[str, str]:
    body = request.get("body") or {}
    inputs = body.get("input") or []
    system = str(inputs[0].get("content") or "") if len(inputs) > 0 else ""
    user = str(inputs[1].get("content") or "") if len(inputs) > 1 else ""
    return system, user


def _extract_json(text: str) -> dict[str, Any]:
    """Parse the JSON object from a model reply, tolerating stray prose/fences."""
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("no JSON object in reply")
    return json.loads(text[start : end + 1])


def _call_anthropic(
    api_key: str, model: str, system: str, user: str, max_tokens: int
) -> dict[str, Any]:
    schema_note = (
        "\n\nReturn ONLY a single JSON object matching this schema. No prose, no "
        "markdown fences:\n" + json.dumps(SUMMARY_SCHEMA)
    )
    payload = {
        "model": model,
        "max_tokens": max_tokens,
        "system": system + schema_note,
        "messages": [{"role": "user", "content": user}],
    }
    last_err: Exception | None = None
    for attempt in range(MAX_ATTEMPTS):
        try:
            resp = requests.post(
                ANTHROPIC_API_URL,
                headers={
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json=payload,
                timeout=240,
            )
            if resp.status_code in (429, 500, 503, 529):
                raise RuntimeError(f"retryable {resp.status_code}: {resp.text[:200]}")
            resp.raise_for_status()
            data = resp.json()
            text = "".join(
                b.get("text", "")
                for b in data.get("content", [])
                if b.get("type") == "text"
            ).strip()
            content = _extract_json(text)
            errors = validate_summary_shape(content)
            if errors:
                raise ValueError(f"schema errors: {errors[:5]}")
            return content
        except Exception as exc:  # noqa: BLE001
            last_err = exc
            # Exponential backoff; also nudge max_tokens up on truncation.
            time.sleep(min(2**attempt, 30))
            if isinstance(exc, (ValueError, json.JSONDecodeError)):
                payload["max_tokens"] = min(payload["max_tokens"] + 2048, 16000)
    raise RuntimeError(
        f"anthropic call failed after {MAX_ATTEMPTS} attempts: {last_err}"
    )


def _call_claude_cli(model: str, system: str, user: str) -> dict[str, Any]:
    """Team-plan path: generate one enrichment via the Claude Code CLI in headless
    mode (`claude -p`), which bills the Claude subscription (Team plan + overage)
    rather than the Anthropic API — no API credit needed. Same contract as
    :func:`_call_anthropic` (returns the validated, schema-shaped content dict), so
    the apply path is unchanged. `model` must be a CLI-recognized alias/id (e.g.
    "sonnet"); `--system-prompt` replaces the default coding-agent prompt with the
    enrichment prompt so the model just emits JSON."""
    schema_note = (
        "\n\nReturn ONLY a single JSON object matching this schema. No prose, no "
        "markdown fences:\n" + json.dumps(SUMMARY_SCHEMA)
    )
    cmd = [
        CLAUDE_CLI_BIN,
        "-p",
        user,
        "--model",
        model,
        "--system-prompt",
        system + schema_note,
        "--output-format",
        "json",
        "--disallowed-tools",
        _CLI_DISALLOWED_TOOLS,
        "--no-session-persistence",
    ]
    # The CLI authenticates against the subscription via CLAUDE_CODE_OAUTH_TOKEN
    # (`claude setup-token`), but ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN outrank it
    # in the CLI's auth precedence — if either is present in the environment the CLI
    # would silently use the (unfunded) API path and 401. Strip them so this path
    # always uses the subscription token, which is the whole point of --provider
    # claude-cli.
    cli_env = {
        k: v
        for k, v in os.environ.items()
        if k not in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN")
    }
    last_err: Exception | None = None
    for attempt in range(MAX_ATTEMPTS):
        try:
            proc = subprocess.run(
                cmd, capture_output=True, text=True, timeout=300, env=cli_env
            )
            if proc.returncode != 0:
                raise RuntimeError(
                    f"claude cli exit {proc.returncode}: {(proc.stderr or '')[:200]}"
                )
            envelope = json.loads(proc.stdout)
            if envelope.get("is_error"):
                raise RuntimeError(
                    f"claude cli reported error: {str(envelope.get('result'))[:200]}"
                )
            text = str(envelope.get("result") or "")
            content = _extract_json(text)
            errors = validate_summary_shape(content)
            if errors:
                raise ValueError(f"schema errors: {errors[:5]}")
            return content
        except Exception as exc:  # noqa: BLE001
            last_err = exc
            time.sleep(min(2**attempt, 30))
    raise RuntimeError(
        f"claude cli call failed after {MAX_ATTEMPTS} attempts: {last_err}"
    )


def generate(args: argparse.Namespace) -> None:
    provider = getattr(args, "provider", "api")
    api_key: str | None = None
    if provider == "api":
        api_key = args.api_key or os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            raise SystemExit("ANTHROPIC_API_KEY is required for --provider api")

    run_dir = Path(args.run_dir)
    outputs_dir = run_dir / "outputs"
    outputs_dir.mkdir(parents=True, exist_ok=True)
    model_name = args.model_name or f"claude:{args.model}"

    manifest_path = Path(args.manifest_path)
    codex_manifest_path = write_codex_manifest(
        manifest_path,
        run_dir / f"{manifest_path.stem}.codex.manifest.json",
        model_name=model_name,
    )
    requests_by_id = load_jsonl_requests(Path(args.jsonl_path))
    items = load_manifest_items(codex_manifest_path)

    pending: list[Any] = []
    skipped_done = 0
    for item in items:
        out_path = outputs_dir / f"{safe_custom_id(item.custom_id)}.jsonl"
        if out_path.exists():
            skipped_done += 1
            continue
        if item.custom_id in requests_by_id:
            pending.append(item)
        if args.limit is not None and len(pending) >= args.limit:
            break

    print(
        json.dumps(
            {
                "run_dir": str(run_dir),
                "provider": provider,
                "model": args.model,
                "model_name": model_name,
                "total_items": len(items),
                "skipped_done": skipped_done,
                "to_generate": len(pending),
                "concurrency": args.concurrency,
            }
        ),
        flush=True,
    )

    done = 0
    failed: list[dict[str, str]] = []

    def work(item: Any) -> tuple[str, bool, str]:
        system, user = _system_and_user(requests_by_id[item.custom_id])
        if provider == "claude-cli":
            content = _call_claude_cli(args.model, system, user)
        else:
            content = _call_anthropic(
                api_key, args.model, system, user, DEFAULT_MAX_TOKENS
            )
        out_path = outputs_dir / f"{safe_custom_id(item.custom_id)}.jsonl"
        out_path.write_text(
            json.dumps(output_row(item.custom_id, content), ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        return item.custom_id, True, ""

    with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
        futures = {pool.submit(work, item): item for item in pending}
        for fut in as_completed(futures):
            item = futures[fut]
            try:
                fut.result()
                done += 1
            except Exception as exc:  # noqa: BLE001
                failed.append({"custom_id": item.custom_id, "error": str(exc)[:300]})
            if (done + len(failed)) % 25 == 0:
                print(
                    json.dumps(
                        {
                            "progress": done + len(failed),
                            "ok": done,
                            "failed": len(failed),
                        }
                    ),
                    flush=True,
                )

    combine = combine_output_files(
        run_dir=run_dir,
        manifest_path=codex_manifest_path,
        output_path=run_dir / "combined.output.jsonl",
    )
    print(
        json.dumps(
            {
                "generated_ok": done,
                "generated_failed": len(failed),
                "failed_sample": failed[:10],
                "combine": combine,
            },
            indent=2,
        )
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Generate bill AI enrichments with an Anthropic (Claude) model."
    )
    parser.add_argument("--api-key", default=None)
    sub = parser.add_subparsers(dest="command", required=True)
    gen = sub.add_parser("generate", help="Generate enrichments for a prepared batch.")
    gen.add_argument("--manifest-path", required=True)
    gen.add_argument("--jsonl-path", required=True)
    gen.add_argument("--run-dir", default=".tmp/anthropic-ai-runs/regen")
    gen.add_argument(
        "--provider",
        choices=["api", "claude-cli"],
        default="api",
        help=(
            "Generation billing path. 'api' (default): Anthropic API, spends "
            "ANTHROPIC_API_KEY credits. 'claude-cli': Claude Code CLI headless, "
            "bills the Claude subscription (Team plan + overage) — no API credit; "
            "pass a CLI model alias via --model (e.g. 'sonnet')."
        ),
    )
    gen.add_argument("--model", default=DEFAULT_MODEL)
    gen.add_argument(
        "--model-name",
        default=None,
        help="ai_enrichment.model_name to record (default claude:<model>).",
    )
    gen.add_argument("--concurrency", type=int, default=DEFAULT_CONCURRENCY)
    gen.add_argument("--limit", type=int, default=None)
    gen.set_defaults(func=generate)
    return parser


def main() -> None:
    args = build_parser().parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
