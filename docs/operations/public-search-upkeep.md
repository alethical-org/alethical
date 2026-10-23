# Public search upkeep

<!-- describes: scripts/check_public_search_health.py, .github/workflows/public-search-health.yml, scripts/report_page_speed_by_address.py, scripts/notify_changed_public_pages.py, .github/workflows/public-change-notices.yml, scripts/collect_page_failure_health.py, scripts/check_page_failure_coverage.py, .github/workflows/page-failure-health.yml -->
<!-- describes: api/traffic-google.ts, api/traffic-bing.ts, api/_lib/searchMeasurement.ts, api/search-measurements.ts, alethical/api/routers/search_measurements.py, alethical/api/services/search_measurements.py, alethical/db/search_measurements.py, alethical/alembic/versions/0071_private_search_measurements.py, scripts/prune_search_measurements.py, .github/workflows/private-search-retention.yml -->
<!-- describes: api/traffic-referrals.ts, scripts/check_site_metrics_privacy.py, .github/workflows/site-metrics-health.yml -->

## Outcome and limits

Keep public pages easy to discover and useful to read, without weakening source
accuracy, privacy or the approved website. Mobile checks cover mobile browsers
including Safari on iPhone and Chrome on Android, not native apps.

A correct response or sitemap proves that an address is available for discovery.
It does not prove that Google, Bing or another provider indexed or ranked it.
The providers decide that. Their reports lag, use different coverage populations
and sometimes show rounded counts. Record the property, report update date,
filter, denominator and sampling scope beside every provider figure.

[Page metadata decisions](../architecture/page-metadata-for-search-and-sharing-decisions.md)
own first-response content, canonical addresses, descriptions and exclusions.
[Reader completion checks](reader-completion-checks.md) own live release proof.
[Jobs and scripts](jobs-and-scripts.md) own triggers, inventory and running costs.

## Ranked work

| Priority | Work | Completion condition |
| --- | --- | --- |
| 1 | Deliver existing public candidate facts and legal text before the website program loads; include `/candidates` in discovery | Useful initial text, accurate sources and missing/unavailable/private responses, focused tests and desktop/mobile-browser checks |
| 2 | Repair demonstrated provider discovery gaps and notify actual public changes | Bing receipts for missing sitemap sections; truthful bounded IndexNow notices with durable state |
| 3 | Prevent technical regressions | Daily and release checks, broader weekly rotating sample, retained failure evidence |
| 4 | Improve existing explanations and search descriptions where query evidence shows a real gap | Source-backed useful edits that preserve the approved subject and first-summary-sentence rule; compare results after provider lag |
| 5 | Seek useful Minnesota citations | 3 private researched drafts; external sends remain separately authorized, no paid listings, link trades or bulk outreach |
| 6 | Repair demonstrated reader delays | Existing private aggregate speed data plus browser timing; retain measurement floor and avoid speculative rewrites |

## Daily and after releases: automatic, free checks

The **Public search health** workflow runs at 17:17 UTC and after successful
trusted-main **Reader completion checks**. It reads robots instructions, the
7 required sitemap children and the optional video child when published, important
public destinations and a bounded record sample. Video URLs may also appear in a
primary sitemap; duplicate addresses across primary children remain invalid.
It requires meaningful initial text, correct preferred addresses and indexing
instructions; missing records and private views keep their deliberate treatment.
Failures retain a JSON artifact for 35 days. Public response reads make no AI
calls and use no credentials. Daily and manually started runs also use GitHub's
read-only workflow token to inspect the hourly failure collector's coverage. This creates no daily
issue or message for a person to review.
GitHub's normal failed-run notification is the fallback for a broken technical check.

Record query variants have a separate, strict check path. Discovery still rejects
record queries; passing a variant never admits it to a sitemap. The variant checks
require useful initial content, an indexable 200 response and exactly 1 preferred
address pointing to the base record. Known saved-data keys and payload years must
match the requested record and year. Optional legislator/payment data that the page
server omitted is recorded as `not-served`, not proof of correct year or direction.

The initial-page sample keeps fixed destinations and fills at most 60 slots across
page families in rotating order. Additional families reduce the sample per family
rather than exceeding the limit or aborting the remaining checks.

At most 9 daily or 14 Monday variant reads share the existing 160-request,
300-second and 4 MiB-per-response limits. Committee, payment, legislator, race and
bill-text views rotate weekly. Race variants use the current year, matching their
sitemap inventory; older years need not contain the same seats. A failed variant
selection is retained as a failed check without skipping missing/private checks.
The 4 fixed October incident examples remain until Google's corresponding error
validation passes; remove that temporary list in a reviewed change, retaining the
rotating coverage and offline regression tests.

