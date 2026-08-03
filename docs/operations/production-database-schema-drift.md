# Production database schema drift — audit, Jul 30 2026

Status: point-in-time audit. Findings are dated; the standing enforcement that keeps
them from recurring is `scripts/check_schema_drift.py`, run by CI on every backend PR.

**Net:** The schema our code declares and the schema production actually runs are not
the same, and nothing had ever checked. Measured against production on Jul 30 2026,
they differ in **39 places**, which collapse to **11 distinct findings**. Two of those
findings are actively costing us: a bill-text key that drops sections at ingest, and an
AI-enrichment lookup that sits on 2,219 duplicate rows because no constraint stops
them. Six of the 11 are cases where **production is right and the code is wrong** — so
rebuilding the database from `models.py` would have made things worse, not better.

## Why the drift exists at all

`alethical/alembic/versions/0001_initial_schema.py` builds the whole schema with
`Base.metadata.create_all()` — a snapshot of whatever `models.py` said on the day it
ran, not a diff. Three consequences follow, and every finding below is one of them:

1. **Production froze an old shape.** Production was created from `models.py` as it was
   months ago. Later edits to a `__table_args__` never reached it, because nobody wrote
   a migration — `create_all` had already "handled" the table, so a fresh database and
   production quietly diverged with no error anywhere.
2. **Later migrations learned to skip themselves.** `0002_notification_event` returns
   early if the table already exists, because on a fresh database `create_all` has
   already made it. That guard is why production still runs a table design the product
   abandoned.
