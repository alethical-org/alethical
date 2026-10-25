# Production ingestion refresh guidance

For a new refresh, first read [data ingestion onboarding](../product-onboarding/data-ingestion-onboarding.md),
[source dispatch](source-refresh-dispatch.md) and [current refresh status](public-record-refresh-status.md),
then verify the current code, deployed configuration, source period, owning task and running jobs.
Use the shared [production-data-refresh method](https://github.com/euglopi/tool-settings/blob/main/shared/skills/production-data-refresh/SKILL.md).
This guide does not start a refresh, change schedules or grant permission to run paid enrichment.

## Historical full-biennium recovery record

The following record describes the July 2026 canonical bill refresh and its fixes. Its counts,
timings, environment observations, issue states and code examples are historical, not verified
current operating facts. Preserve the protections against deleting current versions and mixing
source refresh with paid enrichment or derived indexes. Reconcile the examples with current code
and the owning task before using them; no broad queue update or connection termination is safe
without proving ownership of every affected resource. A discarded job is a failure to account for,
not a successful refresh. This move does not alter the ongoing refresh task's procedures or holds.

## July 2026 refresh record (Alethical MN corpus)

**Net (plain-language):** This is the playbook for downloading Minnesota's ~10,000 bills fresh from the state website into our production database. It works, but the pipeline was built to run one batch at a time and has several traps that waste hours if you don't know them — this skill lists the traps and gives the one approach that reliably finishes.

## Goal & scope
Phase 2 = refresh the whole **94th biennium (~10,471 bills)**. Re-fetch each bill's current actions/status/text from the MN Revisor and **upsert canonical tables only**: `bill`, `bill_version`, `bill_action`, `sponsorship`.
- **No RAG.** `rag_*` is a separate teammate session's job — always run canonical-only; never call `build_rag_rows...`. (`ingest_bills()` alone is canonical-only.)
- **No money.** Skip AI enrichment (`--skip-ai-prepare`) — it spends OpenAI $.
- **Be polite** to public `.gov` servers: off-peak, low concurrency. (The pipeline's nominal concurrency is ~8, but effective concurrency is **1** until #253 — see pitfall 3. Don't raise above 8.)

## Environment (verify, don't assume)
- `.env` at repo root auto-loads production Supabase + OpenAI creds. **NEVER print/echo its values.**
- Production DB is the Supabase pgbouncer **transaction pooler**, port 6543 (`alethical/db/session.py` → `supabase_database_url`).
- `statement_timeout = 2min`; `idle_in_transaction_session_timeout = 0` → **dead client connections never auto-reap; they hold row locks forever until you `pg_terminate_backend` them.** This is the root of most cascades.
- Discovery is biennium-wide: one `session_code` (`0942025`) returns all ~10,471 bills (#225). Dry-run first (`--refresh-existing` discovers ~10,471; without it you get only-missing ≈ a handful).

## Normal flow (Oban queue)
`just pipeline production <ARGS>` enqueues a `pipeline-run` coordinator → `full-bill-sync` → ~419 `bill_sync` chunk jobs (25 bills each) → each chunk `ingest_bills()`. `just pipeline-work` drains the queues. Canonical-only refresh args:
`--refresh-existing --skip-rag --skip-committees --skip-votes --skip-ai-prepare --write --allow-writes` (dry-run is the default; `--write` flips it).

## Pitfalls — the hard-won cascade (each caused a real failure)
1. **Transaction pooler + psycopg prepared statements collide** → `DuplicatePreparedStatement: "_pg3_N" already exists`. **Fixed (#239/#250):** `connect_args={"prepare_threshold": None}` = `NO_PREPARED_STATEMENTS` (in `db/session.py`) on every engine/pool. **Always use it in ad-hoc scripts too.**
2. **Reference-data advisory locks were held for the whole chunk** → `statement timeout` on `select pg_advisory_xact_lock(...)` at concurrency >1. **Fixed (#249):** double-checked locking — take the lock only on the insert path. On a refresh (all reference rows already exist) chunks run lock-free.
3. **`ingest_bills` calls `refresh_legislator_stats` per chunk**, rewriting all ~201 `legislator_stats` rows every batch → concurrent chunks block each other on those rows (`UPDATE legislator_stats` waits → 2-min timeout). **OPEN: [#253].** **Consequence: concurrency >1 does NOT speed the drain up until #253; plan for conc-1 (~6–7h).**
4. **The Oban drain is fragile.** Any single chunk error crashes the whole drain process (`drain_queue(with_safety=False)`), and on death it (a) **orphans its subprocess** if you launched it via a supervisor that used `subprocess.run` — `TaskStop`/kill of the supervisor does **not** kill the child drain; and (b) leaves **idle-in-transaction DB connections holding row locks** (never auto-reaped) that block the next drain. This is how one crash snowballs.
5. **Multi-session collisions.** This repo runs many parallel sessions/worktrees; others may launch their own bill drains against the same production DB (duplicate chunk batches; orphaned drains). **Verify ownership before touching anything:** different command options or **PPID=1** do not establish abandonment. Identify the owning task and exact worker before recovery; coordinate with active owners and touch only verified task-owned resources.
6. **The refresh double-marks `is_current` and mints redundant `version_code='0'` versions.** `ingest_bills` inserts a *new* `bill_version` for each re-fetched bill **without clearing `is_current` on the prior one**, and when it can't parse a real version code it defaults to `'0'` — so the `(bill_id, version_code)` unique constraint lets `'0'` coexist with the original `'current'`/`'1'`/… . A full biennium refresh thus leaves **~1 duplicate `is_current` version per bill, identical text** (measured Jul 15 2026: 6,942 bills, 9,694 `'0'` rows). Consequences: (a) `rag.STALE_RAG_BILL_KEYS_SQL` selects the current version via `distinct on (bill_id) … order by sequence_number desc`, a **non-deterministic tie** when two `is_current` rows share a sequence → the RAG "stale" count is unstable and inflated; (b) grounded-Ask retrieval (`semantic_rag_chunk_stmt`) filters by **`bill_id` only, not `is_current`/version** → if both versions get embedded, answers mix versions. **Do NOT "fix" a post-refresh RAG stale count by blindly re-embedding** — you'd build RAG onto the junk duplicates and *create* the mixing bug. First check for dups (`select count(*) from (select bill_id from bill_version where is_current group by bill_id having count(*)>1) x`); if present, dedup `is_current` first — demote no-RAG duplicates that have a real-RAG sibling (reversible; snapshot the demoted IDs), then re-embed only genuine gaps (usually zero). **FIXED ([#287], Jul 15 2026):** `ingest_bills` now clears prior `is_current` before re-marking the latest, and a partial unique index `(bill_id) WHERE is_current` enforces one current per bill (applied to prod manually while migrate.yml is down — [#288]); retrieval is version-scoped too. The dup-check above stays useful as a defensive guard. (`version_code` still defaults to `'0'`, but an existing `'0'` row is now reused, not re-duplicated.) **The `is_current` `version_code='current'` rows are LOAD-BEARING for RAG — do NOT delete them.** **~6,466** bills attached their real sections/RAG to a `current` row that is itself `is_current`, and it holds the ONLY embeddings for those bills (retrieval reads them via `semantic_rag_chunk_stmt(current_version_only=True)`). Deleting one strands that bill with an un-embedded `is_current` → grounded Ask returns nothing. They become deletable only if a future re-ingest moves `is_current` onto a raw-code version AND a re-anchor/re-embed follows (the auto-heal is tracked in [#548]). **RESOLVED for the NON-current stale rows (Jul 22 2026, [#531]/[#542]):** the ~463 `is_current=false` `current` duplicates + the 2 #467 bare-code twins were deleted by `scripts/clean_stale_bill_versions.py` ([#544]) — safe because [#542] ([#546]) first re-anchored the RAG index onto each bill's `is_current` version (`scripts/reanchor_rag_to_current_version.py`, zero-cost re-point; dead-retrieval 11 → 0, `STALE_RAG_BILL_KEYS_SQL` → 0). Gate 1 of the cleanup tool aborts on any `is_current` candidate, so the 6,466 above are never touched; **15 non-current `current` rows carrying stale `ai_enrichment` were held back → [#547]**. The source-side leak ("stop re-creating `current`") is fixed in `upsert_versions_and_sections` ([#539]). `bill_stats.version_count` is recomputed from the fetched XML and already **excludes** the `current` row (no overcount). [#474] display symptom fixed by [#529].

7. **A pooler stall is a HANG, not an error — per-item retry cannot fire on it.** The #228 re-embed pass stopped at 800/832 at **0% CPU**: the worker was blocked on a socket, not erroring, so its 4× backoff retry never triggered. An unattended driver `wait`-ing on that subprocess has no upper time bound, so one stalled pass silently kills a whole overnight run — "no output" and "still working" look identical. **Two fixes, both proven that session, and use both:** (a) turn hangs into retryable errors with `connect_args={"options": "-c statement_timeout=…"}` plus TCP keepalives (`keepalives=1, keepalives_idle=30, keepalives_interval=10, keepalives_count=5`); (b) wrap each pass in a **liveness watchdog** — run it in the background, kill it if its log file stops growing for N minutes, then re-run (per-item commits make it resumable). Never `wait` unbounded on a subprocess overnight. The same principle applies to your own wake mechanism: a bounded, self-re-arming watch beats one long-lived `until … sleep` loop, which the runtime can kill and leave you with no wake signal at all.

## Historical direct-ingest recovery example

Do not execute this example unchanged. Its broad `pipeline-run:%` selection does not prove
ownership. Any current recovery must select the exact approved run and job IDs, exclude active
workers and leases, and verify current code, transaction behavior and restoration steps first.
The example is retained to explain batch isolation and progress recording.

The July recovery bypassed the then-fragile queue drain. Read the remaining `available` chunks straight from `oban_jobs`, ingest each batch with `try/except` (one bad bill logs + skips instead of crashing the run), commit per batch, conc-1, mark each chunk `completed`. It's the tracked process itself (no orphan), and per-batch commits release locks (no leaks). Re-run it to mop up any batches that failed (they stay `available`). The recorded implementation follows; it is not a current launch command:

```python
"""Historical example only: broad selection must not be run unchanged.
Current recovery needs verified exact run/job IDs and worker/lease exclusion.
"""
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session
from alethical.db.session import NO_PREPARED_STATEMENTS, database_url_for_target
from alethical.pipeline.minnesota import BillTarget, MinnesotaIngestionPipeline

engine = create_engine(database_url_for_target("production", None),
                       pool_pre_ping=True, connect_args=NO_PREPARED_STATEMENTS)
with Session(engine) as db:
    rows = db.execute(text(
        "select id, args->'targets' as targets from oban_jobs "
        "where queue='bill_sync' and state='available' "
        "and args->>'task_key' like 'pipeline-run:%' order by id")).all()
chunks = [(r[0], r[1]) for r in rows]
print(f"remaining batches: {len(chunks)}", flush=True)
ok = failed = bills = 0
for i, (job_id, targets) in enumerate(chunks, 1):
    tlist = [BillTarget(chamber=str(t["chamber"]), bill_number=str(t["bill_number"]),
                        session_code=str(t.get("session_code") or "0942025"))
             for t in (targets or [])]
    try:
        with Session(engine) as db:
            MinnesotaIngestionPipeline(db).ingest_bills(tlist); db.commit()
            db.execute(text("update oban_jobs set state='completed', completed_at=now() where id=:id"),
                       {"id": job_id}); db.commit()
        ok += 1; bills += len(tlist)
    except Exception as ex:
        failed += 1
        print(f"[batch {i}/{len(chunks)} job={job_id}] FAILED: {type(ex).__name__}: {str(ex)[:160]}", flush=True)
    if i % 10 == 0 or i == len(chunks):
        print(f"[{i}/{len(chunks)}] ok={ok} failed={failed} bills≈{bills}", flush=True)
print(f"DONE: ok={ok} failed={failed} bills≈{bills}", flush=True)
```

## Cleanup procedure (before starting, and after any crash)
The SQL below records the old recovery approach, not commands to run unchanged. Before recovery, prove ownership of exact processes, database sessions and job IDs, exclude live workers and leases, and prepare scoped statements for those IDs. A query-name or queue filter alone does not establish ownership. Keep derived-index work separate:
1. **Identify stalled drains:** inspect process and task records. Stop only a verified task-owned worker through its supported graceful route. Parent ID, age and silence do not prove ownership or abandonment; leave unrelated workers intact.
2. **Sweep leaked lock-holders:**
   `select pg_terminate_backend(a.pid) from pg_stat_activity a where a.state='idle in transaction' and a.query !~* 'rag_' and exists(select 1 from pg_locks l where l.pid=a.pid and l.mode like '%ExclusiveLock%' and l.relation::regclass::text ~* 'legislator|bill|sponsorship|district|ingestion');`
3. **Reset stranded chunks:** `update oban_jobs set state='available', attempted_at=null where queue='bill_sync' and state='executing';` — **do NOT reset `attempt`**: Oban's claim increments it and the `attempt_range` CHECK constraint rejects attempt>max_attempts (this bit me). The direct-ingest script sidesteps `attempt` entirely, so prefer it over re-draining.
4. **Never kill a drain mid-run yourself** — killing a live drain leaks its lock-holding connections (step 2 territory). Let it finish, or accept you'll sweep after.

## Verification when the refresh completes
- **HF 4138** reads enacted: `select current_status from bill where file_type='HF' and file_number=4138;` → `Chapter number`.
- Sampled bills across both chambers have current actions — verify by **`bill_action` row count + `created_at`**, and by a fresh `bill.current_status`. **`action_at` / `latest_action_at` / `introduced_at` are now populated** (fixed [#328]/PR #338, Jul 16 2026): the Revisor XML *does* carry `ACTION_DATE` as `"YYYY-MM-DD HH:MM:SS"`, and `parse_datetime` was silently dropping that format, so pre-fix production was 100% null on every date column. Post-fix, an ingest/backfill sets `bill_action.action_at` (undated procedural actions like "Laid on table" stay null — expected), `bill.latest_action_at` (newest *dated* action), and `bill.introduced_at` ("Introduction and first reading"). So `max(action_at)` should be a real date — **null dates are now a gap, not the norm.** (The full-corpus one-time backfill ran Jul 15–16 2026 via a surgical re-fetch of the free status XML + column-only UPDATE, so existing rows carry dates even before the next full re-ingest.) **Other date columns are still gapped** — a post-#328 audit ([#343]) found `legislator_service_period` / `committee_membership` / `district` / `legislative_session` start/end dates 0%-populated (never written) and 78 `vote_event.occurred_at` null (Senate PDF journals the House-HTML parser can't read); a canonical refresh does **not** fill those. When verifying a refresh, don't read those nulls as refresh failures — they're tracked separately in [#343].
- Coverage: `select count(*) from bill b where not exists(select 1 from bill_action a where a.bill_id=b.id);` should be ~0-1. (One known spurious record, HF9901, has 0 actions + null status and is outside the biennium set — not a refresh miss.)
- **Report failures:** the ingest log's `FAILED` lines + any remaining `oban_jobs` in `state='available'`/`'discarded'` for the `pipeline-run:%` batch.

### Two data-quality conditions to EXPECT at verification (neither is a refresh failure)
The refresh's own goal (fresh actions/status) is met even though these two checks look wrong:
- **Roster raw count looks ~2× but mostly isn't a bug — PRE-EXISTING, not refresh-caused ([#286]).** A naive `count(distinct legislator_id) where is_current` returns ~270 House / 136 Senate, but ~134/66 of those are **intentional placeholder entities** (district code ends `-unknown`, paired to the canonical entity by `external_key`, resolved by `canonical_legislator_for_placeholder` in `api/routers/public.py`) — leave them alone. Filtering placeholders (`district.code not like '%-unknown'`) gives **136 House / 70 Senate**; the only real anomaly is that residual vs the true 134/67 = **5 districts** where a departed predecessor's period is still `is_current` next to the successor. The refresh touches **0** service-period rows, so don't read a failed 134/67 check as refresh damage. To verify the roster cleanly, count real-district current legislators (exclude `-unknown`), don't count raw `is_current`.
- **Duplicate `is_current` bill_version rows — REFRESH-CAUSED ([#285], mechanism in pitfall 6 above).** A full refresh mints a redundant `is_current=true` version per bill (the `version_code='0'` trap), so immediately post-refresh expect ~6,900+ bills with >1 current version. Canonical status/actions stay correct. **RESOLVED ([#287], Jul 15 2026):** the #228/#285 lineage (session **"Ask 26 ingestion v2"**) ran the data dedup (6,942 → 0) **and** landed the ingest-side fix — `ingest_bills` clears prior `is_current`, plus a partial unique index `(bill_id) WHERE is_current` (applied to prod) — so a full refresh no longer re-duplicates. If you still see post-refresh dups, the fix regressed: record the count on [#285] and coordinate. Regardless, never run a mass `bill_version` UPDATE while a RAG re-embed is live on the table.

## Progress / status query
`select state, count(*) from oban_jobs where queue='bill_sync' and args->>'task_key' like 'pipeline-run:%' group by 1;` (the historical run had 419 chunks; completed plus discarded measured queue consumption, not success. Discarded work remains a failure to account for).

## Related
Spec/onboarding: `docs/product-onboarding/data-ingestion-onboarding.md` (Orchestration). Grounded-answer currency invariant (why staleness matters): `.claude/rules/grounded-answers.md` rule 7 ([#155]). Parallelization follow-up: [#253].