A release remains incomplete until its intended commit has reached the public
website and changed reader paths work. The search check records the served commit
but deliberately does not replace the release ancestry checks.

## Hourly: retain temporary failure evidence

The **Page failure health** workflow reads the previous 12 completed UTC hours of
production serverless 5xx records through the pinned official Vercel CLI at
43 minutes past each hour. It runs
on trusted `main`, never pull-request code. The existing Vercel access key is
available only to the read step; package installation has no key and disables
package install scripts. No new service or paid AI call is introduced.

Public page routes use the page server function; sitemap routes use the sitemap
server function. Static asset failures are outside this page-response collection.
A Vercel network failure before a request reaches a function may leave no runtime
record, even without the source filter. Public response checks cover a bounded
sample independently; neither source proves that every visitor request succeeded.

Raw log records remain bounded in memory. Saved artifacts are treated as public:
only fixed category labels, numeric status, timing buckets, minute-level counts
and collection limits survive. No visitor text, paths, record identifiers, source
bodies or credentials are retained. Records are deduplicated within each fixed
hour. A 100-row limit reports saturation instead of claiming complete coverage.
Artifacts remain available for 35 days.

The same run separately requests only successful responses containing the fixed
`page_read_recovery` marker. The provider filters this query; the collector does
not read every successful request. Each query has its own 100-row and 4 MiB cap,
75-second command limit and at most 2 attempts across the whole 12-hour read.
The collector bins those records into 12 strict hourly reports inside 1 bundle.
The single-hour command default remains available for existing manual callers.
Schema 2 keeps recovery collection
status independent from failure collection. Counts distinguish the original read
winning from the backup winning, plus the trigger and timing bucket. An original
winner is not proof that the backup rescued a page. A recovered data read on a page
that later failed is outside this successful-page query. Malformed matching records
remain unclassified, never counted as recoveries. Historical schema 1 artifacts
remain readable and are reported as failure-only hours, not recovery coverage.

A transient collection failure is tried once more and then recorded as a failed
collection, without creating an hourly failed-run email. Authentication or format
failures stop visibly. Scheduled and manually started public-search runs check
24 eligible hourly windows, leaving the newest completed hour time to arrive. The fixed
24-hour startup period begins at workflow creation; afterward, 3 missing or
failed hours fail the daily check. A failed or unclassified recovery collection
also makes that hour incomplete. Any saturated query fails the daily check,
including during startup. A green hourly workflow alone does not prove that
collection succeeded. Gaps remain explicit rather than interpreted as no errors.
GitHub metadata dates may include fractional seconds and timezone offsets; the
reader validates and normalizes them separately from the strict whole-second UTC
format of saved reports. Invalid provider dates retain a fixed error without raw
provider text. Queued or in-progress runs missing dates cannot supply coverage and
do not hide older completed evidence. Setup crossing an hour boundary does not
change which hour is counted: the validated report supplies the hour, bounded by
the trusted run's bounded lookback and end. Bundles may contain at most 12
completed hours before the run starts, and no future hours. Every enclosed report
is validated, including hours outside the eligible day; a complete read takes
priority over a failed duplicate. Coverage allows at most 24 artifact downloads,
100 total requests and 180 seconds. Redirects count as requests; listing headroom
covers duplicate and unfinished runs without weakening saved-report validation.
GitHub can delay or drop scheduled runs. The 12-hour overlapping read catches
hours missed by the observed 6-to-8-hour delays. Longer delays, provider retention,
failed reads or global row caps can still leave gaps. A global cap marks every
hour in that read saturated. Vercel Pro retains runtime logs for 1 day; retention
does not guarantee complete reads or timely runs.
The daily check tolerates 1 or 2 missing or failed hours, but never saturation.
This is evidence collection, not automatic proof of a cause or permission to
change cache, timeout, deployment or data behavior without diagnosis.

## Weekly: broader technical coverage and provider evidence

Every Monday the automatic search-health run samples more records across all
sitemap families, with deterministic rotation. This covers more of the inventory
without requesting every record every day.

