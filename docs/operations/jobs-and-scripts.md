# What runs, when, and what it costs

<!-- describes: .github/workflows/**, scripts/**, alethical/pipeline/**, alethical/api/routers/ask.py, alethical/api/routers/me.py, alethical/api/services/ask_router.py, alethical/api/services/candidate_claim_email.py, alethical/api/main.py, api/search-measurements.ts -->

Net: The repository has 38 GitHub Actions workflows. 32 can start automatically
and 6 run only when a person starts them. Scheduled checks, releases, and local
backups do not call paid AI services. Reader questions and deliberately started
AI work do. The review of a failed campaign-money collection has a paid AI
reviewer too, and its switch is off until its limits are approved.

Public-record collection uses saved deadlines and 1 shared scheduled workflow.
The existing API can also wake due jobs through a restricted GitHub App. Source
checks and ordinary collection use free official reads and existing infrastructure.
Changed bill text keeps the approved search-index update; automatic AI summaries
and the paid failure reviewer remain switched off.

[Public-record updates: coverage and recovery](public-record-refresh-status.md)
tracks the measured freshness gaps and the completion checks for the existing shared
update work. A listed timer does not establish that its latest records are live.

## What starts automatically

| Work | Starts when | What it does | Usage-based cost |
| --- | --- | --- | --- |
| Public reader checks (`.github/workflows/reader-completion-checks.yml`) | A commit reaches `main`, a trusted caller, or by hand | Exercises real public reader actions and proves the intended website changes reached the live address | No paid AI call; existing GitHub runner usage and public GET reads |
| Public search response checks (`.github/workflows/public-search-health.yml`) | Daily at 17:17 UTC, after successful trusted-main reader checks, or by hand; Monday samples more records | Checks public sitemaps, indexing instructions, useful initial text and separately allowed year/tab record views with bounded reads, retaining failure evidence for 35 days | No paid AI call or new service fee; existing GitHub runner usage and public GET reads |
| Temporary page-failure evidence (`.github/workflows/page-failure-health.yml`) | Hourly, or by hand on trusted `main` | Saves bounded public-safe failure and recovery counts and types for 35 days; the daily search check detects missed or incomplete hours | No paid AI call or new service fee; standard free GitHub runner and existing Vercel read access |
| Expired private search data (`.github/workflows/private-search-retention.yml`) | Daily at 08:23 UTC, or by hand on trusted `main`; live sweep verification pending | Deletes expired raw search exports and safe summaries without depending on provider collection; commits a success receipt with deletion, verifies it separately and fails visibly on error | No paid AI call or new service; standard free GitHub runner and bounded use of the existing database |
| Public changed-page notices (`.github/workflows/public-change-notices.yml`) | After a successful trusted-main public search check, or by hand on `main`; first initialization sends 0 old addresses | Saves a bounded public change queue on a deployment-disabled state branch; sends at most 100 validated notices and retains unaccepted changes and requested retry waits | No paid AI call, provider fee or new clock job; existing GitHub runner and public IndexNow endpoint |
| Bounded website repair (`.github/workflows/website-release-recovery.yml`) | A trusted current-main missing-release alarm fails, or by hand with dry run on by default | Stages and promotes at most 1 proven missed website release per commit, preserving rollback holds and checking live reader actions | No paid AI call; existing GitHub and Vercel build/hosting usage |
| Project checks (`.github/workflows/ci.yml`) | Pull request code events, merge-queue checks, and pushes to `main` | Runs the code, formatting, security and document checks, including built-app replay startup and recovery with local sample records | No paid AI call; [standard GitHub-hosted runners are free for public repositories](https://docs.github.com/en/actions/concepts/billing-and-usage) |
| Latest change explanation (`.github/workflows/pr-description.yml`) | Pull request opens, code updates, reopens, ready-for-review events, description edits, and merge-queue checks | Reads the latest `Docs check:` explanation against the current code; does not rerun app or server tests or replace their results | No paid AI call; read-only GitHub requests on a standard free runner |
| Due public records (`.github/workflows/source-record-refresh.yml`) | Hourly at minute 17; optionally woken by the existing API; also by hand | Runs enabled families in bounded turns, with saved progress, source-specific lanes, age-aware priority, retries and 1 grouped health issue; see the source table below | Free public GitHub runners and official reads; changed bill search embeddings retain the approval in [issue 1323](https://github.com/alethical-org/alethical/issues/1323) |
| Campaign notices fallback (`.github/workflows/campaign-money-notices.yml`) | Existing election-window and weekly timers while the notices family is off; manual recovery remains available | Collects notices, catalogues and approved readings with the narrow shared mutation lock | No paid AI call; official sources and existing storage |
| Campaign money fallback (`.github/workflows/campaign-money-refresh.yml`) | Daily at 15:30 UTC while the campaign family is off; also by hand | Preserves the existing full refresh and failure drill during staged activation | No paid AI call; official sources and existing database |
| Vote fallback (`.github/workflows/vote-backfill.yml`) | Daily at 09:00 UTC while the legislative family is off; also by hand | Collects missing votes during staged activation | No paid AI call; official sources and existing database |
| Missing bill sections (`.github/workflows/bill-section-gaps.yml`) | Daily at 11:00 UTC | Opens or updates an issue when stored bill text is incomplete | No paid AI call; reads the database |
| Committee links still agree (`.github/workflows/committee-link-contradictions.yml`) | Weekly, Mondays at 15:00 UTC | Re-reads every campaign account a person confirmed as a politician's against Minnesota's own records, and opens or updates an issue when one no longer agrees | No paid AI call; 2 free government downloads and one read of the database |
| Copy of every cited source (`.github/workflows/published-source-archive.yml`) | Weekly, Mondays at 10:00 UTC | Re-reads every outside address our published research and guides cite, keeps our own copy of each version, and opens or updates an issue when one has gone or changed | No paid AI call; free government page reads and storage in a bucket we already pay for |
| Published piece links still work (`.github/workflows/published-piece-links.yml`) | Weekly, Mondays at 13:00 UTC, and on relevant pull requests | Opens or updates an issue when a link inside a published piece no longer reaches a real page; a pull request only checks the pieces' own links, without reading the network | No paid AI call; free government page reads |
| Bills missing from search (`.github/workflows/rag-coverage-gaps.yml`) | Daily at 12:00 UTC | Opens or updates an issue when a stored bill has no current search index | No paid AI call; reads the database and does not rebuild the index |
| FCC political-file archive (`.github/workflows/fcc-political-files.yml`) | Daily at 06:23 UTC while the FCC family is off, or by hand with dry run on by default | Lists all available political folders and years for KSTP-TV, KARE and KMSP-TV; attempts up to 1,000 new, changed or due downloads, up to 2,500 second copies and up to 1,000 local readings; reports source gaps, operational failures and unfinished work in a run summary and 1 continuing issue | No paid AI call; free FCC downloads, existing GitHub runner usage and private Supabase/R2 storage and transfer allowances |
| Second copy of source files (`.github/workflows/mirror-raw-files.yml`) | Daily at 13:00 UTC | Checks current files in Supabase and Cloudflare R2, repairs missing second copies, and renews old hash proofs within a 256 MiB combined read budget. Discovers stored-source tables from the database schema, including FCC political-file copies, so a new source joins the backup without a separate table list | No paid AI call; [Cloudflare R2 includes 10 GB of Standard storage and large monthly operation allowances](https://developers.cloudflare.com/r2/pricing/) before charges |
| Bills with summary gaps (`.github/workflows/bill-summary-coverage.yml`) | Daily at 14:00 UTC | Opens or updates 1 issue when a bill has complete current text but its full summary is missing or was made from older text or instructions | No paid AI call; reads the database and does not create or change a summary |
| Homepage fact check (`.github/workflows/home-hero-card-facts.yml`) | Daily at 12:00 UTC, and on relevant pull requests | Checks the homepage's 5 bill claims against Minnesota's published record | No paid AI call; reads public government pages |
| Pillow runtime (`.github/workflows/pillow-runtime.yml`) | Each CI or technology-health run, or a local security request on `main` | Lets only the first of the copies GitHub starts for 1 request probe production; waits up to 10 minutes for an API deploy to finish, then reads saved production variable names and all active image instances; binds the evidence to one requesting check | No paid AI or new service fee; standard free GitHub runner and a production-scoped token kept in a `main`-only environment |
| Technology health (`.github/workflows/technology-health.yml`) | Security every Monday at 13:41 UTC; full review monthly at 13:17 UTC on day 1, and by hand | Checks known package vulnerabilities and the unfixed Pillow advisory weekly; the monthly review also checks saved tool versions, support dates, and whether the 3-month major-release review is overdue | No paid AI call; reads public package lists on GitHub's standard computer |
| Railway deployment timing (`.github/workflows/railway-timings.yml`) | Relevant pull requests run credential-free tests; deployment timing is read only by hand | Reads selected production deployment event times, retaining unknown phases and separate attempts; never deploys or reads service variables/logs | No paid AI call or new service fee; bounded reads on the existing Railway account and a standard free GitHub runner |
| Hosted service settings (`.github/workflows/hosted-service-settings.yml`) | Monthly at 09:30 UTC on day 1, on relevant pull requests, and after relevant changes reach `main` | Compares the intended GitHub, Vercel, Railway, and Supabase settings with their live read routes; keeps Supabase's rotating read grant as 2 encrypted 90-day artifacts; lists every setting it cannot safely read | No paid AI call; reads existing service APIs on GitHub's standard free runner |
| Failed-collection review (`.github/workflows/collection-failure-review.yml`) | When the daily campaign-money refresh or the notices collection finishes on `main` from its schedule or by hand, and by hand for a named run | Keeps 1 issue per distinct collection failure (label `collection-incident`), removes secrets and personal details from the evidence first, adds 1 comment only when the evidence changes, and closes the issue only when a later run's own summary says every stage finished. Never re-runs a collection. Turns the run red while an issue is open, and files a plain alert if the review itself breaks. [Decisions](../architecture/collection-failure-review-decisions.md) | No paid AI call while its switch is off, which it is; a few GitHub reads per completion on a standard free runner. The paid reviewer's costs are under "What spends money" |
| Money pages stay warm (`.github/workflows/warm-money-pages.yml`) | After each successful production release, and daily at 16:00 UTC | Reads the 5 money addresses and the 4 campaign-money data routes once, so the first real reader after a release is not the one who waits on a cold read. Prints nothing when every address answers; opens no issue | No paid AI call; a handful of reads of our own live site on GitHub's standard free runner |
| Private Site Metrics access (`.github/workflows/site-metrics-health.yml`) | Daily at 13:43 UTC, and by hand | Checks that each private measurement answer denies a signed-out request; an administrator must separately check source freshness | No paid AI call; unsigned reads on GitHub's standard free runner |
| Failed release says so (`.github/workflows/production-release-failed.yml`) | After each production release, succeeded or failed | Opens 1 issue when the website's own release fails, so a merge that reaches nobody does not sit unnoticed; comments rather than opening a second while it keeps failing and says how many have failed in a row, and closes that issue when a release next succeeds. Ignores preview releases, which ship to nobody. Turns the run red as well, so the Actions tab cannot read as quiet while its issue is open | No paid AI call; reads 1 deployment event on GitHub's standard free runner |
| Missing release says so (`.github/workflows/production-release-missing.yml`) | After each change reaches `main`, and by hand | Reads which commit the live site says built it and compares that with `main`. Opens 1 issue when a merged website change is not reaching readers after 10 minutes, comments rather than opening a second, and closes that issue once readers are up to date. Says nothing for a documents-only merge, which correctly needs no release. Turns the run red as well when it alarms on `main`, so the Actions tab cannot read as quiet while its issue is open | No paid AI call; 1 read a minute of our own live site on GitHub's standard free runner |
| Missing API release says so (`.github/workflows/api-release-missing.yml`) | After each change reaches `main`, and by hand | Asks the live API which commit it is running and compares that with `main`. Opens 1 issue when a merged API change has not reached the API after 15 minutes, comments rather than opening a second, and closes that issue once the API is up to date. Says nothing for a merge that changes only the website or documents, which correctly needs no API release. Turns the run red as well when it alarms on `main`, so the Actions tab cannot read as quiet while its issue is open | No paid AI call; 1 read a minute of our own live API on GitHub's standard free runner |
| Traffic access key (`.github/workflows/traffic-token-expiry.yml`) | Daily at 12:00 UTC | Opens 1 issue 60 days before the private Vercel Traffic key expires and adds 1 urgent note 14 days before | No paid AI call; reads 1 date stored in the repository |
| Profile claim notification queue (`alethical/api/services/candidate_claim_email.py`, started by `alethical/api/main.py`) | API startup, then 10 seconds after each completed drain; sending requires the profile-claim and general email switches | Sends saved request/decision notices separately to eligible current recipients, considers 20 ready deliveries per drain by default (maximum 100), shares the comment sender's lock, and limits uncertain-send retries to 23 hours | No paid AI call or new service; idle wakeups use existing hosting/database resources, and actual messages use the existing Resend account and its allowance |
| Address suggestion copy (`alethical/api/services/address_suggestion_index.py`, started by `alethical/api/main.py`) | Only when `ALETHICAL_ADDRESS_SUGGESTION_INDEX_ENABLED` is on (`true` in production): API startup, then a check every 5 minutes; every API start, on or off, prints 1 `ADDRESS_COPY_CAPACITY` line of host facts | Downloads Minnesota's public address file when the shared copy is missing, damaged or 12 hours old, at most 1 build per machine, retrying after 1 hour on failure; [deployment.md § Address suggestion copy activation](deployment.md#address-suggestion-copy-activation) owns the gates | No paid AI call or new service; downloads a free public government file using existing hosting disk, memory and network |
| Backend release (Railway Git connection) | A commit reaches `main` | Applies database changes, then releases the API if its readiness check passes | No paid AI call; build and hosting usage stays on the existing Railway account |
| Website release (Vercel Git connection) | A relevant commit reaches `main` | Builds and releases the web app | No paid AI call; build and hosting usage stays on the existing Vercel account |
| Unsaved-work backup (`com.alethical.wip-backup`, `com.commercialdeals.wip-backup`) | Every 5 minutes after each project's profile is installed on the configured Mac | Saves each working folder's staged and on-disk source separately, with private outside bundles and separate project storage | No outside service or paid AI call |
| Working-folder inventory and released-folder cleanup (`com.alethical.worktree-cleanup`, `com.commercialdeals.worktree-cleanup`) | At login, when an owner releases a folder, and daily to refresh the report and retry held removals | Reports every registered folder, saves independent recovery copies, then removes admitted clean delivered folders only after every owner releases them and no program still uses them; persistent preview holds remain, and Codex-managed folders use the app's archive tool | No outside service charge or paid AI call; reads GitHub change status |
| [Local coding job activity](agent-job-outcomes.md) | Supported Claude Code and Codex events after installation, host review and explicit job registration | Saves private event metadata against the existing job; a reply ending never finishes a job or starts another turn | No outside call or paid AI call |

[FCC political-file instructions](../implementation/fcc-political-files.md#ongoing-collection-and-reporting)
own the fixed scope, retry order, reporting, pause, recovery and acceptance checks.

The profile-claim sender is an API worker, not another GitHub workflow. Its intended
accepted-production flag is `true`, staged off until
[deployment.md § Profile claim email activation](deployment.md#profile-claim-email-activation)
passes. Its queue wakeup calls no paid API; only eligible queued messages reach Resend.

The 21 clock-based GitHub jobs use UTC. Minnesota moves between Central Standard
Time and Central Daylight Time, so their local hour changes by 1 during the year.

## What GitHub runs only by hand

These 6 workflows complete the total of 38:

| Workflow | Purpose | Usage-based cost |
| --- | --- | --- |
| `.github/workflows/address-copy-capacity.yml` | Read the existing Railway server’s capacity without exposing private logs | No paid AI call; bounded reads on the existing account |
| `.github/workflows/address-copy-control.yml` | Switch copied address suggestions on after measured capacity and charges review, or restore live suggestions | No paid AI call or new resource; existing Railway deployment and hosting usage |
| `.github/workflows/legislator-city-backfill.yml` | Preview or fill missing legislator residence cities | No paid AI call; reads public government sources and the database |
| `.github/workflows/migrate.yml` | Apply database changes and check for structural drift when the normal Railway release path needs a fallback | No paid AI call; uses GitHub and the existing database service |
| `.github/workflows/railway-deploy.yml` | Release the API when Railway's Git connection needs a fallback | No paid AI call; build and hosting usage stays on the existing Railway account |
| `.github/workflows/vercel-deploy.yml` | Release the web app when Vercel's Git connection needs a fallback | No paid AI call; build and hosting usage stays on the existing Vercel account |

[Deployment](deployment.md) owns the release setup and recovery steps. This page
owns the workflow count, triggers, and costs.

## Private search collection awaiting activation

| Work | Intended trigger and current state | What it does | Usage-based cost |
| --- | --- | --- | --- |
| Private search exports (`api/search-measurements.ts`) | Weekly Vercel schedule not armed; implementation ready, live access and collection unverified | Uses Vercel's existing short-lived Google identity and runtime Bing key to collect 3 Google views and 2 Bing views; writes bounded exports through a separate write-only credential to private database storage | No paid AI or new paid service; verify existing Vercel and database allowance before activation |
| Private monthly comparison (`alethical/api/services/search_measurements.py`) | Administrator request; monthly human or explicitly started task review, no recurring AI job | Selects the latest successful pull per month, retaining actual rolling 30-day Google windows and unknown Bing date coverage; never sums overlapping pulls or compares them as 28-day totals | Deterministic reads from the existing database; no paid AI call |

These are not additional GitHub workflows. Their access, private output, retention,
coverage limits and required live checks are owned by
[Public search upkeep](public-search-upkeep.md#private-search-measurement-implementation-ready-live-checks-pending).
The separate daily deletion job above does not need a working weekly collector.

## Retry pending money-page clearing

The campaign-money workflow's manual `clear_pending_only` input runs only the saved
clearing obligations, using its existing Cloudflare access. It does not download
source files, publish records or run money checks. The equivalent command is
`PYTHONPATH=. uv run python scripts/refresh_campaign_finance.py --target production --clear-pending-only`.
Use `--dry-run` to list pending clearing without a write or request to Cloudflare.
A busy campaign run, missing clearing access, unknown event or failed purge leaves
work pending and fails recovery. Retry after the current campaign run releases its
lease. A green clearing-only run cannot resolve an incident whose collection or
rechecks remain unfinished.

## Command-line tools

The `scripts/` folder has 123 runnable files. GitHub jobs call 48 of them
directly and 3 document checks through `local_checks.py`. The 4 Mac helpers above
call `worktree_backup.py` and `worktree_cleanup.py`, which uses `worktree_inventory.py`
for the complete folder report; the older shell command
for source backups calls `worktree_backup.py` too. A workflow also calls
`apps/frontend/scripts/traffic-token-expiry.mjs`, a similarly named script that
lives in a different folder and is not part of this list or its totals. The
complete list is grouped here so a new file cannot hide inside a total:

Tests inside `scripts/tests/` are excluded from this direct-file inventory.

| Purpose | Files |
| --- | --- |
| Run and observe saved public-record deadlines | `refresh_public_records.py`, `report_source_refresh_health.py`, `discover_campaign_records.py`, `discover_legislative_records.py`, `discover_reference_records.py` (roster, map and lobbying release signals), `clear_source_record_pages.py` (retries owed saved-page clearing without collecting), `refresh_fcc_records.py`, `run_scheduled_bill_refresh.py`, `refresh_legislative_records.py`, `refresh_lobbying_records.py` |
| Detect official sources needing a reviewed mapping | `check_legislative_sessions.py`, `check_supporting_sources.py` |
| Prepare private donor evidence and recover reviewed campaign totals | `prepare_lobbyist_donor_evidence.py`, `rollback_campaign_finance_filings.py` |
| Import official records or test data | `build_legislative_district_boundaries.py`, `build_zip_state_reference.py`, `load_campaign_finance.py`, `collect_campaign_finance_notices.py`, `collect_campaign_finance_statements.py`, `load_campaign_finance_filings.py`, `refresh_campaign_finance.py` (the daily campaign-money refresh, all steps in order), `load_lobbying.py` (paired current lobbyists and spending), `load_lobbying_expenditures.py` (spending-only compatibility command), `load_minnesota_data.py`, `load_refund_summaries.py`, `load_sample_data.py` |
| Check data, code, documents, local tools, and hosted settings | `audit_repaired_bill_prompt_context.py`, `check_bill_section_gaps.py`, `check_bill_summary_coverage.py`, `check_campaign_finance_stated_spending.py`, `check_campaign_finance_stated_split.py`, `check_declared_dependencies.py`, `check_doc_quotes.py`, `check_doc_references.py`, `check_doc_structure.py`, `check_doc_sync.py`, `check_home_hero_card_literals.py`, `check_hosted_service_settings.py`, `check_jobs_and_scripts_inventory.py`, `check_local_env.py`, `check_lobbyist_donor_evidence.py`, `check_no_cross_committee_total.py`, `check_no_merge_conflict_markers.py`, `check_no_nul_bytes.py`, `check_production_release_reached_readers.py`, `check_public_search_health.py`, `check_page_failure_coverage.py`, `check_pillow_advisory.py`, `check_pillow_exception.py`, `check_pillow_runtime.py`, `pillow_runtime_claim.py`, `pillow_runtime_evidence.py`, `pillow_source_guard.py`, `check_published_piece_links.py`, `check_rag_coverage.py`, `check_schema_drift.py`, `check_shared_checkout_rules_in_sync.py`, `check_site_metrics_health.py`, `check_site_metrics_privacy.py`, `check_technology_health.py`, `check_timeless_docs.py` |
| Fill missing fields on older records | `backfill_bill_action_committee_name.py`, `backfill_bill_section_body_blocks.py`, `backfill_bill_title_from_current_version.py`, `backfill_campaign_finance_filed_dates.py`, `backfill_campaign_finance_report_documents.py`, `backfill_companion_links.py`, `backfill_rag_bulk.py`, `backfill_vote_event_dates.py`, `enrich_refund_source_metadata.py` |
| Repair damage from past bugs | `clean_stale_bill_versions.py`, `correct_bill_current_statuses.py`, `dedupe_ai_enrichment.py`, `delete_fixture_bills.py`, `dump_evidence_document.py`, `reanchor_rag_to_current_version.py`, `repair_companion_links.py`, `repair_incomplete_vote_records.py`, `repair_missing_bill_sections.py`, `repair_mojibake_text.py`, `repair_vote_roster_identities.py` |
| Prepare a chosen public research email; live delivery is separately gated off | `send_unconcealed.py` |
| Test reader comments with a disposable database and all outgoing mail disabled | `comments_local_qa.py` |
| Review campaign-finance records | `recompute_lobbying_published_figures.py`, `record_disclosure_statement_readings.py`, `review_legislator_campaign_committees.py`, `show_party_and_caucus_money.py` |
| Register approved jobs, record private activity and report outcomes | `agent_job_outcomes.py`, `agent_job_events.py` |
| Read current completion sources and retain a private receipt | `check_agent_job_completion.py` |
| Install pinned local coding hooks while preserving other settings | `install_agent_job_hooks.py` |
| Read selected Railway deployment event times without configuration or logs | `railway_deployment_timings.py` |
| Read the current address-copy host capacity or safely switch the copy on or off | `address_copy_capacity.py`, `address_copy_control.py` |
| Recover 1 proven missed website release with saved evidence | `website_release_recovery.py` |
| Measure AI answers and search | `answer_eval.py`, `graph_retrieval_eval.py`, `retrieval_eval.py`, `try_queries.py`, `validate_query_rubric.py` |
| Compare printed-name search offline without paid calls or live changes | `benchmark_campaign_finance_name_search.py` |
| Collect change history by hand, report examined causes and retain prevention references | `review_repeat_failures.py` |
| Run existing tests once and retain named money-prevention results for the exact tested code | `repeat_failure_runs.py` |
| Measure what real visitors waited for | `report_origin_share_by_address.py`, `report_page_speed_by_address.py` |
| Refresh, archive and search FCC political advertising evidence, restore source copies and review expense links | `fcc_political_files.py` |
| Maintain search and stored files | `archive_published_sources.py`, `collect_page_failure_health.py` (public-safe hourly failure counts), `build_rag_hnsw_index.py`, `mirror_raw_files.py`, `notify_changed_public_pages.py` (bounded real public changes with durable receipts) |
| Delete expired private search exports and verify the saved cleanup receipt | `prune_search_measurements.py` |
| Protect unfinished work and rotating read grants | `back-up-uncommitted-worktree-work.sh`, `worktree_backup.py`, `supabase_oauth_state.mjs` |
| Install free Mac maintenance, report every folder and safely remove released working folders | `install_worktree_maintenance.py`, `worktree_cleanup.py`, `worktree_inventory.py` |
| Decide whether our website host needs to rebuild | `vercel-ignore-build.sh` |
| Check fresh change explanations | `check_pr_descriptions.py` |
| Install shared Git hooks, format selected files, and test exact upload commits | `install_git_hooks.py`, `format_frontend.mjs`, `local_checks.py` |

Most of these commands use shared code in `alethical/pipeline/`. The queue in
`alethical/pipeline/oban.py` and `alethical/pipeline/oban_workers.py` can run an
explicitly queued import, summary, or search-index job. The queue does not create
work or approve spending on its own. An accepted official-text change records one
full-summary request in PostgreSQL. The request becomes runnable only after the
same text has complete search rows. The paid worker still refuses to run unless
its off switch, monthly ceiling, per-bill ceiling, failure limit, and total-try
limit are all positive. The switch is `false` and all 4 limits are `0` by
default, so the shipped settings cannot make a paid call.

The refund source-metadata helper reads and checks the saved published PDFs. It
adds their program-page address and printed counting note without changing a
refund, match or copy date. It previews by default and writes only with `--apply`.

The ZIP-reference builder reads a complete HUD workbook copied by a person and writes a
versioned ZIP-to-state table for review. It records the source quarter, copy date and
file hash. It neither downloads a file nor writes to a database, and has no schedule.

## Public-record deadlines and review holds

These intervals are targets for complete checks, not a promise that the state has
published new records. A failed run retains the previous source date and retries.
The API wakeup does not guarantee immediate availability of a GitHub runner.

| Source | Target interval | What can reach readers automatically |
| --- | --- | --- |
| Bills | Dated-action discovery every 5 minutes during sittings and every 15 minutes otherwise, today plus 2 days; a daily 14-day lookback; up to 25 bills per turn; full reconciliation every 4 hours during regular sittings and the 14 days after adjournment, 2 hours during special sittings, weekly otherwise | Both chamber action views feed finite saved passes; full inventory/status/text reconciliation covers undated actions and older same-address corrections; changed text and search commit together; summaries remain off |
| Votes and roster | Votes hourly; roster source discovery every 15 minutes and full refresh every 4 hours | Newly available rolls, bounded correction checks, complete rosters, contacts, service and committees; incomplete sources retain held data |
| Lobbying | Source discovery every 15 minutes; paired publication hourly | A checked registration/spending pair, with separate source dates and retryable saved-answer clearing |
| Campaign money | 6-list discovery every 15 minutes; payments daily; supported totals on list changes or weekly; checks in 10 committee-year / 120-second / 10-request turns | Checked source releases and corrected supported years; no 2015–2021 totals expansion |
| Filing dates | Recent dates hourly; full supported history daily in bounded turns | Dates supported by readable official reports; unavailable/scanned sources remain review findings |
| Large-contribution notices | Every 15 minutes in July, August, October and November; hourly otherwise; retained notice corrections weekly | Official new/corrected notices; unknown election calendars require review |
| Disclosure statements | Weekly | New catalogues and corrected PDFs; human-reviewed readings stay protected |
| FCC political files | Hourly enabled-family inventory; at most 1,000 downloads, 2,500 mirrors and 1,000 readings per turn | Existing 3-station collector; source gaps and unfinished bounded work retain their incomplete status |
| Refunds | Every 30 days | Rechecked official summaries using approved account links |
| Donor evidence | Daily preparation | Private evidence bundle only; no automatic donor-proof approval or publication |
| Session codes and candidate source changes | Session codes daily; candidate sources hourly | Review findings; unknown session/election mappings are not guessed |
| District map and HUD ZIP source changes | Map release discovery hourly; map contents and ZIP references daily | Review findings; approved geometry and ZIP references remain until reviewed replacement |
| Cited article sources | Existing weekly archive schedule | Retained source versions; repeated unavailable sources fail visibly |

`source_refresh_state` keeps next due time, ownership, progress and outcome;
`source_refresh_attempt` keeps run history. Collection and bounded money checks share
a writer lane; notices and cheap change checks run independently. Legislative
changes and votes share a lane because they update the same actions. A turn runs
each selected job once, then releases its lane. A continuation is not a complete collection.
Failed checks, review findings and copied source dates stay distinct.

The campaign-money, notices, vote and FCC timers stay active while their matching
family is off. The same GitHub family setting disables a legacy scheduled collector
and enables its replacement; manual repair paths remain. No family is active by
default. [Independent public-record wakeups](source-refresh-dispatch.md#staged-family-activation)
owns the setup, proof and rollback steps.
[Coverage and recovery](public-record-refresh-status.md#current-state) records the
6 enabled families and their automatic-run evidence.
The shared health warning closes only when the current source state is clear;
private evidence and exception text never enter its public issue. Setup failures
also produce a fixed warning. Existing backup work includes private evidence bundles.

[Independent public-record wakeups](source-refresh-dispatch.md) owns App scope and
activation. [Automatic public-record updates](../implementation/sitewide-record-refresh.md)
owns this release's evidence and remaining holds.

## What spends money

Job-driven AI spending has 5 possible triggers: a reader submits an Ask question,
a person starts AI work or an evaluation, a changed official bill requires its approved search-index update, an accepted official bill-text change
reaches a ready summary request while its separate spending gate is open, or a
campaign-money collection fails while the failed-collection reviewer's switch is
on. The last 2 are off by default. No clock-based job above opens either.

| Work | What starts it | Paid service | Cost shape |
| --- | --- | --- | --- |
| Sort an Ask question and, when needed, choose its bill (`alethical/api/services/ask_router.py`) | A reader submits a question | OpenAI text generation | Recurs with reader traffic; varies with the question and configured model |
| Find passages for an Ask question (`alethical/api/routers/me.py`) | A reader submits a question that needs bill retrieval | OpenAI embeddings | Recurs with reader traffic; a small call for each query |
| Write a cited Ask answer (`alethical/api/routers/me.py`) | A reader asks a question with enough source text to answer | OpenAI or Anthropic text generation | Recurs with reader traffic; varies with answer length and configured model |
| Write bill summaries, key points, questions, citations, and topic tags (`alethical/pipeline/anthropic_enrichment.py`, `ai_enrichment.py`, `bill_summary_requests.py`, `codex_enrichment.py`) | A person starts generation, or saved official text creates a ready request while all automatic-spending settings are open | Claude subscription, Anthropic API, OpenAI API, or Codex subscription, depending on the chosen path; the automatic request uses Anthropic API only | The older bulk run measured about $0.064 to $0.072 per bill, about $730 for 10,471 bills at list price or about $365 through the half-price batch path. Those figures do not approve the new automatic path; its per-bill and monthly limits must be measured and approved before its switch changes from `false` |
| Build or replace a bill's search index (`alethical/pipeline/rag_ingest.py`, `scripts/backfill_rag_bulk.py`, or a queued RAG worker) | A person starts or queues an ingest, or a checked official bill-text change reaches the scheduled refresh | OpenAI embeddings | About $0.001 per bill in the measured run, or about $10 for 10,500 bills |
| Run the private relationship search comparison (`scripts/graph_retrieval_eval.py`) | A person starts the command | Database export and comparison are read-only; only `embed --execute` makes 1 bounded OpenAI embedding request | Dry run by default; cached question vectors avoid repeat calls; no answer-writing call |
| Run AI answer or retrieval evaluations (`scripts/answer_eval.py`, `scripts/retrieval_eval.py`, `scripts/try_queries.py`) | A person starts the command | OpenAI, Anthropic, or Voyage APIs, depending on the mode | Varies by mode; cached results avoid paying again for unchanged work |
| Diagnose a failed campaign-money collection (`alethical/pipeline/collection_failure_review.py`) | A collection fails with new evidence while the switch below is on | Anthropic API, `claude-opus-5-5` | At most $0.44 a review and $8.80 a month; waiting for approval, below |

### The failed-collection reviewer: installed, enabled, waiting for approval

| Part | State |
| --- | --- |
| The review workflow, its issues, redaction, recovery and fallback alert | **Installed and on.** Runs on every completion of a watched collection |
| The AI reviewer's code and its limits | **Installed, switched off.** No call can be made |
| The limits, the key and the switch | **Waiting for explicit spending and activation approval** |

The worst case for 1 review is what its caps allow: 50,000 input tokens at $4 per
million ($0.20) plus 12,000 output tokens at $20 per million ($0.24), which is
**$0.44**. Prices are Claude Opus 5.5's, read from
[Anthropic's pricing page](https://platform.claude.com/docs/en/about-claude/pricing)
on 23 Sep 2026; thinking counts as output. A typical review should cost well under
the worst case, but no real review has run, so the table uses the caps.

| Distinct failures in a month | Reviews if each gets only its first | Worst case if each also changes twice | Worst-case cost |
| --- | --- | --- | --- |
| 2 | 2 ($0.88) | 6 | $2.64 |
| 10 | 10 ($4.40) | 30, cut to 20 | $8.80 |
| 30 | 30, cut to 20 | 90, cut to 20 | $8.80 |

A failure past the monthly limit still gets its issue and plain facts; it goes
without a diagnosis.

**Proposed limits, waiting for approval:** 1 review per incident per new piece of
evidence, 3 per incident, 20 a month, $0.44 at most a review, $8.80 at most a
month, and a $10 monthly spending limit on the API key's workspace in Anthropic's
console as the outer wall. All but the console limit are constants in
`alethical/pipeline/collection_failure_review.py`, and each review is counted at its
$0.44 worst case before it is bought, so a failed step can only overcount.

**To switch it on, once the limits are approved** (requires the account owner;
the coding task cannot create an API key or a secret):

1. In Anthropic's console, on the Alethical organisation's API account, create a
   workspace for this reviewer, set its monthly spending limit to $10, and create an
   API key in it.
2. In GitHub, open Settings, Environments, and open `collection-ai-review` (the
   workflow's first run creates it; create it if it is not there). Under deployment
   branches, allow `main` only. Add the key there as the environment secret
   `ANTHROPIC_API_KEY`, not as a repository secret, so a run on any other branch cannot
   reach it. The repository has no such secret.
3. In Settings, Secrets and variables, Actions, add the repository variable
   `COLLECTION_AI_REVIEW` with the value `enabled`. Deleting the variable, or setting it
   to anything else, switches the reviewer off at the next completion.

A Claude subscription cannot pay for this: an unattended GitHub job cannot hold a
person's login. The key's spend shows on the API account's usage page.

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

- [Working-folder cleanup and recovery](worktree-lifecycle.md) owns installation, owner release, removal safeguards, private backups and recovery.
- [Local code checks](local-code-checks.md) owns per-worktree hook setup, selected-file
  formatting, isolated upload tests, and the staged description-check activation.
- [Offline name-search comparison](name-search-offline-benchmark.md) explains the
  local-only commands, exact-answer checks and full-size measurement gates.
- [How Alethical calls OpenAI and Anthropic, and when it retries](../architecture/ai-provider-calls-and-retries.md):
  the official-library plan, attempt limits, honest failure state, issue split,
  effort, and remaining unknowns.
- [Deployment](deployment.md) explains Railway, Vercel, Supabase, release fallbacks,
  and the settings the live services need.
- [AI Models & Billing](../product-onboarding/ai-models-and-billing.md) explains which
  account pays for each AI path and how the measured costs were calculated.
- [`CONTRIBUTING.md`](../../CONTRIBUTING.md) § "Keeping the workflow actions current"
  explains why borrowed GitHub Action steps need periodic updates.
