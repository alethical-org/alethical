<!-- describes: scripts/check_schema_drift.py, alethical/alembic/versions/0001_initial_schema.py, alethical/alembic/versions/0017_align_models_with_production.py -->

# Production database schema drift — audit and standing check

**Net:** The schema our code declared and the schema production actually ran were not
the same, and nothing had ever checked. Measured against production on **Jul 30 2026**
they differed in **39 places**, collapsing to **11 distinct findings**. Two of those are
active bugs, and **six of the 11 are cases where production is right and the code is
wrong** — so rebuilding the database from `models.py` would have made things worse, not
better. Re-measured **Aug 3 2026**: one finding has been fixed, no new finding has
appeared, and every number below reproduced exactly.

The cause is now removed and a check now watches for its return. What is left to decide
is four findings, each with its own issue, listed under "Still open" below.

## Why the drift existed at all

`alethical/alembic/versions/0001_initial_schema.py` used to build the whole schema with
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

There is a fourth consequence, measured separately and recorded on
[#100](https://github.com/alethical-org/alethical/issues/100): under a `create_all`
baseline, **a migration's `upgrade()` never ran in CI at all.** A fresh database jumped
straight to the current model, so every intermediate migration found its work already
done and CI proved only that the skipped calls did not crash.

## How this is measured

`scripts/check_schema_drift.py` dumps every table, column, type, nullability, default,
constraint, index, foreign key, enum and extension from `pg_catalog` on two databases
and diffs them. It has two modes, and they answer different questions.

**What CI runs, on every backend pull request:**

```bash
uv run python scripts/check_schema_drift.py
```

Builds two throwaway databases on the same server — one by `alembic upgrade head`, one
by `Base.metadata.create_all()` — and fails when they disagree. A model edit with no
migration is exactly that disagreement. **This check could not have existed before
[#100](https://github.com/alethical-org/alethical/issues/100):** while `0001` called
`create_all`, both sides read `models.py` and agreed by construction. Verified by
mutation rather than assumed — the same invented column on `models.py` reports no drift
against the old baseline and one difference against the new one.

**What a person runs, to re-measure production:**

```bash
uv run python scripts/check_schema_drift.py --against-production
```

Read-only against production, and never run by CI, which has no production credentials
and must not get any. It exits 0 whatever it finds: which side is right is a judgement
call, and six of the eleven below went production's way.

Names are compared separately from definitions, because a constraint can be correct and
still be *named* differently on the two sides — which is its own latent break, and one
of the findings below.

### What the comparison ignores, and why

Four groups, each a decision rather than a blind spot, each listed by name in the script
so a new exception has to be added deliberately:

- **Oban's tables** (`oban_jobs`, `oban_leaders`, `oban_producers`, `oban_job_state`).
  The job queue installs these through its own `install` command, outside Alembic on
  purpose — `docs/product-onboarding/data-ingestion-onboarding.md` § "Orchestration —
  Oban job queue + CLI". Finding D5.
- **Extensions we do not own.** Compared by allowlist (`vector`, `pg_trgm`) rather than
  by difference, because Supabase installs `pgcrypto`, `uuid-ossp`, `pg_stat_statements`
  and `supabase_vault` as platform furniture. Finding D9.
- **Indexes a migration creates that no model declares** — eight of them. The composite
  indexes `0001` adds by hand, the vector index that `0012` swaps from ivfflat to HNSW,
  and the three trigram search indexes from `0011`. The trigram three are the only group
  that *could* move onto the models; leaving them is a deliberate choice to keep the
  `0001` rewrite a transcription.
- **Row-level security**, reported and never failed. Finding D10.

## The findings

Sorted worst first. "Correct side" is the judgement call: which of the two should change
to match the other. Every count was re-measured against production on **Aug 3 2026** and
matched Jul 30 exactly.

| # | Divergence | Correct side | Why | Status |
| --- | --- | --- | --- | --- |
| D1 | `bill_version_section`: production keyed rows on `UNIQUE(bill_version_id, source_order)` and kept a plain index on `(bill_version_id, section_id_text)`. `models.py` declared `UNIQUE(bill_version_id, section_id_text)`. | **Production** | A bill page can hand two sections the same id (`laws.0.1.0` for anything outside an article), so the id cannot identify a row; the section's position can never repeat. 64 versions in production hold repeated section ids. | **Fixed.** [#763](https://github.com/alethical-org/alethical/issues/763) via [PR #778](https://github.com/alethical-org/alethical/pull/778), migration `0016`. Gone from the Aug 3 re-run. |
| D2 | `notification_event`: production runs a 12-column delivery queue (`channel`, `source_hash`, `subject`, `body`, `payload_json`, `status`, `scheduled_for`, `failure_reason`, six of them `NOT NULL` with no default) plus `UNIQUE(user_id, bill_id, event_type, source_hash)` and a `notification_event_status` enum. `models.py` declares a 7-column status-change log. **19 of the 39 raw differences are this one table.** | **`models.py`** | The rich table is a fossil of an abandoned email-delivery design (commit `a1066aa`, since simplified). `0002`'s skip-if-exists guard is the only reason production still has it. The table holds **0 rows** (re-confirmed Aug 3 2026), so replacing it loses nothing. | **Closed** — [#929](https://github.com/alethical-org/alethical/issues/929), migration `0020_notification_event_shape.py`, merged in [#938](https://github.com/alethical-org/alethical/pull/938) about 80 minutes after this row was last edited. It got its own migration and its own review, as this row asked. |
| D3 | `evidence_document`: a table with **34,033 rows**, a primary key, two foreign keys, a check constraint and a unique key, that exists only in production. Nothing in the repo declares it. | **Neither — it is an orphan** | Created by `0003_representative_evidence`, applied to production by hand from the unmerged branch `origin/codex/representative-lookup-followups` while auto-migration was down ([#288](https://github.com/alethical-org/alethical/issues/288)). Production's migration bookmark was later reset past it, so the table survived and its migration did not. | Open — [#855](https://github.com/alethical-org/alethical/issues/855). Needs a product call (adopt the feature, or drop 34,033 rows), not a decision an audit makes. |
| D4 | `chat_session.subject_legislator_id`: a `uuid` column with a foreign key to `legislator`, present only in production. **6 of 37 chat sessions have a value in it.** | Same as D3 | Same origin, same migration. | With D3, [#855](https://github.com/alethical-org/alethical/issues/855). |
| D5 | `oban_jobs`, `oban_leaders`, `oban_producers` and the `oban_job_state` enum exist only in production. | **Production** | Correct as they are — the `oban` package creates them through its own installer, deliberately outside Alembic. | **Closed.** The drift check ignores them by name, so a true state cannot fail it forever. |
| D6 | `ai_enrichment` has a partial unique index in production, `ix_ai_enrichment_bill_summary_current_unique` on `(bill_id, enrichment_type)` where the row is a current bill summary. `models.py` declared **no constraint of any kind** on that table. | **Production** | It is the only thing enforcing "one current summary per bill," and it holds — **0 violations**, re-measured Aug 3 2026. Rebuild the database from `models.py` and that protection silently disappeared. | **Fixed.** Declared in `models.py`; migration `0017` creates it on any database that lacks it. |
| D7 | `legislator_election_history`'s unique key is named `uq_legislator_election_history_leg_seq` in production and `uq_legislator_election_history_legislator_id_period_sequence` on a fresh database. Same two columns either way. | **Production** | `0008` named it by hand; the naming convention generates the long form, and `create_all` used the long form on fresh databases. The cost is latent and lands the day a migration writes `op.drop_constraint()` with one name and meets the database holding the other. | **Fixed.** Name pinned in `models.py`; `0017` renames where the long form is present. |
| D8 | `legislator_election_history.is_current_chamber` has server default `false` in production and no default on a fresh database. | **Production**, marginally | 224 rows, 0 nulls (re-confirmed Aug 3 2026); the default is harmless and matching it is cheaper than removing it. | **Fixed.** Declared in `models.py`; `0017` sets it. |
| D9 | Production has `pgcrypto`, `uuid-ossp`, `pg_stat_statements` and `supabase_vault`; a fresh database has none of them. | **Production** | Supabase installs these as platform extensions. Not ours to create, not ours to drop. | **Closed.** The check compares only the extensions we own. |
| D10 | Row-level security is on for every production table with **zero policies**, and off on a fresh database. | **Production** | RLS on with no policies denies every role except the table owner. The app connects as the owner and bypasses it, so this is Supabase's secure default rather than a broken permission — but a query that works locally can be refused in production the moment we connect as a non-owner role. | **Closed.** Reported by the production mode, never failed, so nobody "fixes" it into Alembic. |
| D11 | The `notification_event_status` enum exists only in production. | With D2 | It belongs to production's fossil table. | With D2, [#929](https://github.com/alethical-org/alethical/issues/929). |

## Code that relies on something the database does not guarantee

Each of these is the same shape as the lost bill sections: application code assuming a
uniqueness the database never promised. All counts re-measured Aug 3 2026; R1 re-measured
against production Aug 4 2026 and unchanged.

**Every one of these six is now closed, and three of the six had the wrong severity when
written.** R2 was recorded as damage and was not; R6 was recorded as an uncounted aside
and was a live 64-row reader-visible bug; R1 was recorded as "already wrong" and was
latent. The *measurements* were sound each time — the row counts, the constraint
definitions, the null semantics all held up. What went wrong was the label attached to
them. Worth carrying into the next audit: a count is evidence, "already wrong" is a
conclusion, and the two need checking separately.

| # | Where | What it assumes | What the database actually has | Measured in production |
| --- | --- | --- | --- | --- |
| R1 | `alethical/pipeline/ai_enrichment.py` — get-or-create | `(bill_id, bill_version_id, enrichment_type, model_name, source_version_hash)` is unique | **No constraint on any of it**, in production or in `models.py`. D6's index covers two of the five columns and only current bill summaries, so it did not close this. | **Fixed — and this row's severity was wrong.** The 2,219 duplicate groups were real, but **"Already wrong" overstates it**: **0** of them contained a current row, so nothing a reader saw was ambiguous. The damage was **latent**, and it would have fired on the next re-enrichment — the lookup has no ordering, so it returned an arbitrary row and marked it current, and 2,217 groups held two *different* summaries. Deduped on production and the five-column key added, spelt `NULLS NOT DISTINCT` because 9,161 rows have a null `bill_version_id` ([#927](https://github.com/alethical-org/alethical/issues/927), `0019`). |
| R2 | `alethical/pipeline/minnesota.py` — `_LEGISLATOR_FK_REPOINTS` | deduping a repointed sponsorship on `(bill_id, role)` is enough | The declared key is `(bill_id, legislator_id, committee_id, role)`, and Postgres treats a NULL `committee_id` as distinct from another NULL, so the constraint blocks nothing for legislator-owned rows | **Fixed — and this row was wrong when written.** The "1 duplicate group" is **not a duplicate**: the official record lists Hemmingsen-Jaeger as SF 1943's House author 14 *and* its Senate author 5. Two genuine rows the key could not express, and the merge was deleting one of them. Cross-chamber authorship is structural — 258 bills carry both chambers' lists. `source_chamber` now joins the key ([#928](https://github.com/alethical-org/alethical/issues/928), `0018`). |
| R3 | `alethical/pipeline/minnesota.py` and `scripts/load_sample_data.py` — `upsert_service_period` | one row per `(legislator_id, session_id)` with `is_current` true | The declared key is `(legislator_id, session_id, period_sequence)`; `is_current` is in no unique key, and the index naming all three columns is **not unique** | 0 violations. Latent, and the non-unique index reads like protection. [#928](https://github.com/alethical-org/alethical/issues/928). |
| R4 | `alethical/pipeline/minnesota.py` and `alethical/pipeline/committee_memberships.py` | `(committee_id, legislator_id, role)` blocks a duplicate when `role` is NULL | It does not — NULL is never equal to NULL in a unique key. Only these two call paths' select-then-insert prevent it | 0 violations. Latent. [#928](https://github.com/alethical-org/alethical/issues/928). |
| R5 | `alethical/api/services/notifications.py` — `record_bill_status_change` | `notification_event` has `old_status_code`, `new_status_code`, `old_status`, `new_status` | Production's table has none of those four and requires six other columns to be non-null. The insert would fail outright | Not reachable: the function's only caller is its own test. A landmine for whoever wires up [#36](https://github.com/alethical-org/alethical/issues/36), not a live break. With D2. |
| R6 | `alethical/pipeline/minnesota.py` — `link_companion` | a bill key built by hand matches `build_bill_key()`'s output | `build_bill_key()` appends an `s<n>` suffix for special sessions; the hand-built key never did, so a special-session bill resolved its companion to the **regular** session's file of that number — a real, unrelated bill — and then linked both directions | **Fixed — and far worse than this row said.** Recorded as "not counted, unrelated to schema drift"; it was a live, reader-visible bug. **64 bill rows** carried a wrong companion, both sides labelled identically ("SF 8"), so neither page read as wrong. Repaired: 32 repointed, 26 recovered from the surviving reverse link, 6 left blank ([#928](https://github.com/alethical-org/alethical/issues/928)). |

Two things checked and **clean**, worth recording so nobody re-checks them:

- **Every `ON CONFLICT` in the codebase names a constraint production actually has.**
  All four are RAG upserts. Their targets resolve to
  `uq_rag_section_document_bill_version_id_bill_version_se_83a9`, the `rag_chunk`
  three-column key, and `rag_chunk_embedding.rag_chunk_id` — and the diff found zero
  constraint differences on those three tables. No raw-SQL `ON CONFLICT` exists
  anywhere, and no `Session.merge()` call does either.
- **The two orphan objects are handled safely already.** `_merge_legislator` repoints
  `evidence_document` and `chat_session.subject_legislator_id` only after a runtime
  check that the column exists (`_column_exists`), so it is a no-op on the repo's schema
  and correct against production. That is the right pattern, not a bug.

## What changed, and what deliberately did not

Landed with this document:

- `0001_initial_schema.py` writes explicit DDL instead of calling `create_all`, so the
  migration history can finally describe and version the schema. It is a transcription:
  at `0016_section_keyed_on_pos`, production's own stamp, the rewrite and the old
  baseline build identical schemas — 33 tables, 360 columns, 124 constraints, 21
  indexes, zero differences.
- D6, D7 and D8 are declared in `models.py` and carried to existing databases by
  `0017_align_models_with_production`, whose every statement is conditional and
  therefore a no-op against production.
- `scripts/check_schema_drift.py` runs in CI on every backend pull request and fails
  when `models.py` and the migration history stop agreeing — the recurrence guard, per
  `docs/philosophy.md` principle 9 ("Prevent, don't just fix").

**One sentence in the Jul 30 draft of this document was not true when it was written.**
It said findings were kept from recurring by `scripts/check_schema_drift.py`, "run by CI
on every backend PR". That file existed on no branch and no workflow referenced it. It
is true now, which is the only reason the claim survives — a document that describes a
guard nobody built is worse than one that admits the gap.

### Still open

Two items, each with an owner:

- **D2 + D11 + R5** — **closed.** Production's fossil `notification_event` was replaced
  by migration `0020_notification_event_shape.py`
  ([#929](https://github.com/alethical-org/alethical/issues/929), merged in
  [#938](https://github.com/alethical-org/alethical/pull/938)), which drops the fossil
  table and the `notification_event_status` enum. R5's landmine goes with it: the
  writer in `alethical/api/services/notifications.py` and the 7-column model in
  `models.py` now agree with the live table.
- **D3 + D4** — 34,033 orphan rows and a populated orphan column, needing a product
  decision: [#855](https://github.com/alethical-org/alethical/issues/855).
- **R1** — **closed** by [#927](https://github.com/alethical-org/alethical/issues/927).
  The 2,219 surplus rows were deleted from production (dry run predicted 2,219, the live
  run deleted 2,219, current summaries unchanged at 10,517), and migration `0019` adds
  the five-column key. Its "already wrong" label was too strong: latent, not live.
- **R2, R3, R4, R6** — **closed** by
  [#928](https://github.com/alethical-org/alethical/issues/928). Two of the four rows
  above were wrong when written: R2 was not damage at all, and R6 was a live 64-row
  bug rather than an uncounted aside. Both corrected in the table.

## Reading this later

The one-line version: **a `create_all` baseline cannot describe a schema, so for months
nothing did.** The check is the part that matters going forward — if it is green, this
document is history. If someone disables it, this document is a forecast.
