from __future__ import annotations

import asyncio
import json
import math
import subprocess
from argparse import Namespace
from pathlib import Path
from typing import Any

from oban import Record, worker

from alethical.db.session import database_url_for_target, get_database_url


async def _enqueue_child(
    worker_cls: Any, args: dict[str, Any], *, force: bool = False
) -> dict[str, Any]:
    from alethical.pipeline.oban import enqueue_unique, open_pool, oban_dsn, task_key

    child_args = dict(args)
    child_args["task_key"] = child_args.get("task_key") or task_key(
        child_args.pop("_kind"), child_args
    )
    oban_value = child_args.get("oban_dsn")
    if oban_value is None:
        oban_value = database_url_for_target(
            str(child_args.get("oban_target") or "local")
        )
    pool = await open_pool(oban_dsn(str(oban_value)))
    try:
        return await enqueue_unique(pool, worker_cls, child_args, force=force)
    finally:
        await pool.close()


def _database_url(args: dict[str, Any]) -> str:
    if args.get("database_url"):
        return str(database_url_for_target(None, str(args["database_url"])))
    if args.get("database_target"):
        return str(database_url_for_target(str(args["database_target"])))
    return get_database_url()


def _bool_arg(args: dict[str, Any], name: str, default: bool = False) -> bool:
    value = args.get(name, default)
    if isinstance(value, str):
        return value.lower() in {"1", "true", "yes", "on"}
    return bool(value)


@worker(queue="maintenance", max_attempts=1, tags=["smoke"])
class ObanSmokeWorker:
    async def process(self, job):
        return Record(
            {
                "ok": True,
                "message": str(job.args.get("message") or "oban smoke ok"),
                "task_key": job.args.get("task_key"),
            }
        )


@worker(queue="source_sync", max_attempts=1, tags=["pipeline", "coordinator"])
class PipelineRunWorker:
    async def process(self, job):
        database_url = _database_url(job.args)
        common = {
            "database_target": job.args.get("database_target"),
            "oban_target": job.args.get("oban_target"),
            "oban_dsn": job.args.get("oban_dsn"),
        }
        if job.args.get("database_url"):
            common["database_url"] = database_url
        dry_run = _bool_arg(job.args, "dry_run", True)
        allow_writes = _bool_arg(job.args, "allow_writes", False)
        run_id = str(job.args.get("run_id") or job.args.get("task_key") or "manual")
        force_job = _bool_arg(job.args, "force_child_jobs", False)

        children = []
        if _bool_arg(job.args, "include_bills", True):
            children.append(
                await _enqueue_child(
                    FullBillSyncWorker,
                    {
                        **common,
                        "_kind": "full-bill-sync",
                        "task_key": f"{run_id}:full-bill-sync",
                        "session_code": str(job.args.get("session_code") or "0942025"),
                        "max_bill_number": int(job.args.get("max_bill_number") or 6000),
                        "chunk_size": int(job.args.get("chunk_size") or 25),
                        "refresh_existing": _bool_arg(
                            job.args, "refresh_existing", False
                        ),
                        "dry_run": dry_run,
                        "allow_writes": allow_writes,
                    },
                    force=force_job,
                )
            )
        if _bool_arg(job.args, "include_committees", True):
            children.append(
                await _enqueue_child(
                    CommitteeMembershipBackfillWorker,
                    {
                        **common,
                        "_kind": "committee-backfill",
                        "task_key": f"{run_id}:committee-backfill",
                        "dry_run": dry_run,
                        "cleanup_orphans": _bool_arg(
                            job.args, "cleanup_orphans", False
                        ),
                    },
                    force=force_job,
                )
            )
        if _bool_arg(job.args, "include_votes", True):
            children.append(
                await _enqueue_child(
                    VoteBackfillWorker,
                    {
                        **common,
                        "_kind": "vote-backfill",
                        "task_key": f"{run_id}:vote-backfill",
                        "dry_run": dry_run,
                        "limit": job.args.get("vote_limit"),
                    },
                    force=force_job,
                )
            )
        if _bool_arg(job.args, "include_ai_prepare", True):
            children.append(
                await _enqueue_child(
                    AiBatchPrepareWorker,
                    {
                        **common,
                        "_kind": "ai-prepare",
                        "task_key": f"{run_id}:ai-prepare",
                        "model": str(job.args.get("model") or "gpt-4o-mini"),
                        "session": str(job.args.get("session") or "94-2025-regular"),
                        "bill_key": job.args.get("bill_key"),
                        "limit": job.args.get("ai_limit"),
                        "max_input_chars": int(
                            job.args.get("max_input_chars") or 60_000
                        ),
                        "force": _bool_arg(job.args, "force_enrichment", False),
                        "only_missing_current": _bool_arg(
                            job.args, "only_missing_current_ai", False
                        ),
                        "output_dir": str(
                            job.args.get("output_dir") or ".tmp/openai-batches"
                        ),
                    },
                    force=force_job,
                )
            )

        return Record({"dry_run": dry_run, "run_id": run_id, "children": children})


