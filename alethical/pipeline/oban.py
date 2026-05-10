#!/usr/bin/env python3
from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
from typing import Any

from oban import Oban
from oban.schema import install as install_oban_schema
from oban.testing import drain_queue
from psycopg_pool import AsyncConnectionPool

from alethical.db.session import database_url_for_target, get_database_url, normalize_database_url
from alethical.pipeline.oban_workers import (
    AiBatchApplyWorker,
    AiBatchPrepareWorker,
    BillSyncChunkWorker,
    CodexAiCombineWorker,
    CodexAiEnqueueWorker,
    CodexAiRequestWorker,
    CommitteeMembershipBackfillWorker,
    FullBillSyncWorker,
    ObanSmokeWorker,
    PipelineRunWorker,
    VoteBackfillWorker,
)


ACTIVE_STATES = ("available", "scheduled", "retryable", "executing", "completed")


WORKERS = {
    "smoke": ObanSmokeWorker,
    "pipeline-run": PipelineRunWorker,
    "full-bill-sync": FullBillSyncWorker,
    "bill-sync-chunk": BillSyncChunkWorker,
    "ai-prepare": AiBatchPrepareWorker,
    "ai-apply": AiBatchApplyWorker,
    "codex-ai-enqueue": CodexAiEnqueueWorker,
    "codex-ai-request": CodexAiRequestWorker,
    "codex-ai-combine": CodexAiCombineWorker,
    "committee-backfill": CommitteeMembershipBackfillWorker,
    "vote-backfill": VoteBackfillWorker,
}


def oban_dsn(value: str | None = None) -> str:
    url = normalize_database_url(value or os.environ.get("OBAN_DSN") or get_database_url())
    if url.startswith("postgresql+psycopg://"):
        return "postgresql://" + url.removeprefix("postgresql+psycopg://")
    if url.startswith("postgresql+"):
        return "postgresql://" + re.sub(r"^postgresql\\+[^:]+://", "", url)
    return url


def dsn_for_args(args: argparse.Namespace) -> str:
    if args.dsn:
        return oban_dsn(args.dsn)
    return oban_dsn(database_url_for_target(args.target, None))


async def open_pool(dsn: str) -> AsyncConnectionPool:
    pool = AsyncConnectionPool(conninfo=dsn, min_size=1, max_size=5, open=False)
    await pool.open()
    await pool.wait()
    return pool


async def existing_job_id(pool: AsyncConnectionPool, *, worker: str, queue: str, task_key: str) -> int | None:
    async with pool.connection() as conn:
        row = await conn.execute(
            """
            select id
            from oban_jobs
            where worker = %s
              and queue = %s
              and args->>'task_key' = %s
              and state = any(%s::oban_job_state[])
            order by id desc
            limit 1
            """,
            (worker, queue, task_key, list(ACTIVE_STATES)),
        )
        result = await row.fetchone()
        return int(result[0]) if result else None


async def enqueue_unique(pool: AsyncConnectionPool, worker_cls: Any, args: dict[str, Any], *, force: bool = False):
    oban = Oban(pool=pool, queues={})
    job = worker_cls.new(args)
    task_key = str(args.get("task_key") or "")
    if task_key and not force:
        existing = await existing_job_id(pool, worker=job.worker, queue=job.queue, task_key=task_key)
        if existing is not None:
            return {"inserted": False, "existing_job_id": existing, "worker": job.worker, "queue": job.queue}
    inserted = await oban.enqueue(job)
    return {"inserted": True, "job_id": inserted.id, "worker": inserted.worker, "queue": inserted.queue}


def task_key(prefix: str, args: dict[str, Any]) -> str:
    stable_args = {key: args.get(key) for key in sorted(args) if key not in {"database_url", "oban_dsn", "api_key"}}
    return f"{prefix}:{json.dumps(stable_args, sort_keys=True, separators=(',', ':'))}"


async def install(args: argparse.Namespace) -> None:
    pool = await open_pool(dsn_for_args(args))
    try:
        await install_oban_schema(pool, prefix=args.prefix)
    finally:
        await pool.close()
    print(json.dumps({"installed": True, "prefix": args.prefix}, indent=2))