3. **Out-of-band changes left orphans.** Because auto-migration was broken for a period
   ([#288](https://github.com/alethical-org/alethical/issues/288)), schema changes were
   applied to production by hand from an unmerged branch, then the migration bookmark
   was reset. The objects those changes created are still there, with real data in
   them, described by nothing in the repo.

## How this was measured

Reproducible, read-only against production:

```bash
uv run python scripts/check_schema_drift.py --against-production
```

The method: dump every table, column, type, nullability, default, constraint, index,
foreign key, enum and extension from `pg_catalog` on both sides, then diff. "Both
sides" means production versus a throwaway local database built by
`alembic upgrade head`, which is exactly what a fresh developer machine or a CI run
gets. Names are compared separately from definitions, because a constraint can be
correct and still be *named* differently on the two sides — which is its own latent
break, and one of the findings below.

Raw counts: 33 differences inside tables both sides have, 4 tables that exist only in
production, and 2 whole-database differences the per-table pass cannot see (installed
extensions, row-level security).

At the time of the audit both sides were stamped at the same migration
(`0015_section_body_blocks`), so none of this is "production is behind." Production has
run every migration in the repo and still does not match it.

## The findings

Sorted worst first. "Correct side" is the judgement call: which of the two should
change to match the other.

| # | Divergence | Correct side | Why | Owner |
| --- | --- | --- | --- | --- |
| D1 | `bill_version_section`: production keys rows on `UNIQUE(bill_version_id, source_order)` and keeps a plain index on `(bill_version_id, section_id_text)`. `models.py` declared `UNIQUE(bill_version_id, section_id_text)`. | **Production** | A bill page can hand two sections the same id (`laws.0.1.0` for anything outside an article), so the id cannot identify a row; the section's position can never repeat. 64 versions in production hold repeated section ids. | [#763](https://github.com/alethical-org/alethical/issues/763) — fixed by [PR #778](https://github.com/alethical-org/alethical/pull/778), migration `0016`. Not this issue's to touch. |
| D2 | `notification_event`: production runs a 12-column delivery queue (`channel`, `source_hash`, `subject`, `body`, `payload_json`, `status`, `scheduled_for`, `failure_reason`, six of them `NOT NULL` with no default) plus `UNIQUE(user_id, bill_id, event_type, source_hash)` and a `notification_event_status` enum. `models.py` declares a 7-column status-change log (`old_status_code`, `new_status_code`, `old_status`, `new_status`). **19 of the 39 raw differences are this one table.** | **`models.py`** | The rich table is a fossil of an abandoned email-delivery design (added in commit `a1066aa`, since simplified). `0002`'s skip-if-exists guard is the only reason production still has it. The table holds **0 rows**, so replacing it loses nothing. | New issue. Not folded into #100 — it changes a live table's shape, so it gets its own migration and its own review. |
| D3 | `evidence_document`: a table with **34,033 rows**, a primary key, two foreign keys, a check constraint and a unique key, that exists only in production. Nothing in `models.py` or anywhere else in the repo declares it. | **Neither — it is an orphan** | Created by `0003_representative_evidence`, applied to production by hand from the unmerged branch `origin/codex/representative-lookup-followups` while auto-migration was down ([#288](https://github.com/alethical-org/alethical/issues/288)). Production's migration bookmark was later reset past it, so the table survived and its migration did not. | New issue. Needs a product call (adopt the feature, or drop 34,033 rows) — not a decision an audit makes. |
| D4 | `chat_session.subject_legislator_id`: a `uuid` column with a foreign key to `legislator`, present only in production. **6 of 37 chat sessions have a value in it.** | Same as D3 | Same origin, same migration. | With D3. |
| D5 | `oban_jobs`, `oban_leaders`, `oban_producers` and the `oban_job_state` enum exist only in production. | **Production** | These are correct. The `oban` job-queue package creates them through its own `install` command, deliberately outside Alembic — see `docs/product-onboarding/data-ingestion-onboarding.md` § "Orchestration — Oban job queue + CLI". | No action. The drift check must ignore them, or it fails forever on a true state. |
| D6 | `ai_enrichment` has a partial unique index in production, `ix_ai_enrichment_bill_summary_current_unique` on `(bill_id, enrichment_type) WHERE enrichment_type = 'bill_summary' AND is_current`. `models.py` declares **no constraint of any kind** on that table. | **Production** | It is the only thing enforcing "one current summary per bill," and it holds — 0 violations measured. Rebuild the database from `models.py` and that protection silently disappears. | This issue. Declared in `models.py` and re-created by an additive migration. |
| D7 | `legislator_election_history`'s unique key is named `uq_legislator_election_history_leg_seq` in production and `uq_legislator_election_history_legislator_id_period_sequence` on a fresh database. Same two columns either way. | **Production** | Migration `0008` named it by hand; `models.py`'s naming convention generates the long form, and `create_all` used the long form on fresh databases. | This issue. The name is pinned in `models.py` so a future `op.drop_constraint(...)` does not fail against production, which is the real cost of a name-only difference. |
| D8 | `legislator_election_history.is_current_chamber` has server default `false` in production and no default on a fresh database. | **Production**, marginally | 224 rows, 0 nulls; the default is harmless and matching it is cheaper than removing it. | This issue. Declared to match. |
| D9 | Production has `pgcrypto`, `uuid-ossp`, `pg_stat_statements` and `supabase_vault` installed; a fresh database has none of them. | **Production** | Supabase installs these as platform extensions. They are not ours to create and not ours to drop. | No action. The rewritten `0001` creates only `vector` and `pg_trgm`, which *are* ours. |
| D10 | Row-level security is switched on for all 38 production tables, with **zero policies**, and off for all 34 tables on a fresh database. | **Production** | RLS on with no policies denies every role except the table owner. The app connects as the owner and bypasses it, so this is Supabase's secure default rather than a broken permission — but it means a query that works locally can be refused in production the moment we connect as a non-owner role. | No action, documented so nobody "fixes" it into Alembic. |
| D11 | The `notification_event_status` enum exists only in production. | With D2 | It belongs to production's fossil table. | With D2. |

## Code that relies on something the database does not guarantee

Each of these is the same shape as the lost bill sections: application code assuming a
uniqueness the database never promised. Two are already wrong on live data.

| # | Where | What it assumes | What the database actually has | Measured in production |
| --- | --- | --- | --- | --- |
| R1 | `alethical/pipeline/ai_enrichment.py:1099` — get-or-create | `(bill_id, bill_version_id, enrichment_type, model_name, source_version_hash)` is unique | **No constraint on any of it**, in production or in `models.py` | **2,219 duplicate groups.** The lookup is a plain `db.scalar(select(...))`, so it returns an arbitrary one of several matching rows. Already wrong. |
| R2 | `alethical/pipeline/minnesota.py:1246` — `_LEGISLATOR_FK_REPOINTS` | deduping a repointed sponsorship on `(bill_id, role)` is enough | The declared key is `(bill_id, legislator_id, committee_id, role)`, and Postgres treats a NULL `committee_id` as distinct from another NULL, so the constraint blocks nothing for legislator-owned rows | **1 duplicate group** on `(bill_id, legislator_id, role)` with a null committee. Already wrong. |
| R3 | `alethical/pipeline/minnesota.py:1386` and `scripts/load_sample_data.py:235` — `upsert_service_period` | one row per `(legislator_id, session_id)` with `is_current` true | The declared key is `(legislator_id, session_id, period_sequence)`; `is_current` is in no unique key, and the index that names all three columns (`ix_legislator_service_period_legislator_session_current`, created by `0001`) is **not unique** | 0 violations. Latent, and the non-unique index reads like protection. |
| R4 | `alethical/pipeline/minnesota.py:1444` and `alethical/pipeline/committee_memberships.py:248` | `(committee_id, legislator_id, role)` blocks a duplicate when `role` is NULL | It does not — NULL is never equal to NULL in a unique key. Only these two call paths' select-then-insert prevent it | 0 violations. Latent. |
| R5 | `alethical/api/services/notifications.py:61` — `record_bill_status_change` | `notification_event` has `old_status_code`, `new_status_code`, `old_status`, `new_status` | Production's table has none of those four, and requires six other columns to be non-null. The insert would fail outright | Not reachable: the function's only caller is its own test. A landmine for whoever wires up [#36](https://github.com/alethical-org/alethical/issues/36), not a live break. |
| R6 | `alethical/pipeline/minnesota.py:1756` — `link_companion` | a bill key built by hand matches `build_bill_key()`'s output | `build_bill_key()` (`alethical/pipeline/sessions.py:71`) appends an `s<n>` suffix for special sessions; the hand-built key never does, so a special-session companion can never match and the miss is indistinguishable from "no companion" | Not counted. Unrelated to schema drift, found on the way. |

Two things checked and **clean**, worth recording so nobody re-checks them:

- **Every `ON CONFLICT` in the codebase names a constraint production actually has.**
  All four are RAG upserts (`alethical/pipeline/rag_ingest.py:362`,
  `scripts/backfill_rag_bulk.py:181`, `:251`, `:310`). Their targets resolve to
  `uq_rag_section_document_bill_version_id_bill_version_se_83a9`, the `rag_chunk`
  three-column key, and `rag_chunk_embedding.rag_chunk_id` — and the diff found zero
  constraint differences on those three tables. No raw-SQL `ON CONFLICT` exists
  anywhere, and no `Session.merge()` call does either.
- **The two orphan objects are handled safely already.** `_merge_legislator` repoints
  `evidence_document` and `chat_session.subject_legislator_id` only after a runtime
  check that the column exists (`_column_exists`,
  `alethical/pipeline/minnesota.py:1281`), so it is a no-op on the repo's schema and
  correct against production. That is the right pattern, not a bug.

## What this audit changed, and what it deliberately did not

Landed with the audit:

- `0001_initial_schema.py` writes explicit DDL instead of calling `create_all`, so the
  migration history can finally describe and version the schema. The rewrite is proven
  equivalent: `alembic upgrade head` before and after produces byte-identical
  `pg_catalog` snapshots.
- D6, D7 and D8 are corrected in `models.py`, with an additive migration for D6's index.
- `scripts/check_schema_drift.py` runs in CI on every backend PR and fails when
  `models.py` and the migration history stop agreeing — the recurrence guard, per
  `docs/philosophy.md` principle 9 ("Prevent, don't just fix").

Deliberately left alone, each with its own issue:

- **D1** belongs to [#763](https://github.com/alethical-org/alethical/issues/763).
- **D2** (replace production's fossil `notification_event`) changes a live table.
- **D3/D4** (34,033 orphan rows and a populated orphan column) need a product decision
  before any code moves.
- **R1, R2, R3/R4, R6** are correctness bugs in application code, not schema
  description, and each wants its own failing test.

## Reading this later

The one-line version: **a `create_all` baseline cannot describe a schema, so for
months nothing did.** The drift check is the part that matters going forward — if it is
green, this document is history. If someone disables it, this document is a forecast.