@worker(queue="source_sync", max_attempts=2, tags=["ingestion", "bills"])
class FullBillSyncWorker:
    async def process(self, job):
        from alethical.pipeline.minnesota import MinnesotaIngestionPipeline
        from sqlalchemy import create_engine
        from sqlalchemy.orm import Session

        def run() -> dict[str, Any]:
            engine = create_engine(_database_url(job.args), pool_pre_ping=True)
            with Session(engine) as db:
                pipeline = MinnesotaIngestionPipeline(db)
                targets = pipeline.discover_bill_targets(
                    session_code=str(job.args.get("session_code") or "0942025"),
                    max_bill_number=int(job.args.get("max_bill_number") or 6000),
                    only_missing=not _bool_arg(job.args, "refresh_existing", False),
                )
                chunk_size = max(1, int(job.args.get("chunk_size") or 25))
                if _bool_arg(job.args, "dry_run", True):
                    return {
                        "dry_run": True,
                        "targets_discovered": len(targets),
                        "chunk_size": chunk_size,
                        "chunks_discovered": math.ceil(len(targets) / chunk_size),
                        "sample": [
                            f"{target.chamber} {target.bill_number}"
                            for target in targets[:10]
                        ],
                    }
                if not _bool_arg(job.args, "allow_writes", False):
                    raise ValueError(
                        "Full bill sync requires allow_writes=true when dry_run=false"
                    )

                return {
                    "dry_run": False,
                    "targets_discovered": len(targets),
                    "chunk_size": chunk_size,
                    "chunks_discovered": math.ceil(len(targets) / chunk_size),
                    "sample": [
                        f"{target.chamber} {target.bill_number}"
                        for target in targets[:10]
                    ],
                    "_targets": [target.__dict__ for target in targets],
                }

        result = await asyncio.to_thread(run)
        if not _bool_arg(job.args, "dry_run", True):
            chunk_size = int(result["chunk_size"])
            targets = list(result.pop("_targets"))
            children = []
            run_id = str(job.args.get("task_key") or "full-bill-sync")
            common = {
                "database_target": job.args.get("database_target"),
                "oban_target": job.args.get("oban_target"),
                "oban_dsn": job.args.get("oban_dsn"),
            }
            if job.args.get("database_url"):
                common["database_url"] = _database_url(job.args)
            for chunk_index in range(0, len(targets), chunk_size):
                chunk = targets[chunk_index : chunk_index + chunk_size]
                children.append(
                    await _enqueue_child(
                        BillSyncChunkWorker,
                        {
                            **common,
                            "_kind": "bill-sync-chunk",
                            "task_key": f"{run_id}:chunk-{chunk_index // chunk_size + 1:04d}",
                            "dry_run": False,
                            "allow_writes": True,
                            "targets": chunk,
                            "include_rag": _bool_arg(job.args, "include_rag", True),
                            "rag_target": str(
                                job.args.get("rag_target") or "production"
                            ),
                            "rag_model": str(
                                job.args.get("rag_model") or "demo-minilm-1536"
                            ),
                            "rag_embedding_batch_size": int(
                                job.args.get("rag_embedding_batch_size") or 32
                            ),
                        },
                        force=_bool_arg(job.args, "force_chunks", False),
                    )
                )
            result["children"] = children

        return Record(result)


