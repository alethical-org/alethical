# What runs, when, and what it costs

<!-- describes: .github/workflows/**, scripts/**, alethical/pipeline/**, alethical/api/routers/ask.py, alethical/api/routers/me.py, alethical/api/services/ask_router.py -->

Net: The repository has 17 GitHub Actions workflows. 14 can start automatically
and 3 run only when a person starts them. Scheduled checks, releases, and local
backups do not call paid AI services. Reader questions and deliberately started
AI work do.

## What starts automatically

| Work | Starts when | What it does | Usage-based cost |
| --- | --- | --- | --- |
| Project checks (`.github/workflows/ci.yml`) | Every pull request and push to `main` | Runs the code, formatting, security, and document checks | No paid AI call; [standard GitHub-hosted runners are free for public repositories](https://docs.github.com/en/actions/concepts/billing-and-usage) |
| New votes (`.github/workflows/vote-backfill.yml`) | Daily at 09:00 UTC | Adds newly published House and Senate roll-call votes | No paid AI call; reads free government sources |
| Missing bill sections (`.github/workflows/bill-section-gaps.yml`) | Daily at 11:00 UTC | Opens or updates an issue when stored bill text is incomplete | No paid AI call; reads the database |
| Committee links still agree (`.github/workflows/committee-link-contradictions.yml`) | Weekly, Mondays at 15:00 UTC | Re-reads every campaign account a person confirmed as a politician's against Minnesota's own records, and opens or updates an issue when one no longer agrees | No paid AI call; 2 free government downloads and one read of the database |
| Bills missing from search (`.github/workflows/rag-coverage-gaps.yml`) | Daily at 12:00 UTC | Opens or updates an issue when a stored bill has no current search index | No paid AI call; reads the database and does not rebuild the index |
| Second copy of source files (`.github/workflows/mirror-raw-files.yml`) | Daily at 13:00 UTC | Copies new campaign-finance stored files from Supabase to Cloudflare R2, then verifies them. Covers all 3 kinds of stored body (bulk downloads, totals archives, report documents), discovered from the database schema so a later 4th kind is copied from the day it ships | No paid AI call; [Cloudflare R2 includes 10 GB of Standard storage and large monthly operation allowances](https://developers.cloudflare.com/r2/pricing/) before charges |
| Bills with summary gaps (`.github/workflows/bill-summary-coverage.yml`) | Daily at 14:00 UTC | Opens or updates 1 issue when a bill has complete current text but its full summary is missing or was made from older text or instructions | No paid AI call; reads the database and does not create or change a summary |
| Homepage fact check (`.github/workflows/home-hero-card-facts.yml`) | Monthly at 12:00 UTC on day 1, and on relevant pull requests | Checks the homepage's 5 bill claims against Minnesota's published record | No paid AI call; reads public government pages |
| Technology health (`.github/workflows/technology-health.yml`) | Monthly at 13:17 UTC on day 1, and by hand | Checks saved tool versions, package safety, support dates, and whether the 3-month major-release review is overdue | No paid AI call; reads public package lists on GitHub's standard computer |
| Hosted service settings (`.github/workflows/hosted-service-settings.yml`) | Monthly at 09:30 UTC on day 1, on relevant pull requests, and after relevant changes reach `main` | Compares the intended GitHub, Vercel, Railway, and Supabase settings with their live read routes; keeps Supabase's rotating read grant as 2 encrypted 90-day artifacts; lists every setting it cannot safely read | No paid AI call; reads existing service APIs on GitHub's standard free runner |
| Traffic access key (`.github/workflows/traffic-token-expiry.yml`) | Daily at 12:00 UTC | Opens 1 issue 60 days before the private Vercel Traffic key expires and adds 1 urgent note 14 days before | No paid AI call; reads 1 date stored in the repository |
| Backend release (Railway Git connection) | A commit reaches `main` | Applies database changes, then releases the API if its readiness check passes | No paid AI call; build and hosting usage stays on the existing Railway account |
| Website release (Vercel Git connection) | A relevant commit reaches `main` | Builds and releases the web app | No paid AI call; build and hosting usage stays on the existing Vercel account |
| Unsaved-work backup (`com.alethical.wip-backup`) | Every 5 minutes after `just install-wip-backup` is installed on Eugene's Mac | Saves uncommitted work from each worktree to a local Git reference and an outside bundle | No outside service |

The 9 clock-based GitHub jobs use UTC. Minnesota moves between Central Standard
Time and Central Daylight Time, so their local hour changes by 1 during the year.

## What GitHub runs only by hand

These 4 workflows complete the total of 14:

| Workflow | Purpose | Usage-based cost |
| --- | --- | --- |
| `.github/workflows/legislator-city-backfill.yml` | Preview or fill missing legislator residence cities | No paid AI call; reads public government sources and the database |
| `.github/workflows/migrate.yml` | Apply database changes and check for structural drift when the normal Railway release path needs a fallback | No paid AI call; uses GitHub and the existing database service |
| `.github/workflows/railway-deploy.yml` | Release the API when Railway's Git connection needs a fallback | No paid AI call; build and hosting usage stays on the existing Railway account |
| `.github/workflows/vercel-deploy.yml` | Release the web app when Vercel's Git connection needs a fallback | No paid AI call; build and hosting usage stays on the existing Vercel account |

[Deployment](deployment.md) owns the release setup and recovery steps. This page
owns the workflow count, triggers, and costs.

## Command-line tools

The `scripts/` folder has 48 runnable files. GitHub jobs call 14 of them, and the
Mac backup above calls 1. The complete list is grouped here so a new file cannot
hide inside a total:

| Purpose | Files |
| --- | --- |
| Import official records or test data | `build_legislative_district_boundaries.py`, `load_campaign_finance.py`, `load_campaign_finance_filings.py`, `load_lobbying_expenditures.py`, `load_minnesota_data.py`, `load_sample_data.py` |
| Check data, code, documents, local tools, and hosted settings | `audit_repaired_bill_prompt_context.py`, `check_bill_section_gaps.py`, `check_bill_summary_coverage.py`, `check_campaign_finance_stated_split.py`, `check_declared_dependencies.py`, `check_doc_quotes.py`, `check_doc_references.py`, `check_doc_sync.py`, `check_home_hero_card_literals.py`, `check_hosted_service_settings.py`, `check_local_env.py`, `check_no_nul_bytes.py`, `check_rag_coverage.py`, `check_schema_drift.py`, `check_technology_health.py` |
| Fill missing fields on older records | `backfill_bill_action_committee_name.py`, `backfill_bill_section_body_blocks.py`, `backfill_bill_title_from_current_version.py`, `backfill_campaign_finance_report_documents.py`, `backfill_companion_links.py`, `backfill_rag_bulk.py`, `backfill_vote_event_dates.py` |
| Repair damage from past bugs | `clean_stale_bill_versions.py`, `correct_bill_current_statuses.py`, `dedupe_ai_enrichment.py`, `delete_fixture_bills.py`, `dump_evidence_document.py`, `reanchor_rag_to_current_version.py`, `repair_companion_links.py`, `repair_incomplete_vote_records.py`, `repair_missing_bill_sections.py`, `repair_mojibake_text.py`, `repair_vote_roster_identities.py` |
| Review campaign-finance records | `recompute_lobbying_published_figures.py`, `review_legislator_campaign_committees.py`, `show_party_and_caucus_money.py` |
| Measure AI answers and search | `answer_eval.py`, `retrieval_eval.py`, `try_queries.py`, `validate_query_rubric.py` |
| Maintain search and stored files | `build_rag_hnsw_index.py`, `mirror_raw_files.py` |
| Protect unfinished work and rotating read grants | `back-up-uncommitted-worktree-work.sh`, `supabase_oauth_state.mjs` |

Most of these commands use shared code in `alethical/pipeline/`. The queue in
`alethical/pipeline/oban.py` and `alethical/pipeline/oban_workers.py` can run an
explicitly queued import, summary, or search-index job. The queue does not create
work or approve spending on its own. An accepted official-text change records one
full-summary request in PostgreSQL. The request becomes runnable only after the
same text has complete search rows. The paid worker still refuses to run unless
its off switch, monthly ceiling, per-bill ceiling, failure limit, and total-try
limit are all positive. The switch is `false` and all 4 limits are `0` by
default, so the shipped settings cannot make a paid call.

## What spends money

Job-driven AI spending has 3 possible triggers: a reader submits an Ask question,
a person starts AI work or an evaluation, or an accepted official bill-text
change reaches a ready summary request while its separate spending gate is open.
That last gate is off by default. No clock-based job above opens it.

| Work | What starts it | Paid service | Cost shape |
| --- | --- | --- | --- |
| Sort an Ask question and, when needed, choose its bill (`alethical/api/services/ask_router.py`) | A reader submits a question | OpenAI text generation | Recurs with reader traffic; varies with the question and configured model |
| Find passages for an Ask question (`alethical/api/routers/me.py`) | A reader submits a question that needs bill retrieval | OpenAI embeddings | Recurs with reader traffic; a small call for each query |
| Write a cited Ask answer (`alethical/api/routers/me.py`) | A reader asks a question with enough source text to answer | OpenAI or Anthropic text generation | Recurs with reader traffic; varies with answer length and configured model |
| Write bill summaries, key points, questions, citations, and topic tags (`alethical/pipeline/anthropic_enrichment.py`, `ai_enrichment.py`, `bill_summary_requests.py`, `codex_enrichment.py`) | A person starts generation, or saved official text creates a ready request while all automatic-spending settings are open | Claude subscription, Anthropic API, OpenAI API, or Codex subscription, depending on the chosen path; the automatic request uses Anthropic API only | The older bulk run measured about $0.064 to $0.072 per bill, about $730 for 10,471 bills at list price or about $365 through the half-price batch path. Those figures do not approve the new automatic path; its per-bill and monthly limits must be measured and approved before its switch changes from `false` |
| Build or replace a bill's search index (`alethical/pipeline/rag_ingest.py`, `scripts/backfill_rag_bulk.py`, or a queued RAG worker) | A person starts or queues an ingest or backfill that includes RAG | OpenAI embeddings | About $0.001 per bill in the measured run, or about $10 for 10,500 bills |
| Run AI answer or retrieval evaluations (`scripts/answer_eval.py`, `scripts/retrieval_eval.py`, `scripts/try_queries.py`) | A person starts the command | OpenAI, Anthropic, or Voyage APIs, depending on the mode | Varies by mode; cached results avoid paying again for unchanged work |

The cost figures above are measurements and sizing rules, not provider price
promises. [AI Models & Billing](../product-onboarding/ai-models-and-billing.md)
owns the full evidence, account rules, model choices, and current pricing checks.

Moving these calls to OpenAI's and Anthropic's official Python libraries does not
add a paid job or change which account pays. It changes the request plumbing. The
libraries will have automatic retries off, while Alethical keeps the total-try,
deadline, checkpoint, and spending rules. The shipped-versus-planned boundary is
in [How Alethical Calls OpenAI and Anthropic, and When It Retries](../architecture/ai-provider-calls-and-retries.md).

Live web requests use API keys held by Railway. They cannot use a person's Claude
or Codex subscription. Batch summary work can use a subscription or an API path;
embedding work is API-only.

## Related

- [How Alethical calls OpenAI and Anthropic, and when it retries](../architecture/ai-provider-calls-and-retries.md):
  the official-library plan, attempt limits, honest failure state, issue split,
  effort, and remaining unknowns.
- [Deployment](deployment.md) explains Railway, Vercel, Supabase, release fallbacks,
  and the settings the live services need.
- [AI Models & Billing](../product-onboarding/ai-models-and-billing.md) explains which
  account pays for each AI path and how the measured costs were calculated.
- [`CONTRIBUTING.md`](../../CONTRIBUTING.md) § "Keeping the workflow actions current"
  explains why borrowed GitHub Action steps need periodic updates.