A human or an explicitly started coding task reviews Google Search Console and
Bing Webmaster Tools once weekly while a coverage repair is being evaluated.
Compare indexed, discovered-not-indexed, crawled-not-indexed, soft-404 and server
failure trends. Inspect a few new or changed examples from affected families.
Read **All known pages** as well as **All submitted pages**, and keep their counts
separate. The latter excludes many query variants and old addresses; a clean
submitted-pages report does not establish that Google saw no sitewide errors.
For a historical soft-404 whose public response is now useful, run the provider's
live inspection and compare its rendered content with the current response.
Do not invent extra text to satisfy an arbitrary minimum word count.
Start validation once a demonstrated cause is repaired, or after affected examples
and representative Google live tests pass with no evidence of an ongoing failure.
When historical logs cannot establish the cause, state that explicitly. Do not
restart validation daily,
repeatedly submit unchanged addresses, or treat a successful live test as indexing.
A reported failure with no current response defect remains a provider follow-up,
not permission for unrelated data regeneration.

## Monthly: relevance, clicks, citations and speed

Compare equal complete windows from the same source, noting source lag, release
dates, observed recrawl, seasonality and small counts. The existing Google totals
reader defaults to 2 complete 28-day windows; `window=30` selects 2 complete
30-day windows. The private collector below requests a rolling 30-day Google
detail window. Its monthly report chooses the latest successful pull in each
month, not a calendar-month total. Do not compare those figures with 28-day
totals, sum overlapping pulls, combine query and page views, or treat top-row
detail totals as the whole property's traffic. A missing or unverified date
window, including Bing's current detail export, remains incomparable until the
source establishes matching periods.

Keep query and destination details private. Record impressions, clicks,
click-through rate and average position with the source's filters and coverage.
A low click count
at a low position does not by itself demonstrate misleading page wording.
Prioritize queries that match the website's real records and explanations.
Improve an existing useful page before creating another page for the same question.
Keep dates, coverage limits, official citations and AI disclosures; do not fabricate
research, keywords, schema fields, reviews or claims of complete coverage.

Review the 3 researched Minnesota resource destinations privately. Update their
published contact routes and check the proposed public resource still fits.
No outreach, form submission, link exchange or paid listing is armed automatically.

Use `scripts/report_page_speed_by_address.py --days 28 --json` with existing
read-only Cloudflare settings. Compare actual reader document loads and in-page
clicks separately from automated clients, by public address family. Fewer than
50 observations means insufficient evidence, not a zero speed score. Trace a
slow reader path before changing code. Browser layout and keyboard checks remain
part of any affected website release.

Weekly/monthly provider, content and citation judgment is an operating cadence,
not a recurring AI task. No token-consuming automation or paid service loop is
created by this work. [Technology health](technology-health.md) retains its
existing monthly tools/security check and [published piece link checks](../../.github/workflows/published-piece-links.yml)
retain their existing free weekly source checks.

## Private search measurement: implementation ready, live checks pending

The private export, storage, report and independent deletion paths are implemented.
Production access, included service capacity, successful collection and deletion,
and denied unauthorized reads still need the rollout checks below. The weekly
Vercel collection schedule is **not armed**. The daily deletion workflow has a
schedule in source; that alone does not prove a successful live sweep.

### Collection and access

The existing administrator-only readers at `/api/traffic-google` and
`/api/traffic-bing` retain their normal totals responses. An explicit `view`
request reads query or page detail; Google also supports `query-pages`.
`days` accepts 1 through 90, with 7 as the manual export default. The existing
administrator check runs before provider access. Responses are private and
uncached; exporting details does not create a public report or screen.

Google exchanges Vercel's short-lived identity for a read-only Google token inside
Vercel. The identity is not copied into GitHub secrets or moved to the backend.
Google detail reads use finalized data, Pacific dates and a recorded cutoff basis:
the provider's first incomplete date, or a conservative 3-day delay when that
metadata is absent. Missing date rows, withheld queries and top-row limits remain
explicit. Pagination stops after 4 pages of 1,000 rows. A repeated page or invalid
response fails the export instead of producing plausible totals.

Bing's existing key stays in the Vercel runtime. Its documented query and page
methods return top rows, update weekly, and offer no date-range or pagination
parameter. The export records requested days as unapplied and retains the
provider's date separately from its UTC interpretation. Complete-day coverage,
timezone and final-data cutoff remain unknown. The reader does not fan out into
unbounded per-query or per-page requests.

Provider responses and complete exports are each limited to 2,000,000 bytes and
4,000 retained rows. Each provider request times out after 5 seconds; each Google
export has a 25-second overall limit. A failed pull is unavailable, never zero.

The collection function at `/api/search-measurements` is production-only and uses
its own server-held `CRON_SECRET`. It calls the shared provider readers directly,
without a browser session, and requests a rolling 30-day window for 3 Google
views and 2 Bing views. A separate `SEARCH_MEASUREMENT_WRITE_TOKEN` authorizes only
the backend's `/internal/v1/search-measurements` write route. Both credentials must
be distinct and at least 32 characters. They are never accepted from query strings
or returned in a response. The function sends data only to the fixed production
backend address and does not follow redirects with credentials or rows.
The Node function's 180-second maximum is set in `vercel.json`.

