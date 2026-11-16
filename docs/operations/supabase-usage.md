# Supabase outgoing data

<!-- describes: scripts/supabase_usage_report.py .github/workflows/supabase-usage.yml alethical/pipeline/record_refresh.py alethical/api/services/source_refresh_dispatch.py alethical/pipeline/campaign_finance_reader.py alethical/pipeline/campaign_finance_filings.py alethical/api/services/election_comparison_reads.py -->

Supabase charges for data sent out of its services (egress). The organization
shares its allowance across projects. Pro includes 250 decimal GB of uncached
egress; cached egress has a separate allowance. The operating target is below
7 GB/day, leaving room beneath a 250 GB cycle allowance. These are usage targets,
not an authorization to remove the spend cap or buy a larger plan.

[Supabase egress rules](https://supabase.com/docs/guides/platform/manage-your-usage/egress)
explain the meter and cycle reset. Rows, stored JSON sizes, compressed browser
responses and database timings are different measures. None proves billed bytes.
Consumed usage does not disappear after an optimization.

## Measurement

[Supabase database efficiency](../../.github/workflows/supabase-usage.yml) runs a
60-second read-only metadata sample daily, and can be run manually on main. It uses
the existing production database secrets. Every sampling transaction explicitly
sets and confirms read-only mode, limits statement time to 15 seconds and reads
only aggregate counters and progress sizes calculated inside the database. It
never returns progress bodies, raw SQL text, credentials or record contents; it
never resets counters. Query identifiers with their call and returned-row deltas
help locate the next expensive reader. New, evicted or reset query counters do not
become zero-byte measurements. A global counter reset invalidates the interval.
Artifacts last 30 days. Sampling failures fail the workflow; no success reading is
fabricated. This workflow invokes no AI or paid API; normal GitHub runner usage
and a small database read still use the account's existing resources.

The report explicitly says `missing_actual_usage_reading` for billing input.
No supported authenticated organization billed-egress API route was established
from the official Management API reference, and no management access token was
available to this build. Database credentials do not provide that meter. Daily
actual billing collection and automatic billing-budget alerts therefore remain
unavailable; query metadata is only a diagnostic substitute. Do not describe this
workflow as a billed-egress alert.

## Forecast from a dashboard reading

The offline script accepts a small JSON file copied or converted from the
organization usage dashboard. Keep the original reading privately beside the
input, and state its origin in `source`. It is not a parser for an undocumented
Supabase export format. Dates follow the dashboard's daily boundaries. Both
`cycle_end` and `measured_through` are exclusive: a reading through November 16
contains complete days ending November 15. Exclude the current partial day.
Numbers are whole bytes; multiply dashboard decimal GB by 1,000,000,000. Do not use
GiB conversion, incomplete project-only coverage, or sum cached into uncached.

```json
{
  "schema_version": 1,
  "organization": "example",
  "source": "Supabase organization usage dashboard, complete days",
  "cycle_start": "2026-10-29",
  "cycle_end": "2026-11-29",
  "measured_through": "2026-11-16",
  "uncached_egress_bytes": 108000000000,
  "cached_egress_bytes": 2000000000,
  "daily": [
    {"date": "2026-11-15", "uncached_egress_bytes": 5000000000}
  ]
}
```

This example is synthetic, not an Alethical meter reading.

```bash
uv run python scripts/supabase_usage_report.py /private/path/usage.json
```

The forecast adds remaining days at the trailing complete pace, using at most
7 consecutive supplied days ending at `measured_through`. If that final day is
missing, it uses cycle-to-date pace and says so. Missing days are unknown, never
zero. Old readings are marked stale; a closed cycle needs no additional days.
The output shows consumed allowance, remaining daily room, projected use and pace
basis. It does not predict an invoice, a grace period or future traffic. Forecasts
can change after a deployment or a traffic change.

Exit codes: `0` within the daily target and allowances, `1` over daily target or an
allowance/projected allowance, `2` invalid input or unavailable database probe,
`3` stale meter reading or a reset counter interval. Missing cached readings stay
unknown. Use `--today YYYY-MM-DD` only for replaying a historical reading, not to
hide stale production input.

## Changes and existing safeguards

| Approved work | Implementation or evidence |
| --- | --- |
| Smaller scheduler checks | Scheduling, claiming, finishing and dispatching defer collector progress; health reads only the clearing marker's needed failure date. A read-only JSON-size comparison found 3,975,523 bytes for full state rows against 37,774 without progress, about 99% smaller. This estimates row payload, not network savings. Collector progress remains available to the collector. |
| Smaller Finance release checks | Finance release checks select only the diagnostics readers need and reuse the release within a pinned transaction. Filer-specific reported totals use the existing scoped reader rather than loading statewide filings. |
| Reuse public answers | Existing public router cache policy requires browser revalidation, gives Cloudflare 5-minute dated-record reuse with background refresh, and publication clears saved pages. Private API responses stay `no-store`. |
| Compute and select less in the database | Election listing reads remove large source audit inventories in SQL before transfer. Totals and other scans should be changed only after returned-row evidence identifies waste. |
| Remove duplicate requests | Existing React Query client shares in-flight reads and keeps 5-minute freshness/30-minute unused retention. Current office and identity checks retain their selective revalidation. |
| Incremental collection | Bill collectors already save inventory and leases, resume bounded chunks and check inventory completeness. Egress work preserves this recovery and coverage. |
| File download reuse | Election source reads already use a byte-bounded, per-request store with concurrent single-key reuse and compressed/raw hash checks. Current availability is intentionally checked for each new request. Originals and bounded backup checks remain. |
| Expensive automated traffic | Existing 12-request database admission cap and sensitive endpoint limits remain. No measured abuse evidence justifies broader reader restrictions. |
| Prevent regressions | Focused tests prevent full progress downloads by control paths, oversized election list rows and unsafe Finance reuse. Forecast tests reject inconsistent, stale and missing-day input rather than reporting false savings. |
| Daily measurement | Daily database counter workflow plus offline actual-meter forecast. Automatic actual-meter collection remains unavailable as explained above. |

The owning code is `alethical/pipeline/record_refresh.py`,
`alethical/api/services/source_refresh_dispatch.py`,
`alethical/pipeline/campaign_finance_reader.py`,
`alethical/api/services/election_comparison_reads.py`,
`alethical/api/routers/public.py`, `alethical/api/main.py`,
`alethical/api/request_admission.py`,
`alethical/api/services/election_source_io.py`,
`alethical/api/services/election_analytics.py`,
`apps/frontend/src/lib/appQueryClient.ts`, `scripts/run_scheduled_bill_refresh.py`
and `alethical/pipeline/cache_purge.py`. Keep publication freshness, access
boundaries, original source files, backup checks and complete collection intact.

Build status belongs in the pull request and release evidence, not this table.
A lower call count or smaller SQL row is not proof that organization usage is
below its allowance. Compare complete daily meter readings after release and
rank further changes by measured bytes, reader benefit and maintenance cost.
