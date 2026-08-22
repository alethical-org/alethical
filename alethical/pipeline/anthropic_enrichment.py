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

Two *speed* modes for the `api` path, which is a separate axis from billing:
  * `generate` — live `POST /v1/messages` from a worker pool. ~1 hour for a
    3,222-bill run, billed at full list price. Use when someone is waiting.
  * `batch-submit` + `batch-collect` — Anthropic's Message Batches queue. **50% off
    both input and output**, best-effort turnaround of up to 24 hours. Use for
    unattended bulk backfills, where nobody is waiting and half price is the whole
    point. Both modes send the same prompt (:func:`message_params`) and write
    byte-identical output rows, so `apply` cannot tell which produced a row.

The live mode additionally asks the API to **cache the repeated instruction block**,
so a run is charged for it in full once and at about a tenth of that on every bill
after (#779) — see :func:`message_params`, whose docstring also explains why the
batch mode deliberately does not. This changes billing only: the words the model is
sent, and the JSON it returns, are byte-for-byte what they were before, and every
live run prints a `token_usage` block reporting whether the cache was really read.

Flow (mirrors the codex path so it is idempotent and resumable):
  1. `python -m alethical.pipeline.ai_enrichment prepare ...` -> request JSONL + manifest
  2a. LIVE: `python -m alethical.pipeline.anthropic_enrichment generate --manifest-path M
     --jsonl-path J --run-dir DIR [--provider api|claude-cli] [--model ...] [--concurrency N]`
     -> per-bill outputs/<id>.jsonl (skips ones already written) + combined.output.jsonl
  2b. BATCH: `... batch-submit --manifest-path M --jsonl-path J --run-dir DIR [--dry-run]`
     -> DIR/batch.json (batch ids + custom-id map), then, once it has ended,
     `... batch-collect --manifest-path M --run-dir DIR`
     -> the same per-bill outputs + combined.output.jsonl
  3. `python -m alethical.pipeline.ai_enrichment apply --manifest-path DIR/<...>.codex.manifest.json
     --output-path DIR/combined.output.jsonl [--dry-run]`

Both 2a and 2b skip bills whose output file already exists, so a run can be
interrupted, resumed, or switched between modes without paying for a bill twice.

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
from typing import Any, Callable

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
ANTHROPIC_BATCHES_URL = "https://api.anthropic.com/v1/messages/batches"
# Anthropic caps a batch at 100k requests / 256MB. Our enrichment requests run
# ~33KB each, so a 3,222-bill run is ~106MB in one POST. Chunking keeps each
# request comfortably small and means a rejected chunk doesn't sink the run.
DEFAULT_BATCH_CHUNK_SIZE = 1000
DEFAULT_MODEL = "claude-sonnet-5"
# A CLI `--model` alias and the API model id name the SAME model, so both must record
# the same provenance. Without this map, a subscription-path run recorded
# `claude:sonnet` while every API-path run recorded `claude:claude-sonnet-5`, splitting
# one model into two labels in ai_enrichment.model_name — 46 rows against 10,471 after
# the #746 special-session run, which is exactly the shape that makes a later
# "which model wrote this?" query quietly wrong.
CLI_MODEL_ALIASES = {
    "sonnet": "claude-sonnet-5",
    "opus": "claude-opus-5",
    "haiku": "claude-haiku-4-5-20251001",
}


def resolved_model_name(model: str, override: str | None = None) -> str:
    """The `ai_enrichment.model_name` to record for a generation run."""
    if override:
        return override
    return f"claude:{CLI_MODEL_ALIASES.get(model, model)}"


# Measured on #723's 3,222-bill run: output averages ~5,400 tokens per bill and
# reaches 10,922 on a long omnibus. At the old 8,192 roughly one bill in five was
# cut off mid-JSON, discarded, and retried at a bigger ceiling below — and every
# discarded attempt was billed. Two bills that needed 2 and 4 attempts each
# succeeded first try at 16,000. Raising this costs nothing when unused, since
# billing is per token generated, not per token allowed.
DEFAULT_MAX_TOKENS = 16000
DEFAULT_CONCURRENCY = 8
MAX_ATTEMPTS = 4
# Team-plan path: the Claude Code CLI binary (overridable for tests / non-PATH installs).
CLAUDE_CLI_BIN = os.environ.get("ALETHICAL_CLAUDE_CLI", "claude")
# Tools disallowed for the headless generation call — this is a pure text-to-JSON
# task, so the model never needs to act; belt-and-suspenders since --system-prompt
# already replaces the coding-agent default prompt.
_CLI_DISALLOWED_TOOLS = "Bash Edit Write Read WebFetch WebSearch Glob Grep"
# How long the API keeps the cached instruction prefix alive (#779). The default is
# 5 minutes; an hour costs a fraction of a cent more on the one write and survives a
# run that stalls, which #723's did (it stopped dead on an account credit failure).
CACHE_TTL = "1h"
# The instruction + schema block every bill's request repeats verbatim. Held as one
# constant because prompt caching only works while these bytes are identical on
# every call, and a second copy of the text would be free to drift out of step.
_SCHEMA_NOTE = (
    "\n\nReturn ONLY a single JSON object matching this schema. No prose, no "
    "markdown fences:\n" + json.dumps(SUMMARY_SCHEMA)
)
# Token counts worth adding up across a run: the cache columns say whether the
# prefix was reused, and the plain input/output columns price the run.
_USAGE_FIELDS = (
    "input_tokens",
    "output_tokens",
    "cache_creation_input_tokens",
    "cache_read_input_tokens",
)


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


def message_params(
    model: str,
    system: str,
    user: str,
    max_tokens: int,
    *,
    cache_instructions: bool = False,
) -> dict[str, Any]:
    """The Messages-API body for one bill.

    Shared by the live path and the batch path on purpose: a batch request is the
    same call with a different envelope, so building it in one place is what makes
    "the two paths produce identical text" true rather than hoped for.

    `cache_instructions` is the single deliberate difference between the two paths,
    and it changes **billing only** — not one word of what the model is sent. Every
    bill repeats the same instruction + schema text (~2,700 tokens, confirmed
    byte-identical across all 3,222 requests of the #723 run) and then adds its own
    bill text, which is exactly the shape prompt caching needs: the repeated part
    first, the part that varies after it. Asking the API to keep that repeated part
    means the second and every later call is billed about a tenth of the normal rate
    for it (#779). The bill text stays below it as an ordinary user message and is
    never folded in, because the API matches a stored copy by comparing a request
    from the start.

    **Why only the live path turns it on.** On the live path the calls are spread out
    enough that nearly all of them reuse the stored copy, so it is worth about $18 on
    a 3,222-bill run. Inside the bulk queue the reuse is best-effort, and requests
    that do *not* reuse it pay a small premium for storing it instead — so the same
    marker is somewhere between saving ~$9 and costing ~$10 on the same job, which is
    not a bet worth taking for a production write. That is the reasoning behind the
    deliberate omission recorded in #784, now with the downside numbered. Full costing
    in `docs/product-onboarding/ai-models-and-billing.md` §4.1 (Where the 50% bulk
    discount comes from, and who can reach it).
    """
    system_text = system + _SCHEMA_NOTE
    # A bare string when uncached, so the batch path's request bytes are exactly what
    # they were before this option existed; a single text block when cached, because
    # only a block can carry the marker.
    system_field: Any = system_text
    if cache_instructions:
        system_field = [
            {
                "type": "text",
                "text": system_text,
                "cache_control": {"type": "ephemeral", "ttl": CACHE_TTL},
            }
        ]
    return {
        "model": model,
        "max_tokens": max_tokens,
        "system": system_field,
        "messages": [{"role": "user", "content": user}],
    }


def _warm_cache(api_key: str, model: str, system: str) -> dict[str, Any]:
    """Pay to store the repeated instructions once, before the worker pool starts.

    A stored copy can only be reused once the response that stored it has begun, so
    firing N bills at the same instant would have every one of those first N pay full
    price for the same instructions. One request with `max_tokens` set to 0 reads the
    prompt, stores the copy and returns immediately with no answer and no output
    tokens billed, so the bills behind it reuse it instead of racing to store it
    again. It doubles as the proof that caching is on: the token counts it reports
    show the copy being stored.
    """
    resp = requests.post(
        ANTHROPIC_API_URL,
        headers=_api_headers(api_key),
        json=message_params(
            model,
            system,
            "warm the instruction cache",
            0,
            cache_instructions=True,
        ),
        timeout=120,
    )
    resp.raise_for_status()
    return dict(resp.json().get("usage") or {})


def _call_anthropic(
    api_key: str,
    model: str,
    system: str,
    user: str,
    max_tokens: int,
    *,
    max_attempts: int = MAX_ATTEMPTS,
    retry_ambiguous: bool = True,
    attempt_observer: Callable[[dict[str, Any] | None], None] | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Generate one bill's enrichment. Returns the validated content and the token
    counts the API reported for the successful attempt."""
    payload = message_params(model, system, user, max_tokens, cache_instructions=True)
    last_err: Exception | None = None
    if not 1 <= max_attempts <= MAX_ATTEMPTS:
        raise ValueError(f"max_attempts must be between 1 and {MAX_ATTEMPTS}")
    for attempt in range(max_attempts):
        usage: dict[str, Any] | None = None
        try:
            resp = requests.post(
                ANTHROPIC_API_URL,
                headers=_api_headers(api_key),
                json=payload,
                timeout=240,
            )
            if resp.status_code in (429, 500, 503, 529):
                raise RuntimeError(f"retryable {resp.status_code}: {resp.text[:200]}")
            resp.raise_for_status()
            data = resp.json()
            usage = dict(data.get("usage") or {})
            text = "".join(
                b.get("text", "")
                for b in data.get("content", [])
                if b.get("type") == "text"
            ).strip()
            content = _extract_json(text)
            errors = validate_summary_shape(content)
            if errors:
                raise ValueError(f"schema errors: {errors[:5]}")
            if attempt_observer is not None:
                attempt_observer(usage)
            return content, usage
        except Exception as exc:  # noqa: BLE001
            if attempt_observer is not None:
                attempt_observer(usage)
            last_err = exc
            if not retry_ambiguous and isinstance(
                exc,
                (requests.exceptions.ConnectionError, requests.exceptions.Timeout),
            ):
                raise
            # Exponential backoff; also nudge max_tokens up on truncation.
            if attempt + 1 < max_attempts:
                time.sleep(min(2**attempt, 30))
            if isinstance(exc, (ValueError, json.JSONDecodeError)):
                payload["max_tokens"] = min(payload["max_tokens"] + 2048, 16000)
    raise RuntimeError(
        f"anthropic call failed after {max_attempts} attempts: {last_err}"
    )


def _call_claude_cli(model: str, system: str, user: str) -> dict[str, Any]:
    """Team-plan path: generate one enrichment via the Claude Code CLI in headless
    mode (`claude -p`), which bills the Claude subscription (Team plan + overage)
    rather than the Anthropic API — no API credit needed. Same contract as
    :func:`_call_anthropic` (returns the validated, schema-shaped content dict), so
    the apply path is unchanged. `model` must be a CLI-recognized alias/id (e.g.
    "sonnet"); `--system-prompt` replaces the default coding-agent prompt with the
    enrichment prompt so the model just emits JSON. This path cannot use the
    instruction caching of :func:`_system_blocks` — the CLI takes a plain string and
    does its own caching — so the #779 saving applies to `--provider api` only."""
    cmd = [
        CLAUDE_CLI_BIN,
        "-p",
        user,
        "--model",
        model,
        "--system-prompt",
        system + _SCHEMA_NOTE,
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

    (
        run_dir,
        codex_manifest_path,
        requests_by_id,
        pending,
        skipped_done,
        total_items,
    ) = _pending_items(args)
    outputs_dir = run_dir / "outputs"
    model_name = resolved_model_name(args.model, args.model_name)

    print(
        json.dumps(
            {
                "run_dir": str(run_dir),
                "provider": provider,
                "model": args.model,
                "model_name": model_name,
                "total_items": total_items,
                "skipped_done": skipped_done,
                "to_generate": len(pending),
                "concurrency": args.concurrency,
            }
        ),
        flush=True,
    )

    # Write the shared instructions to the cache before the pool opens, so the first
    # wave of bills reads them instead of each paying for them (#779). A failure here
    # is not fatal — the run just pays full price for the first few calls.
    if provider == "api" and pending:
        warm_system, _ = _system_and_user(requests_by_id[pending[0].custom_id])
        try:
            print(
                json.dumps(
                    {"cache_warm": _warm_cache(api_key, args.model, warm_system)}
                ),
                flush=True,
            )
        except Exception as exc:  # noqa: BLE001
            print(json.dumps({"cache_warm_failed": str(exc)[:200]}), flush=True)

    done = 0
    failed: list[dict[str, str]] = []
    tokens = dict.fromkeys(_USAGE_FIELDS, 0)

    def work(item: Any) -> dict[str, Any]:
        system, user = _system_and_user(requests_by_id[item.custom_id])
        usage: dict[str, Any] = {}
        if provider == "claude-cli":
            content = _call_claude_cli(args.model, system, user)
        else:
            content, usage = _call_anthropic(
                api_key, args.model, system, user, DEFAULT_MAX_TOKENS
            )
        out_path = outputs_dir / f"{safe_custom_id(item.custom_id)}.jsonl"
        out_path.write_text(
            json.dumps(output_row(item.custom_id, content), ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        return usage

    with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
        futures = {pool.submit(work, item): item for item in pending}
        for fut in as_completed(futures):
            item = futures[fut]
            try:
                usage = fut.result()
                done += 1
                # Summed here in the single consuming thread, so no lock is needed.
                for field in _USAGE_FIELDS:
                    tokens[field] += int(usage.get(field) or 0)
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
                # cache_read_input_tokens well above cache_creation_input_tokens is
                # the run saying the shared instructions were reused rather than
                # re-billed. Zero reads on an `api` run of more than one bill means
                # caching silently did nothing — investigate before pricing the run.
                "token_usage": tokens,
                "combine": combine,
            },
            indent=2,
        )
    )


def _api_headers(api_key: str) -> dict[str, str]:
    return {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }


def _pending_items(
    args: argparse.Namespace,
) -> tuple[Path, Path, dict[str, dict[str, Any]], list[Any], int, int]:
    """Resolve the run directory and the items still needing generation.

    Shared by the live and batch entrypoints so both skip already-written bills
    the same way — that skip is what makes an interrupted run cost nothing to
    restart.
    """
    run_dir = Path(args.run_dir)
    outputs_dir = run_dir / "outputs"
    outputs_dir.mkdir(parents=True, exist_ok=True)
    model_name = resolved_model_name(args.model, args.model_name)

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
        if (outputs_dir / f"{safe_custom_id(item.custom_id)}.jsonl").exists():
            skipped_done += 1
            continue
        if item.custom_id in requests_by_id:
            pending.append(item)
        if args.limit is not None and len(pending) >= args.limit:
            break
    return (
        run_dir,
        codex_manifest_path,
        requests_by_id,
        pending,
        skipped_done,
        len(items),
    )


def batch_submit(args: argparse.Namespace) -> None:
    """Hand the pending bills to Anthropic's Message Batches queue.

    Half the price of the live path in exchange for a best-effort turnaround of up
    to 24 hours. Batch ids are written to ``run_dir/batch.json`` before anything
    else happens, so a killed terminal never loses a submitted (and billed) job.
    """
    api_key = args.api_key or os.environ.get("ANTHROPIC_API_KEY")
    if not api_key and not args.dry_run:
        raise SystemExit("ANTHROPIC_API_KEY is required for batch-submit")

    run_dir, _, requests_by_id, pending, skipped_done, total = _pending_items(args)
    state_path = run_dir / "batch.json"
    if state_path.exists() and not args.dry_run:
        raise SystemExit(
            f"{state_path} already exists — collect it (or delete it) before "
            "submitting again, so a paid batch is never submitted twice."
        )

    # Anthropic requires custom_id to match [a-zA-Z0-9_-]{1,64}; our bill keys carry
    # dots and can be longer, so batches are keyed by position and mapped back.
    id_map: dict[str, str] = {}
    payloads: list[dict[str, Any]] = []
    for index, item in enumerate(pending):
        batch_id = f"req-{index:06d}"
        id_map[batch_id] = item.custom_id
        system, user = _system_and_user(requests_by_id[item.custom_id])
        payloads.append(
            {
                "custom_id": batch_id,
                "params": message_params(args.model, system, user, DEFAULT_MAX_TOKENS),
            }
        )

    chunks = [
        payloads[start : start + args.chunk_size]
        for start in range(0, len(payloads), args.chunk_size)
    ]
    est_chars = sum(len(json.dumps(p)) for p in payloads)
    summary = {
        "run_dir": str(run_dir),
        "model": args.model,
        "total_items": total,
        "skipped_done": skipped_done,
        "to_submit": len(payloads),
        "chunks": len(chunks),
        "estimated_request_bytes": est_chars,
        # ~4 chars per token is the standard rough conversion; batch input is
        # billed at half the live rate.
        "estimated_input_tokens": est_chars // 4,
    }
    if args.dry_run:
        print(json.dumps({**summary, "dry_run": True}, indent=2))
        return

    batches: list[dict[str, Any]] = []
    for chunk in chunks:
        resp = requests.post(
            ANTHROPIC_BATCHES_URL,
            headers=_api_headers(api_key),
            json={"requests": chunk},
            timeout=600,
        )
        resp.raise_for_status()
        body = resp.json()
        batches.append({"id": body["id"], "request_count": len(chunk)})
        # Persist after every accepted chunk: a crash mid-loop must not orphan a
        # batch that Anthropic is already billing us for.
        state_path.write_text(
            json.dumps(
                {
                    "model": args.model,
                    "model_name": resolved_model_name(args.model, args.model_name),
                    "batches": batches,
                    "custom_id_map": id_map,
                },
                indent=2,
            ),
            encoding="utf-8",
        )
    print(json.dumps({**summary, "batches": batches}, indent=2))


def batch_collect(args: argparse.Namespace) -> None:
    """Poll the submitted batches and write their results as per-bill outputs.

    Writes the same rows the live path writes, so ``apply`` cannot tell which path
    produced them. Only successful, schema-valid results are written; anything
    else is reported and left pending for a re-submit.
    """
    api_key = args.api_key or os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise SystemExit("ANTHROPIC_API_KEY is required for batch-collect")

    run_dir = Path(args.run_dir)
    state_path = run_dir / "batch.json"
    if not state_path.exists():
        raise SystemExit(f"no {state_path} — run batch-submit first")
    state = json.loads(state_path.read_text(encoding="utf-8"))
    id_map: dict[str, str] = state["custom_id_map"]
    outputs_dir = run_dir / "outputs"
    outputs_dir.mkdir(parents=True, exist_ok=True)

    statuses = []
    for batch in state["batches"]:
        resp = requests.get(
            f"{ANTHROPIC_BATCHES_URL}/{batch['id']}",
            headers=_api_headers(api_key),
            timeout=120,
        )
        resp.raise_for_status()
        body = resp.json()
        statuses.append(
            {
                "id": batch["id"],
                "processing_status": body.get("processing_status"),
                "request_counts": body.get("request_counts"),
            }
        )

    unfinished = [s for s in statuses if s["processing_status"] != "ended"]
    if unfinished:
        print(json.dumps({"ready": False, "batches": statuses}, indent=2))
        return

    written = 0
    problems: list[dict[str, str]] = []
    for batch in state["batches"]:
        resp = requests.get(
            f"{ANTHROPIC_BATCHES_URL}/{batch['id']}/results",
            headers=_api_headers(api_key),
            timeout=1800,
        )
        resp.raise_for_status()
        for line in resp.text.splitlines():
            if not line.strip():
                continue
            row = json.loads(line)
            custom_id = id_map.get(row.get("custom_id", ""), "")
            result = row.get("result") or {}
            if not custom_id:
                problems.append(
                    {"custom_id": row.get("custom_id", ""), "error": "unmapped"}
                )
                continue
            if result.get("type") != "succeeded":
                problems.append(
                    {"custom_id": custom_id, "error": str(result.get("type"))}
                )
                continue
            text = "".join(
                b.get("text", "")
                for b in (result.get("message") or {}).get("content", [])
                if b.get("type") == "text"
            ).strip()
            try:
                content = _extract_json(text)
                errors = validate_summary_shape(content)
                if errors:
                    raise ValueError(f"schema errors: {errors[:5]}")
            except Exception as exc:  # noqa: BLE001
                problems.append({"custom_id": custom_id, "error": str(exc)[:200]})
                continue
            (outputs_dir / f"{safe_custom_id(custom_id)}.jsonl").write_text(
                json.dumps(output_row(custom_id, content), ensure_ascii=False) + "\n",
                encoding="utf-8",
            )
            written += 1

    # Rewrite rather than assume submit left it here: collect is the step someone
    # runs a day later, often from a different terminal.
    manifest_path = Path(args.manifest_path)
    codex_manifest_path = write_codex_manifest(
        manifest_path,
        run_dir / f"{manifest_path.stem}.codex.manifest.json",
        model_name=state["model_name"],
    )
    combine = combine_output_files(
        run_dir=run_dir,
        manifest_path=codex_manifest_path,
        output_path=run_dir / "combined.output.jsonl",
    )
    print(
        json.dumps(
            {
                "ready": True,
                "batches": statuses,
                "written": written,
                "problems": len(problems),
                "problem_sample": problems[:10],
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

    sub_cmd = sub.add_parser(
        "batch-submit",
        help=(
            "Submit the prepared batch to Anthropic Message Batches (50%% off, "
            "best-effort within 24h). Use for unattended bulk runs; use 'generate' "
            "when you need the result in the next hour."
        ),
    )
    sub_cmd.add_argument("--manifest-path", required=True)
    sub_cmd.add_argument("--jsonl-path", required=True)
    sub_cmd.add_argument("--run-dir", default=".tmp/anthropic-ai-runs/regen")
    sub_cmd.add_argument("--model", default=DEFAULT_MODEL)
    sub_cmd.add_argument("--model-name", default=None)
    sub_cmd.add_argument("--limit", type=int, default=None)
    sub_cmd.add_argument("--chunk-size", type=int, default=DEFAULT_BATCH_CHUNK_SIZE)
    sub_cmd.add_argument(
        "--dry-run",
        action="store_true",
        help="Report request count and estimated tokens without submitting or spending.",
    )
    sub_cmd.set_defaults(func=batch_submit)

    col = sub.add_parser(
        "batch-collect",
        help="Poll submitted batches and write finished results as per-bill outputs.",
    )
    col.add_argument("--manifest-path", required=True)
    col.add_argument("--run-dir", default=".tmp/anthropic-ai-runs/regen")
    col.set_defaults(func=batch_collect)
    return parser


def main() -> None:
    args = build_parser().parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