The backend validates bounded bodies and records each source/view independently.
Retries cannot let older data replace newer data. A failure receipt contains no
provider payload and does not replace the last successful export. Administrator
tokens do not grant machine-write access; the write token does not grant read
access. The existing administrator guard protects both report and raw-export
reads. No anonymous or ordinary signed-in reader is given access.

### Storage, retention and reports

Raw search phrases, query-page pairs, provider metadata and private inquiry or
audit material never enter the repository, public issues, job artifacts or logs.
Search exports live in the dedicated `search_measurement_private` database schema.
Its tables have row-level security enabled, no public read policies, and no
PUBLIC, anonymous or ordinary authenticated-role privileges. The production
backend database role must be verified before activating writes. No public
Supabase data route is used.

Raw exports stop being readable after 90 days. An independent daily workflow,
[Delete expired private search data](../../.github/workflows/private-search-retention.yml),
runs at 08:23 UTC using existing production database access. It deletes expired
raw payloads and safe summaries older than 13 calendar months. It needs neither
Google/Bing credentials nor a working collector. Normal deletion can follow
expiry by up to 1 day; scheduler or database failure can extend that delay and
must remain visible. This is not a claim about deletion from provider backups.

The cleanup and its success receipt commit together. The command then reads the
receipt in a separate transaction and fails if the sweep cannot be verified.
The private report exposes the last successful sweep, deletion counts, expired
records still awaiting deletion, and missing, stale or overdue cleanup. A sweep
older than 36 hours is stale even if no expired records remain. GitHub's failed-run
status exposes command failure. A working collector alone does not prove cleanup
is healthy.

Administrators read the deterministic report at
`/api/v1/admin/search-measurements`. It contains safe counts, actual measured dates,
coverage limits, latest attempt status and the latest successful pull per month.
It never selects raw phrases, destinations, property identifiers or provider error
text. Reports are private even though their selected fields may support an
approved public summary. Public reporting requires a deliberate safe summary;
no job publishes these reports automatically. Latest successful raw exports are
separate, administrator-only reads under the same address with provider and view
segments, and expire independently of the retained summary.

Crawler counts remain **missing** until a verified Vercel source establishes
coverage of public-page requests. The existing bounded 5xx and recovery-log
collector cannot stand in for all crawler traffic. Cloudflare serves the data
service; its zone request counts do not count visits to Vercel bill pages. Browser
beacons also cannot count a crawler that runs no JavaScript. No new tracking or
paid logging is introduced to fill this gap.

The separate administrator-only `/api/traffic-referrals` read supports the monthly
review without adding an admin screen or scheduled AI work. Its account-specific
Cloudflare schema, dataset access and exact query have been verified; deployment
and live access checks remain. It reads 30 complete UTC days for
`www.alethical.com`, excluding requests Cloudflare marks as likely bots. It groups
only by these exact referring hosts: `chatgpt.com`, `chat.openai.com`,
`perplexity.ai`, `www.perplexity.ai`, `claude.ai`, `gemini.google.com` and
`copilot.microsoft.com`. Generic Google and Bing hosts cannot distinguish AI
referrals from ordinary search and are excluded.

The query returns estimated page views, estimated external-entry page views and
average sampling interval for each returned host. These are browser-beacon
observations, not people, sessions or crawlers. No referring path, query text,
visitor identifier or unknown host is requested. The read has a 5-second timeout,
64 KiB response cap and at most 7 groups. Malformed counts, sampling information,
duplicate or unexpected hosts fail with fixed private wording.

Missing host groups return null metrics and `no-observations-returned`, never an
invented zero. Sitewide source coverage is not measured by this bounded read.
Blocked beacons, missing referrers, provider storage limits and sampling leave
gaps; a successful empty response cannot establish that no AI visit occurred.
Missing referrers remain unassigned. No pages-per-visit success claim follows.
The existing daily signed-out access check includes this read, query/page export
variants, the collection trigger and stored search reports and exports. It sends
no credentials, saves no response bodies and accepts only explicit access denial.

### Rollout and acceptance

1. Verify existing Vercel function/scheduler allowance and database capacity.
   At the maximum export size, 5 exports × 2 MB × about 13 weekly pulls is about
   130 MB of raw payload before database and index overhead. Measure actual size;
   do not treat an unknown allowance as free capacity. No paid AI or new paid
   service is part of this path.
