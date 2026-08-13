# What runs, when, and what it costs

<!-- describes: .github/workflows/**, scripts/**, alethical/pipeline/** -->

Net: 6 automatic jobs run today with no one touching them, and none of them spend
real money. Only 2 things anywhere in this project ever spend money, and both need
someone to type a command by hand: writing a bill's plain-language summary (about
7 cents a bill) and making a bill searchable (about a tenth of a cent a bill).

This page exists because the answer to "what runs, when, and what does it cost" was
scattered across more than 10 files. It is the one place to read instead of asking.

## 1. Runs on a clock, nobody touches it

These 6 jobs fire on a timer without anyone starting them. All 6 are free: they
either read the government's own free websites, run one database check, or copy
files we already downloaded to a second storage location we already pay a flat
rate for.

| Job | What it does | When it runs | What it costs |
|---|---|---|---|
| Bring in new votes (`.github/workflows/vote-backfill.yml`) | Reads Minnesota's official House and Senate websites for any vote that happened and adds only the ones we're missing | Every day at 9:00am UK time (about 3 to 4am in Minnesota) | Free. Reads free government websites only |
| Check bills aren't missing pieces (`.github/workflows/bill-section-gaps.yml`, running `scripts/check_bill_section_gaps.py`) | Compares what we stored for a bill against what the state actually published, and opens a warning if a piece is missing | Every day at 11:00am UK time | Free. One database check, nothing fetched from outside |
| Check every bill can be found by search (`.github/workflows/rag-coverage-gaps.yml`) | Finds a bill that's stored on the site but invisible to search, and opens a warning | Every day at 12:00 noon UK time | Free. One database check |
| Copy stored files to a second place (`.github/workflows/mirror-raw-files.yml`) | Copies every downloaded Minnesota campaign-finance file to a second storage company (Cloudflare) we already pay a flat rate for, so losing one copy doesn't lose the file forever | Every day at 1:00pm UK time | Free at our size. The storage company's first 10 GB is free, and we currently use 115 MB. A file already copied is skipped, so a normal day copies nothing new |
| Check the homepage's stated facts are still true (`.github/workflows/home-hero-card-facts.yml`) | Re-checks the 5 facts (signing date, effective date, who introduced it, the vote counts, quoted passages) the homepage states about one specific law, in case the official record was later corrected | Once a month, on the 1st, at noon UK time (also re-checked automatically on any pull request that touches the homepage code) | Free. Reads 5 public government pages, no database, no paid tool |
| Back up work nobody has saved yet, on Eugene's own computer (`scripts/back-up-uncommitted-worktree-work.sh`, installed as `com.alethical.wip-backup`) | Takes a snapshot of any unsaved changes sitting in a coding folder on Eugene's Mac, so a folder getting deleted can't destroy work no one committed yet | Every 5 minutes, only on Eugene's Mac | Free. Runs entirely on the local computer, touches nothing on the internet except an optional local backup folder |

**A second helper on Eugene's Mac isn't part of this project.** `com.eug.tool-settings-memory`
runs every 15 minutes and saves Eugene's personal Claude settings to their own separate
storage. It belongs to a different folder (`tool-settings`), not to Alethical.

## 2. Runs when code is pushed or merged

These 4 jobs fire automatically the moment someone's code change is accepted into
the project (called "merging"), or in one case on every proposed change before
it's accepted. None of them cost money to run themselves; the cost, if any, is
whatever the hosting companies (Railway and Vercel) already charge for keeping
the site running, which this page doesn't cover.

| Job | What it does | What starts it | Can someone stop it once it's running? |
|---|---|---|---|
| Run all the automatic checks (`.github/workflows/ci.yml`) | Runs the tests and code-quality checks that decide whether a proposed change is safe to accept | Every proposed change, and every change accepted into the main version | Yes, from GitHub's website. Stopping it just means the change isn't approved yet; nothing on the live site is touched |
| Update the database's structure (`.github/workflows/migrate.yml`) | **Applies structural changes to the live database** (adding a new column, a new table, and so on) the moment matching code is accepted | A change that touches the database's structure being accepted into the main version | Yes, from GitHub's website, but stopping it partway can leave the database structure half-changed, which is riskier than letting it finish. It's built to also open a warning automatically if it fails |
| Deploy the backend (`.github/workflows/railway-deploy.yml`) | Publishes the newest backend code (the part that answers requests and talks to the database) to the company that hosts it (Railway) | A change to the backend code being accepted into the main version | Yes, from GitHub's website, before it finishes. Once it finishes, the previous version is still available to restore from Railway directly |
| Deploy the website (`.github/workflows/vercel-deploy.yml`) | Publishes the newest website code to the company that hosts it (Vercel) | Only when someone runs it by hand from GitHub's website. **Normal website releases already happen automatically through Vercel's own connection to this project's code — this job is a manual backup path, kept separate so it can't accidentally publish the same release twice** | Yes, the same way as the backend one above |

## 3. Only runs when someone types a command

There are 37 separate command-line tools in this project (33 in the `scripts`
folder, plus 4 that live in `alethical/pipeline` and are commonly run directly).
None of them run on their own; a person has to start each one. Grouped by what
they're for, so the right one can be found without reading every file:

**Bringing in official records for the first time**

| Tool | What it does | Costs money? |
|---|---|---|
| `scripts/load_minnesota_data.py` | Pulls a legislative session's bills and votes from Minnesota's official websites into our database | No |
| `scripts/load_campaign_finance.py` | Downloads Minnesota's 3 official campaign-money files and stores the exact bytes, dated | No |
| `scripts/load_campaign_finance_filings.py` | Asks Minnesota's campaign-finance board, one committee at a time, what that committee itself reported raising and spending | No |
| `scripts/build_legislative_district_boundaries.py` | Builds the map of Minnesota's voting districts from the state's official 2022 election-map files | No |
| `scripts/load_sample_data.py` | Loads made-up practice data for testing on a laptop. Never touches real records | No |

**Checking data quality (read-only; these fix nothing themselves, they just find problems)**

| Tool | What it does | Costs money? |
|---|---|---|
| `scripts/check_bill_section_gaps.py` | Finds a bill whose saved text is missing pieces the state actually published (also runs on the daily clock above) | No |
| `scripts/check_rag_coverage.py` | Finds a bill that's saved but invisible to search (also runs on the daily clock above) | No |
| `scripts/check_home_hero_card_literals.py` | Checks the homepage's stated facts against the official record (also runs on the monthly clock above) | No |
| `scripts/check_schema_drift.py` | Checks that the database's actual structure matches what the code expects. During issue #1045's 3-release account-date rename, it allows only the 2 exact old-name columns that keep old and new Railway copies working together; the final release removes those columns and the allowance | No |
| `scripts/check_declared_dependencies.py` | Checks the code isn't secretly relying on an outside package it never officially listed | No |
| `scripts/check_doc_references.py` | Checks every link from one page of notes to another actually goes somewhere real | No |
| `scripts/check_doc_sync.py` | Checks a code change was checked against the plain-language guide that describes it | No |
| `scripts/check_no_nul_bytes.py` | Checks no saved file contains a hidden character that makes searches blind to it | No |

**Backfilling one field that's missing on old records**

| Tool | What it does | Costs money? |
|---|---|---|
| `scripts/backfill_bill_action_committee_name.py` | Fills in which committee took each recorded action, from a free official file | No |
| `scripts/backfill_bill_section_body_blocks.py` | Re-splits an old bill's saved text into the same structured pieces newer bills already have | No |
| `scripts/backfill_bill_title_from_current_version.py` | Fixes a bill's stored title where an old software bug left it wrong | No |
| `scripts/backfill_companion_links.py` | Links a bill to its matching version in the other legislative chamber | No |
| `scripts/backfill_vote_event_dates.py` | Fills in the missing date on an old vote record | No |
| `scripts/backfill_rag_bulk.py` | Makes a bill searchable by feeding its text to a paid "meaning-search" tool | **Yes — see section 4** |

**One-off repairs (each one fixes damage from a specific past bug, then is done)**

| Tool | What it does | Costs money? |
|---|---|---|
| `scripts/clean_stale_bill_versions.py` | Removes leftover duplicate copies of a bill's text | No |
| `scripts/correct_bill_current_statuses.py` | Corrects a bill's shown status without re-fetching anything | No |
| `scripts/dedupe_ai_enrichment.py` | Removes duplicate AI-written summaries a past bug let through | No |
| `scripts/delete_fixture_bills.py` | Deletes fake test bills that a test accidentally wrote into the real database | No |
| `scripts/repair_companion_links.py` | Fixes companion-bill links that crossed a session boundary wrongly | No |
| `scripts/repair_missing_bill_sections.py` | Restores bill text lost to a specific past ingestion bug | No |
| `scripts/repair_mojibake_text.py` | Fixes text that was saved with the wrong character encoding, showing as garbled symbols | No |
| `scripts/reanchor_rag_to_current_version.py` | Re-points a bill's search index at the correct, current version of its text | No |
| `scripts/dump_evidence_document.py` | Saves, restores, or compares a backup of one specific database table, as an undo tool for a past incident | No |

**Reviewing campaign-money records**

| Tool | What it does | Costs money? |
|---|---|---|
| `scripts/review_legislator_campaign_committees.py` | Helps confirm which money account (a "committee") belongs to which sitting legislator | No |
| `scripts/show_party_and_caucus_money.py` | Prints how much money moved in and out of Minnesota's political parties and caucuses. Only reads, never writes | No |

**Checking whether the AI's writing and search are actually good**

| Tool | What it does | Costs money? |
|---|---|---|
| `scripts/answer_eval.py` | Scores how good a written answer is against 20 real, human-checked questions | **Yes — small, see section 4** |
| `scripts/retrieval_eval.py` | Scores whether search finds the right bill, against 20 real questions | **Yes — small, see section 4** |
| `scripts/validate_query_rubric.py` | Checks the scoring rules above against known-good examples | No |
| `scripts/try_queries.py` | Lets someone try a search question by hand and see what comes back | No |

**Keeping search fast**

| Tool | What it does | Costs money? |
|---|---|---|
| `scripts/build_rag_hnsw_index.py` | Rebuilds the database's search speed-index on the live site | No |
| `scripts/mirror_raw_files.py` | Copies stored campaign-finance files to the second storage company (also runs on the daily clock above) | No |

**The building blocks behind all of the above (`alethical/pipeline/`)**

Most of the 37 tools call into a shared set of files rather than being run
directly. The ones worth knowing by name:

- `votes.py` — the actual vote-importing code the daily vote job (section 1) runs.
- `anthropic_enrichment.py` and `ai_enrichment.py` — the 2 tools that write a
  bill's plain-language summary (section 4 explains their cost).
- `rag_ingest.py` — turns bill text into the "meaning coordinates" search uses;
  called by the search-related tools above.
- `oban.py` and `oban_workers.py` — a queue that can run enrichment, search-indexing,
  and other jobs from a waiting list instead of one at a time by hand.
- `campaign_finance.py`, `campaign_finance_filings.py`, `campaign_finance_reader.py` —
  the campaign-money importing code the `load_campaign_finance*` tools above call.

## 4. Which ones spend money

This is the section that matters most, so it is exact. Everywhere below, "spends
money" means the tool makes a paid call to an outside AI company (OpenAI or
Anthropic, the maker of Claude). Nothing on the automatic clock in section 1
spends money — every scheduled job either reads a free government website or
runs one database check.

| Tool | Does it actually call a paid AI model? | What it costs |
|---|---|---|
| `alethical/pipeline/anthropic_enrichment.py` — writes a bill's plain-language summary using Claude; this is the one production actually uses | **Yes, every time it's run this way** | About **7 cents a bill**. Re-writing all 10,471 bills at once costs roughly **$730** at the normal rate, or about **$365** if run in the cheaper overnight "batch" mode |
| `alethical/pipeline/ai_enrichment.py` — writes a bill's summary using a different company's model (OpenAI), and separately writes a short scannable headline for bills with an overly legal title | **Yes** | The exact figure per run isn't recorded in the repository for this path; the headline-writing part uses OpenAI's cheapest model (`gpt-4o-mini`), which is inexpensive per bill but the precise cost isn't measured here |
| `alethical/pipeline/oban.py` / `oban_workers.py` — the waiting-list system (a "job queue") that can run either of the 2 tools above, plus search-indexing, without someone typing the command directly | **Yes, when it's told to run one of those jobs** — the queue itself doesn't decide to spend money, it just carries out whatever job is queued | Same cost as whichever job it's running |
| `alethical/pipeline/rag_ingest.py` — turns bill text into the numbers search uses (an "embedding") | **Yes** | About **a tenth of a cent per bill** (a full 10,500-bill re-run is about **$10**). Making every bill searchable is roughly **70 times cheaper** than writing every bill's summary |
| `scripts/backfill_rag_bulk.py` — the command a person runs to make a specific bill searchable | **Yes**, it calls `rag_ingest.py` above | Same as `rag_ingest.py`: about a tenth of a cent a bill. It's a dry run (nothing is spent) unless someone adds `--apply` |
| `scripts/answer_eval.py` — scores how good a written answer is | **Yes**, small | A few cents per full run: it needs about 20 real search lookups, plus generating and judging a small number of test answers |
| `scripts/retrieval_eval.py` — scores whether search finds the right bill | **Yes**, small | About 20 search lookups per run, each a fraction of a cent |
| `scripts/backfill_bill_action_committee_name.py`, `backfill_bill_section_body_blocks.py`, `backfill_bill_title_from_current_version.py`, `backfill_companion_links.py`, `backfill_vote_event_dates.py` and every "repair" tool listed in section 3 | No — each one says outright in its own file that it is a free, one-time fix | Free |
| `alethical/pipeline/codex_enrichment.py` — a third, separate way of writing a bill's summary, kept only to compare against the other two | Its own code makes no direct paid call; it exists to be compared against the 2 writers above, which do | Same as whichever summary-writer it's being compared to |

**The most important line in this section: nothing on the automatic clock spends
money.** All 2 spending paths (writing summaries, and making bills searchable)
run only when a person deliberately types the command.

## 5. Which account pays

There are 2 separate places money can come from for Claude's writing work, and
they live in one file: a local settings file at the very top of this project
(`.env`, never saved to the shared codebase). It can hold either or both of
these:

- **A Claude subscription login** (the setting `CLAUDE_CODE_OAUTH_TOKEN`) — this
  bills against the monthly Claude plan Alethical already pays for, the same
  way using Claude Code day to day does.
- **A pay-per-use Anthropic key** (the setting `ANTHROPIC_API_KEY`) — this bills
  a separate prepaid balance, per word written, whether or not the monthly plan
  has room left.

**When both are present, the pay-per-use key wins.** Anthropic's own tools check
for the pay-per-use key first, so if it's sitting in the settings file, the work
gets billed to that separate balance instead of coming out of the monthly plan,
even if the monthly plan has plenty of room left. The bill-summary writing tool
(`alethical/pipeline/anthropic_enrichment.py`) reads this same settings file, and
its own instructions note that it deliberately hides the pay-per-use key from
itself when it's told to use the subscription path on purpose — otherwise the
key would silently outrank that choice too.

Two more settings in the same file matter for cost, and neither is a login secret:
`OPENAI_API_KEY` (the OpenAI equivalent of the Anthropic key above, needed for
anything using OpenAI's models or its search-numbers tool) and `VOYAGE_API_KEY`
(a second, unused search-numbers provider that was evaluated and rejected — see
[AI models & billing](../product-onboarding/ai-models-and-billing.md) section 5).

This page does not print any key or login value, and none were opened beyond
confirming a setting's name exists.

## Related

- [AI models & billing](../product-onboarding/ai-models-and-billing.md) — the full
  reasoning behind every figure in section 4 above: why the writing tool costs what
  it does, how the overnight discount works, and what got measured and what didn't.
- [Deployment](deployment.md) — the hosting side of section 2: how Railway and
  Vercel are set up, and the settings that control them.