@worker(queue="bill_sync", max_attempts=3, tags=["ingestion", "bills", "chunk"])
class BillSyncChunkWorker:
    async def process(self, job):
        from alethical.pipeline.minnesota import BillTarget, MinnesotaIngestionPipeline
        from sqlalchemy import create_engine
        from sqlalchemy.orm import Session

        def run() -> dict[str, Any]:
            targets = [
                BillTarget(
                    chamber=str(item["chamber"]),
                    bill_number=str(item["bill_number"]),
                    session_code=str(item.get("session_code") or "0942025"),
                )
                for item in job.args.get("targets", [])
            ]
            if not targets:
                return {
                    "dry_run": _bool_arg(job.args, "dry_run", True),
                    "bills_ingested": 0,
                    "bill_keys": [],
                }
            if _bool_arg(job.args, "dry_run", True):
                return {
                    "dry_run": True,
                    "bills_discovered": len(targets),
                    "sample": [
                        f"{target.chamber} {target.bill_number}"
                        for target in targets[:10]
                    ],
                }
            if not _bool_arg(job.args, "allow_writes", False):
                raise ValueError(
                    "Bill sync chunk requires allow_writes=true when dry_run=false"
                )

            engine = create_engine(_database_url(job.args), pool_pre_ping=True)
            with Session(engine) as db:
                pipeline = MinnesotaIngestionPipeline(db)
                stats = pipeline.ingest_bills(targets)
                if _bool_arg(job.args, "include_rag", True):
                    from alethical.pipeline.rag_ingest import (
                        build_rag_rows_for_bill_keys,
                    )

                    rag_target = str(
                        job.args.get("rag_target")
                        or job.args.get("database_target")
                        or "local"
                    )
                    if rag_target != "production":
                        raise ValueError(
                            "Bill sync chunk rag stage requires rag_target=production when allow_writes=true"
                        )
                    rag_db = _database_url({"database_target": rag_target})
                    rag_engine = create_engine(rag_db, pool_pre_ping=True)
                    with Session(rag_engine) as rag_db_session:
                        rag_stats = build_rag_rows_for_bill_keys(
                            rag_db_session,
                            bill_keys=stats.get("bill_keys", []),
                            dry_run=False,
                            rag_model=str(
                                job.args.get("rag_model") or "demo-minilm-1536"
                            ),
                            rag_embedding_batch_size=int(
                                job.args.get("rag_embedding_batch_size") or 32
                            ),
                        )
                        rag_db_session.commit()
                        stats.update(rag_stats)
                db.commit()
                return {"dry_run": False, **stats}

        return Record(await asyncio.to_thread(run))


@worker(queue="committee_sync", max_attempts=3, tags=["ingestion", "committee"])
class CommitteeMembershipBackfillWorker:
    async def process(self, job):
        from alethical.pipeline.committee_memberships import backfill
        from sqlalchemy import create_engine
        from sqlalchemy.orm import Session

        def run() -> dict[str, Any]:
            engine = create_engine(_database_url(job.args), pool_pre_ping=True)
            with Session(engine) as db:
                stats = backfill(
                    db,
                    dry_run=_bool_arg(job.args, "dry_run", True),
                    cleanup_orphans=_bool_arg(job.args, "cleanup_orphans", False),
                )
                return stats.__dict__

        return Record(await asyncio.to_thread(run))


@worker(queue="vote_sync", max_attempts=3, tags=["ingestion", "votes"])
class VoteBackfillWorker:
    async def process(self, job):
        from alethical.pipeline.votes import backfill_votes
        from sqlalchemy import create_engine
        from sqlalchemy.orm import Session

        def run() -> dict[str, Any]:
            engine = create_engine(_database_url(job.args), pool_pre_ping=True)
            with Session(engine) as db:
                stats = backfill_votes(
                    db,
                    limit=job.args.get("limit"),
                    dry_run=_bool_arg(job.args, "dry_run", True),
                )
                return stats.__dict__

        return Record(await asyncio.to_thread(run))