2. Apply the additive private-storage migration and deploy the backend before
   enabling the collector. Verify schema ownership, denied public/ordinary-user
   reads, and that the machine token cannot read administrator reports.
3. Configure the distinct production-only collection and writer credentials
   through existing service settings. Preserve the existing Google identity and
   Bing key. Do not place credentials or raw responses in a terminal transcript.
4. Run one production collection and verify saved successful data through an
   administrator read. Confirm fixed error responses, private cache headers,
   failed-run preservation, actual row/byte limits and date coverage. Record
   safe receipts separately from the private data.
5. Run the independent deletion workflow and verify its committed success receipt
   in the private report. Confirm the daily schedule is active. A workflow file
   or access-expiry filter alone does not satisfy retention acceptance.
6. Arm the weekly Vercel collection schedule only after these checks pass within
   existing included capacity. Record its actual cadence and first successful
   run. The report remains available on demand; no recurring AI summary or paid
   citation check is started. Monthly review follows the comparison rules above.

Primary API contracts: [Google Search Analytics](https://developers.google.com/webmaster-tools/v1/searchanalytics/query),
[Bing query statistics](https://learn.microsoft.com/en-us/dotnet/api/microsoft.bing.webmaster.api.interfaces.iwebmasterapi.getquerystats?view=bing-webmaster-dotnet)
and [Bing page statistics](https://learn.microsoft.com/en-us/dotnet/api/microsoft.bing.webmaster.api.interfaces.iwebmasterapi.getpagestats?view=bing-webmaster-dotnet).

## Search providers and automatic change notices

Serve the same useful public content to people and search crawlers. Keep public
search bots crawlable; preserve intentional training-bot exclusions and private
`noindex` views. Google uses the existing sitemap and crawlable links. Bing's
submitted child sitemaps are a discovery repair, not evidence of indexed pages.

[IndexNow](https://www.indexnow.org/documentation) permits notices for changed
public addresses. Notify only newly added or removed inventory entries and entries
whose valid source-backed `lastmod` advances. Seed the first baseline without
submitting the existing inventory. Do not manufacture daily modification dates.
A durable trusted-main state tracks the inventory and unaccepted pending notices;
missing/corrupt state fails closed rather than silently resetting and losing changes.
The public verification text file is a protocol ownership proof, not a secret.
HTTP 200 is receipt and 202 means key validation is pending. Neither proves indexing.

The **Public changed-page notices** workflow follows a successful trusted-main
search-health run, or an explicit hand run on `main`. It uses only GitHub's
short-lived workflow token and the public ownership key. Initialize once with
`gh workflow run public-change-notices.yml --ref main -f initialize=true`.
The first run sends 0 existing addresses. Later runs fail closed on a missing,
corrupt or unsafe state rather than treating the inventory as new.

Saved inventory and pending receipts live in `state.json` on the fixed
`codex/indexnow-state` branch. Its only companion is a fixed `vercel.json` with
`git.deploymentEnabled: false`, so saving search state cannot launch website
previews. The tool requires that protection before any baseline read or update.
It changes no `main` files and compares GitHub's saved-file identity before writes.
Pending changes are saved before any provider notice, and attempts are saved
before sending. A crash can repeat a bounded notice; it cannot silently erase an
unaccepted change. Reports are kept for 35 days, including failure receipts.

Each run allows at most 100 notices, 160 public reads and 300 seconds of public
checking, with bounded response and saved-state sizes. The selection cursor
rotates past unavailable entries so one broken address cannot hold every later
notice. Newly added or modified entries need a useful, indexable 200 response
with their own preferred address; removed entries need a real 404 or 410.
Redirects and outages do not count as removals. A 429 provider reply preserves
the queue and honors a valid `Retry-After` date or number of seconds from receipt;
other unaccepted notices remain queued with the normal retry pause.

This inventory-based tool cannot detect body edits on fixed pages without
`lastmod`, a backward source date, or an address removed into a redirect. Those
need a real release/change event or deliberate reviewed notice, not a made-up
modification date. Technical checks and weekly provider inspections cover these
remaining limits. Initialization must not be used as a bulk re-submission route.

Google's [AI search guidance](https://developers.google.com/search/docs/appearance/ai-features)
uses the same foundational public search requirements. No special AI-only page,
search markup or duplicated keyword material is required. The normal website,
accurate readable content, useful links and supported structured data remain the
shared foundation. Other engines have their own crawl/index decisions; do not
promise full coverage from Bing's receipts alone.