async def enqueue(args: argparse.Namespace) -> None:
    target_database_url = database_url_for_target(args.target, args.database_url)
    target_oban_dsn = args.dsn or target_database_url
    pool = await open_pool(oban_dsn(target_oban_dsn))
    try:
        job_args: dict[str, Any] = {
            "database_target": args.target,
            "oban_target": args.target,
        }
        if args.database_url:
            job_args["database_url"] = normalize_database_url(target_database_url)
        if args.dsn:
            job_args["oban_dsn"] = args.dsn

        if args.kind == "smoke":
            job_args.update({"message": args.message})
        elif args.kind == "pipeline-run":
            job_args.update(
                {
                    "run_id": args.run_id,
                    "session_code": args.session_code,
                    "session": args.session,
                    "max_bill_number": args.max_bill_number,
                    "chunk_size": args.chunk_size,
                    "refresh_existing": args.refresh_existing,
                    "dry_run": args.dry_run,
                    "allow_writes": args.allow_writes,
                    "include_bills": not args.skip_bills,
                    "include_committees": not args.skip_committees,
                    "include_votes": not args.skip_votes,
                    "include_ai_prepare": not args.skip_ai_prepare,
                    "model": args.model,
                    "ai_limit": args.ai_limit,
                    "vote_limit": args.vote_limit,
                    "max_input_chars": args.max_input_chars,
                    "force_enrichment": args.force_enrichment,
                    "only_missing_current_ai": args.only_missing_current_ai,
                    "force_child_jobs": args.force_child_jobs,
                    "output_dir": args.output_dir,
                    "cleanup_orphans": args.cleanup_orphans,
                }
            )
        elif args.kind == "full-bill-sync":
            job_args.update(
                {
                    "session_code": args.session_code,
                    "max_bill_number": args.max_bill_number,
                    "chunk_size": args.chunk_size,
                    "refresh_existing": args.refresh_existing,
                    "dry_run": args.dry_run,
                    "allow_writes": args.allow_writes,
                }
            )
        elif args.kind == "bill-sync-chunk":
            job_args.update(
                {
                    "targets": json.loads(args.targets_json),
                    "dry_run": args.dry_run,
                    "allow_writes": args.allow_writes,
                }
            )
        elif args.kind == "ai-prepare":
            job_args.update(
                {
                    "model": args.model,
                    "session": args.session,
                    "bill_key": args.bill_key,
                    "limit": args.limit,
                    "max_input_chars": args.max_input_chars,
                    "force": args.force_enrichment,
                    "only_missing_current": args.only_missing_current_ai,
                    "output_dir": args.output_dir,
                }
            )
        elif args.kind == "ai-apply":
            job_args.update(
                {
                    "manifest_path": args.manifest_path,
                    "batch_id": args.batch_id,
                    "output_path": args.output_path,
                    "output_dir": args.output_dir,
                    "dry_run": args.dry_run,
                    "allow_writes": args.allow_writes,
                }
            )
        elif args.kind == "codex-ai-enqueue":
            job_args.update(
                {
                    "manifest_path": args.manifest_path,
                    "jsonl_path": args.jsonl_path,
                    "run_dir": args.run_dir,
                    "limit": args.limit,
                    "codex_model": args.codex_model,
                    "model_name": args.codex_model_name,
                }
            )
        elif args.kind == "codex-ai-request":
            job_args.update(
                {
                    "custom_id": args.custom_id,
                    "prompt_path": args.prompt_path,
                    "schema_path": args.schema_path,
                    "output_path": args.output_path,
                    "run_dir": args.run_dir,
                    "codex_model": args.codex_model,
                }
            )
        elif args.kind == "codex-ai-combine":
            job_args.update(
                {
                    "run_dir": args.run_dir,
                    "manifest_path": args.manifest_path,
                    "output_path": args.output_path,
                }
            )
        elif args.kind == "committee-backfill":
            job_args.update({"dry_run": args.dry_run, "cleanup_orphans": args.cleanup_orphans})
        elif args.kind == "vote-backfill":
            job_args.update({"dry_run": args.dry_run, "limit": args.limit})

        job_args["task_key"] = args.task_key or task_key(args.kind, job_args)
        result = await enqueue_unique(pool, WORKERS[args.kind], job_args, force=args.force_job)
    finally:
        await pool.close()
    print(json.dumps(result, indent=2))