@worker(queue="ai_batch", max_attempts=2, tags=["ai", "batch", "prepare"])
class AiBatchPrepareWorker:
    async def process(self, job):
        from alethical.pipeline.ai_enrichment import prepare_batch

        def run() -> dict[str, Any]:
            output_dir = str(job.args.get("output_dir") or ".tmp/openai-batches")
            before = {
                path.name
                for path in Path(output_dir).glob("ai-enrichment-*.manifest.json")
            }
            prepare_batch(
                Namespace(
                    database_url=_database_url(job.args),
                    output_dir=output_dir,
                    model=str(job.args.get("model") or "gpt-4o-mini"),
                    session=str(job.args.get("session") or "94-2025-regular"),
                    bill_key=job.args.get("bill_key"),
                    limit=job.args.get("limit"),
                    max_input_chars=int(job.args.get("max_input_chars") or 60_000),
                    force=_bool_arg(job.args, "force", False),
                    only_missing_current=_bool_arg(
                        job.args, "only_missing_current", False
                    ),
                )
            )
            after = sorted(
                path
                for path in Path(output_dir).glob("ai-enrichment-*.manifest.json")
                if path.name not in before
            )
            return {
                "output_dir": output_dir,
                "manifest_path": str(after[-1]) if after else None,
            }

        return Record(await asyncio.to_thread(run))


@worker(queue="ai_apply", max_attempts=2, tags=["ai", "batch", "apply"])
class AiBatchApplyWorker:
    async def process(self, job):
        from alethical.pipeline.ai_enrichment import apply_output

        if not _bool_arg(job.args, "dry_run", True) and not _bool_arg(
            job.args, "allow_writes", False
        ):
            raise ValueError(
                "AI batch apply requires allow_writes=true when dry_run=false"
            )

        def run() -> dict[str, Any]:
            apply_output(
                Namespace(
                    api_key=job.args.get("api_key"),
                    database_url=_database_url(job.args),
                    output_dir=str(job.args.get("output_dir") or ".tmp/openai-batches"),
                    manifest_path=job.args["manifest_path"],
                    batch_id=job.args.get("batch_id"),
                    output_path=job.args.get("output_path"),
                    dry_run=_bool_arg(job.args, "dry_run", True),
                )
            )
            return {"dry_run": _bool_arg(job.args, "dry_run", True)}

        return Record(await asyncio.to_thread(run))


@worker(queue="ai_batch", max_attempts=1, tags=["ai", "codex", "coordinator"])
class CodexAiEnqueueWorker:
    async def process(self, job):
        from alethical.pipeline.codex_enrichment import (
            load_jsonl_requests,
            load_manifest_items,
            prompt_from_request,
            safe_custom_id,
            write_codex_manifest,
            write_schema,
        )

        manifest_path = Path(str(job.args["manifest_path"]))
        jsonl_path = Path(str(job.args["jsonl_path"]))
        run_dir = Path(
            str(
                job.args.get("run_dir")
                or ".tmp/codex-ai-runs/production-missing-current"
            )
        )
        prompts_dir = run_dir / "prompts"
        outputs_dir = run_dir / "outputs"
        schema_path = write_schema(run_dir / "summary-schema.json")
        codex_model = str(job.args.get("codex_model") or "gpt-5.5")
        model_name = str(job.args.get("model_name") or f"codex:{codex_model}")
        codex_manifest_path = write_codex_manifest(
            manifest_path,
            run_dir / f"{manifest_path.stem}.codex.manifest.json",
            model_name=model_name,
        )

        def prepare_files() -> tuple[list[dict[str, Any]], int]:
            requests = load_jsonl_requests(jsonl_path)
            items = load_manifest_items(codex_manifest_path)
            limit = job.args.get("limit")
            remaining = []
            skipped_done = 0
            for item in items:
                safe_id = safe_custom_id(item.custom_id)
                output_path = outputs_dir / f"{safe_id}.jsonl"
                if output_path.exists():
                    skipped_done += 1
                    continue
                request = requests.get(item.custom_id)
                if request is None:
                    continue
                prompt_path = prompts_dir / f"{safe_id}.prompt.txt"
                prompt_path.parent.mkdir(parents=True, exist_ok=True)
                output_path.parent.mkdir(parents=True, exist_ok=True)
                prompt_path.write_text(prompt_from_request(request), encoding="utf-8")
                remaining.append(
                    {
                        "custom_id": item.custom_id,
                        "prompt_path": str(prompt_path),
                        "schema_path": str(schema_path),
                        "output_path": str(output_path),
                        "run_dir": str(run_dir),
                        "oban_target": job.args.get("oban_target"),
                        "oban_dsn": job.args.get("oban_dsn"),
                        "codex_model": codex_model,
                        "task_key": f"{job.args.get('task_key')}:request:{safe_id}",
                    }
                )
                if limit is not None and len(remaining) >= int(limit):
                    break
            return remaining, skipped_done

        child_args, skipped_done = await asyncio.to_thread(prepare_files)
        children = []
        for args in child_args:
            children.append(
                await _enqueue_child(
                    CodexAiRequestWorker,
                    {"_kind": "codex-ai-request", **args},
                    force=False,
                )
            )
        return Record(
            {
                "run_dir": str(run_dir),
                "codex_manifest_path": str(codex_manifest_path),
                "jsonl_path": str(jsonl_path),
                "enqueued": len(children),
                "skipped_done": skipped_done,
                "children": children,
            }
        )


@worker(queue="ai_codex", max_attempts=2, tags=["ai", "codex", "request"])
class CodexAiRequestWorker:
    async def process(self, job):
        from alethical.pipeline.codex_enrichment import output_row

        def run() -> dict[str, Any]:
            custom_id = str(job.args["custom_id"])
            prompt_path = Path(str(job.args["prompt_path"]))
            schema_path = Path(str(job.args["schema_path"]))
            output_path = Path(str(job.args["output_path"]))
            response_path = output_path.with_suffix(".response.json")
            codex_model = str(job.args.get("codex_model") or "gpt-5.5")
            if output_path.exists():
                return {
                    "custom_id": custom_id,
                    "output_path": str(output_path),
                    "skipped": True,
                }

            with prompt_path.open("r", encoding="utf-8") as handle:
                completed = subprocess.run(
                    [
                        "codex",
                        "exec",
                        "--ephemeral",
                        "--sandbox",
                        "read-only",
                        "--model",
                        codex_model,
                        "--output-schema",
                        str(schema_path),
                        "--output-last-message",
                        str(response_path),
                        "-C",
                        str(Path.cwd()),
                        "-",
                    ],
                    stdin=handle,
                    text=True,
                    capture_output=True,
                    check=False,
                )
            if completed.returncode != 0:
                raise RuntimeError(completed.stderr[-2000:] or completed.stdout[-2000:])

            content = json.loads(response_path.read_text(encoding="utf-8"))
            output_path.write_text(
                json.dumps(output_row(custom_id, content), ensure_ascii=False) + "\n",
                encoding="utf-8",
            )
            return {
                "custom_id": custom_id,
                "output_path": str(output_path),
                "response_path": str(response_path),
                "skipped": False,
            }

        return Record(await asyncio.to_thread(run))


@worker(queue="ai_codex", max_attempts=1, tags=["ai", "codex", "combine"])
class CodexAiCombineWorker:
    async def process(self, job):
        from alethical.pipeline.codex_enrichment import combine_output_files

        def run() -> dict[str, Any]:
            return combine_output_files(
                run_dir=Path(str(job.args["run_dir"])),
                manifest_path=Path(str(job.args["manifest_path"]))
                if job.args.get("manifest_path")
                else None,
                output_path=Path(str(job.args["output_path"]))
                if job.args.get("output_path")
                else None,
            )

        return Record(await asyncio.to_thread(run))