async def drain(args: argparse.Namespace) -> None:
    pool = await open_pool(dsn_for_args(args))
    try:
        oban = Oban(pool=pool, queues={args.queue: args.concurrency})
        if args.concurrency <= 1:
            result = await drain_queue(queue=args.queue, oban=oban, with_safety=False)
        else:
            results = await asyncio.gather(
                *[
                    drain_queue(queue=args.queue, oban=oban, with_safety=False)
                    for _ in range(args.concurrency)
                ]
            )
            result = {
                key: sum(item.get(key, 0) for item in results)
                for key in ("cancelled", "completed", "discarded", "retryable", "scheduled")
            }
    finally:
        await pool.close()
    print(json.dumps(result, indent=2))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Alethical Oban pipeline controls.")
    parser.add_argument("--dsn", default=None)
    parser.add_argument(
        "--target",
        choices=["local", "production"],
        default=os.environ.get("ALETHICAL_PIPELINE_TARGET", "local"),
        help="Database target for Oban and job writes.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    install_parser = subparsers.add_parser("install", help="Install Oban database schema.")
    install_parser.add_argument("--prefix", default="public")
    install_parser.set_defaults(func=install)

    enqueue_parser = subparsers.add_parser("enqueue", help="Enqueue one pipeline job with task-key dedupe.")
    enqueue_parser.add_argument("kind", choices=sorted(WORKERS))
    enqueue_parser.add_argument("--database-url", default=None)
    enqueue_parser.add_argument("--task-key", default=None)
    enqueue_parser.add_argument("--force-job", action="store_true")
    enqueue_parser.add_argument("--message", default="oban smoke ok")
    enqueue_parser.add_argument("--run-id", default=None)
    enqueue_parser.add_argument("--model", default=os.environ.get("OPENAI_AI_ENRICHMENT_MODEL", "gpt-4o-mini"))
    enqueue_parser.add_argument("--session", default="94-2025-regular")
    enqueue_parser.add_argument("--session-code", default="0942025")
    enqueue_parser.add_argument("--bill-key", default=None)
    enqueue_parser.add_argument("--limit", type=int, default=None)
    enqueue_parser.add_argument("--ai-limit", type=int, default=None)
    enqueue_parser.add_argument("--vote-limit", type=int, default=None)
    enqueue_parser.add_argument("--max-bill-number", type=int, default=6000)
    enqueue_parser.add_argument("--chunk-size", type=int, default=25)
    enqueue_parser.add_argument("--targets-json", default="[]")
    enqueue_parser.add_argument("--refresh-existing", action="store_true")
    enqueue_parser.add_argument("--max-input-chars", type=int, default=60_000)
    enqueue_parser.add_argument("--force-enrichment", action="store_true")
    enqueue_parser.add_argument("--only-missing-current-ai", action="store_true")
    enqueue_parser.add_argument("--output-dir", default=".tmp/openai-batches")
    enqueue_parser.add_argument("--manifest-path", default=None)
    enqueue_parser.add_argument("--jsonl-path", default=None)
    enqueue_parser.add_argument("--batch-id", default=None)
    enqueue_parser.add_argument("--output-path", default=None)
    enqueue_parser.add_argument("--run-dir", default=".tmp/codex-ai-runs/production-missing-current")
    enqueue_parser.add_argument("--custom-id", default=None)
    enqueue_parser.add_argument("--prompt-path", default=None)
    enqueue_parser.add_argument("--schema-path", default=None)
    enqueue_parser.add_argument("--codex-model", default="gpt-5.5")
    enqueue_parser.add_argument("--codex-model-name", default=None)
    enqueue_parser.add_argument("--dry-run", action="store_true", default=True)
    enqueue_parser.add_argument("--write", dest="dry_run", action="store_false")
    enqueue_parser.add_argument("--allow-writes", action="store_true")
    enqueue_parser.add_argument("--cleanup-orphans", action="store_true")
    enqueue_parser.add_argument("--skip-bills", action="store_true")
    enqueue_parser.add_argument("--skip-committees", action="store_true")
    enqueue_parser.add_argument("--skip-votes", action="store_true")
    enqueue_parser.add_argument("--skip-ai-prepare", action="store_true")
    enqueue_parser.add_argument("--force-child-jobs", action="store_true")
    enqueue_parser.set_defaults(func=enqueue)

    drain_parser = subparsers.add_parser("drain", help="Run all currently available jobs in one queue inside this process.")
    drain_parser.add_argument("queue")
    drain_parser.add_argument("--concurrency", type=int, default=1)
    drain_parser.set_defaults(func=drain)
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    asyncio.run(args.func(args))


if __name__ == "__main__":
    main()
