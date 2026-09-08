# How the Site metrics page works

<!-- describes: alethical/api/services/account_classification.py, alethical/api/services/account_signup_metrics.py, alethical/api/services/site_metric_history.py, alethical/api/services/leadership_metrics.py, alethical/api/routers/admin.py, alethical/api/routers/site_metric_accounts.py, alethical/api/routers/leadership_metrics.py, apps/frontend/src/screens/redesign/AdminSiteMetricsScreen.tsx, apps/frontend/src/lib/leadershipMetrics.ts, apps/frontend/src/lib/siteMetricPrivacy.ts, apps/frontend/src/hooks/useSearchMetric.ts -->

<!-- describes: api/traffic.ts, api/traffic-google.ts, api/traffic-bing.ts, api/traffic-uptime.ts, api/traffic-performance.ts, api/traffic-collection.ts, alethical/api/routers/site_metrics.py, alethical/db/models.py, alethical/alembic/versions/0038_site_metric_event.py, apps/frontend/src/components/TrafficAnalytics.tsx, apps/frontend/src/components/TrafficAnalytics.web.tsx, apps/frontend/src/lib/traffic.ts, apps/frontend/src/lib/siteMetricEvents.ts, apps/frontend/src/screens/TrafficScreen.tsx, apps/frontend/public/index.html, apps/frontend/scripts/check-traffic-production-env.mjs, apps/frontend/scripts/traffic-token-expiry.mjs, .github/workflows/traffic-token-expiry.yml, scripts/report_page_speed_by_address.py, apps/frontend/scripts/report-page-load-beacons.mjs -->

The public `/site-metrics` page combines 7 independent sources:

- Vercel Web Analytics shows estimated visitors, page views, destinations, and profile breadth for 24 hours, 7 days, or 30 days;
- Alethical's own records show recorded actions, first signed-in use, and bill and committee follows;
- Supabase shows surviving accounts created, including confirmed and pending sign-ups;
- Google Search Console shows sitewide appearances and clicks for 30 finalized days;
- Bing Webmaster Tools shows the same 2 sitewide search totals;
- Checkly shows 30-day availability for the home page and data service; and
- Cloudflare Web Analytics shows 30-day page-speed scores from real Chromium visits.

The public totals are the same for signed-in and signed-out readers. The About menu links
to `/site-metrics`. Private vendor dashboard links are not shown, including to signed-in
team and test accounts. The separate public Checkly availability link remains. Team/test
classification does not grant access to `/admin/metrics`.

Each source has its own server route and page state. A Google problem hides only Google.
A Checkly problem cannot erase Vercel visits. The browser keeps the last good answer from
each source when a later refresh fails. Vercel's delivery network also keeps the last valid
Vercel traffic answer available for up to 24 hours when that source temporarily fails, so a
reload does not immediately replace working traffic totals with an unavailable message.

## Collection dates

The bottom section, Data collection dates, names what each date covers and uses UTC. It
remains visible after 30 days. The recent-traffic cards keep freshness and the visitor
explanation, not a separate collecting-since sentence. Action rows keep Partial range
markers; their start-date explanation now lives in this bottom section.

- Site visits and page views use Vercel's configured counting start, currently August 15,
  2026. This includes historical Money page views, not just views since Money rows appeared.
- The original bill/legislator search, Find My Legislator, and source-click collectors were
  enabled August 15, 2026 ([release](https://github.com/alethical-org/alethical/pull/1610)).
  Their counting rules changed September 8, 2026; older totals may use older rules.
- Money searches and new bill/committee-follow history were enabled September 8, 2026 UTC
  ([release](https://github.com/alethical-org/alethical/pull/2027)). Those dates describe
  production activation, not the first event. No earlier action history is invented.
- Account creation uses saved sign-up dates, including earlier accounts. Current account
  and follow counts are present records, not a historical collection window.
- Homepage and data-service monitoring start dates come separately from Checkly metadata.
  They do not prove uninterrupted coverage. A missing date stays unavailable.
- Google, Bing, and Cloudflare expose reporting windows, not collection-start metadata.
  Their reporting dates remain with their measurements and are not relabeled as start dates.

The Cloudflare source and reporting dates are the last line in its card, below scope,
measurement-change, sample-size, and stale-data notes.
On phone and tablet widths below 1100 pixels, speed ratings sit below their values so
the full Building sample message fits. Tablet value type stays at 18 pixels; phone type
stays at 17 pixels. Wider desktop cards keep the rating beside the value.

## Activity layout

Where people go uses the same row spacing for Bills, Legislators and Money: 12 pixels
inside each group, with a 2-pixel left border and 12 pixels of inner padding. Standalone
destinations have 14 pixels of left padding and no border. Groups and standalone rows are
15 pixels apart on computer and 11 pixels apart on phone. Shared label widths are
170 pixels on computer and 159 pixels on phone, measured with the published Libre Franklin
font. A new label requires remeasuring those widths. If the phone card cannot leave at
least 80 pixels for each bar, every row places its label above its bar and percentage.

At widths of 768 pixels and above, each activity-card pair shares its taller card's height.
Content stays at the top and spare space stays below the final note. Below 768 pixels,
cards stack and use their own heights. Action counts align with their labels and share
the right edge; Partial range occupies a separate right-aligned line below, with a
4-pixel gap before the note. Counts, wording and coverage states are unchanged.

## What the numbers mean

A page view is 1 page load. Opening several pages creates several views. Opening or
reloading `/site-metrics` creates a view too. Refreshing only the numbers does not.

Vercel counts without an analytics cookie and removes traffic it identifies as automated.
Destination percentages are shares of page views, not people. Every Vercel query explicitly
selects the production environment. This prevents preview visits from entering the report;
it is not evidence that earlier totals included preview visits. Destination totals come from
separate category queries, not just the first 100 paths. Profile breadth adds `+` when Vercel returns its maximum 100 paths, since that does not
prove the list is complete. Alias grouping can leave fewer than 100 distinct committees
in that capped list; the printed count is then still a lower bound.

The money destinations separate these exact addresses: `/money` (Money home),
`/money/search` (Money search), `/money/races` (Money by race), `/money/committees` (Committee
list), `/money/payments` (Payments by name), and `/money/outside-spending` (Outside spending).
Committee money pages include `/money/committees/*`, covering profiles and their payments
pages. Other money pages is the remaining `/money` traffic after these non-overlapping
groups. The main `/money` row is not also a subtotal of those rows.

Money committees in What people explore counts committee profile and payment-page views.
Distinct committee counts combine address aliases with the same trailing registration
number. A capped distinct count is a lower bound, not a complete inventory. Legislator
money tabs share a legislator address; removing query text means Vercel cannot distinguish
those tabs from other legislator-page visits. Money totals therefore do not capture every
financial-information view. Ask remains a visible destination for the existing `/ask` route.

Vercel's periods trail backward from the most recent completed UTC hour. The page shows that
ending hour in Minnesota's time zone, labeled `CT`. The 3 windows contain 24, 168, and 720
complete hours. Recorded actions and surviving-account creation use 7-day and 30-day windows
ending at the last complete UTC hour, with equally long preceding windows. Current account
and follow inventories are counts at the time read, not creations in that range. Cloudflare
uses 30 complete UTC days; Google and Bing have their own finalized day windows; Checkly
reports its own rolling 30-day availability. Source date labels must stay separate.

## Privacy boundary

The browser removes everything after `?` or `#` before sending a page address to Vercel.
Alethical stores 5 fixed action names: a bill search with results, a legislator search with
results, a money search with results, a successful Find My Legislator lookup, and an official
Minnesota source link opened. Each event row has only that fixed name and its time. It has
no search words, page paths, addresses, districts, account identifiers, or referrers. A request
may also carry a random per-action UUID retry key, stored separately to prevent duplicate
delivery from adding another action. The key does not identify a visitor or link visits.

Analytics waits until sign-in is resolved. The browser sends the current bearer sign-in token
to `GET /api/v1/site-metrics/collection`, not a user identifier in a request body. The server
checks the shared team-and-test classification. The browser applies that answer only to the
exact account and token that requested it, and checks permission before each Vercel event
leaves. An account or token change invalidates previous permission immediately. An unresolved
identity or failed permission check keeps signed-in Vercel collection off. Vercel never
receives the account identifier. `/admin` and its child addresses are excluded from Vercel
page-use and anonymous action collection at event time. The older `/api/traffic-collection`
route returns a private, fixed 410 response. It never reads a caller-supplied account
identifier or reveals exclusion-list membership; older clients must reload.

Google and Bing return only combined 30-day appearances and clicks. The public routes do
not request or return search phrases, page addresses, countries, devices, or positions.
Google uses a read-only machine account that is separate from a reader's Google sign-in.

Checkly opens public Alethical addresses, not reader accounts. Cloudflare receives
page-speed measurements, page paths without the question text after `?`, referrers, broad
place and browser facts, and some element or resource details. Alethical publishes none of
those details. It publishes only sitewide speed scores after at least 50 actual measurements
for each score. These cover document loads, including reloads and restored pages, with known
bots excluded. Account exclusions do not apply to Cloudflare; team visits may remain. This
is not a claim that all automated visits can be identified.
Cloudflare Web Analytics uses no cookies, local storage, or fingerprinting.

The shared backend classifier recognizes 6 known team mailboxes, their supported aliases,
configured account identifiers, and test mail domains. Aliases include plus tags and Gmail
dot and googlemail variations. Excluding 1 linked identity excludes the whole linked account.
The 6-mailbox exclusion list is broader than the 4 exact administrator mailboxes. Neither
an alias nor exclusion status grants administrator access. `TRAFFIC_EXCLUDED_ACCOUNT_IDS`,
`ALETHICAL_TEST_ACCOUNT_IDS`, and `ALETHICAL_ADMIN_ACCOUNT_IDS` also contribute to exclusions.
Current reader and follow inventories can be recalculated when classification changes.
Anonymous history cannot be traced back to remove an account's earlier activity.

## Accounts and recorded history

Accounts created comes from surviving Supabase sign-up records, including pending email
confirmation. Deleted, deactivated, banned, anonymous, team, and test accounts are excluded.
Linked sign-in records count as 1 account, dated by their earliest included creation record.
Deleted accounts are not included, so past creation totals can decrease. This is not a
lifetime total of every sign-up attempt.

Accounts first used counts first signed-in use, not sign-ups. First signed-in use and newly
created bill and committee follows add anonymous hourly counts in the same transaction as
the new record. Repeated saves and adding another sign-in method do not add a new creation.
Unfollowing or closing an account changes the current inventory, not these anonymous counts.
Re-following after removal creates a new follow record and can add another creation.
Money activity includes successful money searches, new committee follows, and official
source clicks, including Campaign Finance Board links. Current committee-follow totals,
distinct followed committees, and readers following committees describe current records,
not past creations. No action records store payment amounts or individual interests.

Each action and creation measure has its own recording start and coverage flags. Older
history is not invented from surviving rows. No newly introduced history says `Not recorded yet`; a partly
covered current window says `Partial range`. An incomplete previous window is unavailable,
not `0`. A fully covered window with no matching records is a real zero. These separate
populations do not establish conversion, retention, revenue, or cross-visit behavior.
The original 4 action totals retain existing rows. Their coverage date marks tracking
of the current counting rules, not the first historical action; earlier rows can use older
rules and cannot be selectively corrected. Both public and private readers must be able
to distinguish incomplete measurement history from a complete zero.

Search actions count settled results for the current search, not stale placeholder results.
Legislator results must remain after the displayed chamber and party filters. The same
normalized query and filter combination counts at most once while that search screen remains
mounted. A new filter combination with results can count again; reopening the screen can
count again. These are recorded successful search states, not unique people.

## Public and private routes

`/api/traffic` reads Vercel page views. The Vercel access token stays on the server.
Vercel's traffic service rejected a project-only key. The working key covers the
Alethical team and all its Vercel projects. That team currently contains only
`alethical-web`. The route uses the key only to read traffic totals. It splits 30 days into
5 requests because Vercel allows no more than 168 hourly rows per request. It checks that
every returned hour and page-view count is valid. A successful empty period is a real zero.
The route returns only the approved combined totals and breakdowns, the fetch time, the end
of the last complete hour, the counting start time, and whether team exclusion is configured.
A valid zero is shown as `0`. A missing or invalid answer is shown as unavailable, never as
zero.

`GET /api/v1/site-metrics/collection` requires a valid bearer token and returns only
`collect`, `teamAccount`, and `teamExclusionConfigured`. The response is private and not cached.
Here `teamAccount` means team-or-test exclusion, not administrator access.

`/api/v1/site-metrics/events` accepts only the 5 fixed action names and an optional UUID v4
`eventId`. Extra or unknown fields are refused. The browser retries a transient failure at
most once with the same key and original token; clients without a key send once. Duplicate
keys are ignored for 24 hours. Expired receipt rows are cleared when another action request
arrives, so this is a duplicate-protection window, not an exact deletion deadline. Excluded
signed-in accounts return success without storing an event.

`/api/v1/site-metrics?version=2` returns current inventories, anonymous creation and action totals,
prior-period comparisons, and per-measure coverage. `/api/v1/site-metrics/accounts` returns
surviving-account creation totals directly from Supabase. Neither public route returns
event rows, account identifiers, or email addresses. The unversioned activity route keeps
the previous response shape while older browser sessions finish, so releasing the backend
before the expanded frontend does not invalidate their working counts.

`/admin/metrics` shows Admin metrics from `GET /api/v1/admin/site-metrics?version=2`.
The version-2 response adds the currently serving legislator count. Requests with
no version or `version=1` keep the older response shape without that field, so an
older open browser can continue reading its report.
The former `/admin/site-metrics` address redirects to `/admin/metrics`. Refresh and
the date-range controls share the same width as the account and activity cards.
The server requires an explicitly allowed account identifier, 1 of the 4 exact confirmed
administrator mailboxes, and a currently eligible account. This report shows combined counts
only. Account growth, activity, and operating records can fail independently; unavailable
sources never become zero. Sign-out, account changes, and token changes remove the previous
private answer. The private answer is not cached or saved in browser storage. Current corpus
counts span stored sessions. **Legislator records, current and former** counts all
stored people. **Currently serving** counts distinct people with current service
in the current regular-session roster, excluding unknown districts, just like
`/legislators`. Minnesota has 201 seats; vacant seats are not listed. Neither count
changes with the 7- or 30-day range. Source-check times are separate from source-publication and
fetch dates. Failure counts cover recorded failures, and cost figures cover logged estimates
for 30 complete UTC days, not every error or expense.

`/api/traffic-google?window=30` reads Pacific calendar days from Google, removes every day
Google marks incomplete, waits 3 days for final data, and returns the latest 30 finalized
days plus the 30 days before them. Vercel gives it a short-lived identity. Google exchanges that for a
read-only service-account token, so no permanent Google private key is stored.

`/api/traffic-bing` reads Bing's daily sitewide totals with a server-only API key and returns
the same 2 finalized windows. It uses Bing's JSON service. The older SOAP and XML services
retire on 31 August 2026; this route does not use them.

`/api/traffic-uptime` reads Checkly's public status dashboard for the website and data-service
URL monitors. It uses Checkly's reported 30-day success ratios, not the latest passing flag
or an average of rounded run buckets. The dashboard must be public, belong to the configured
Checkly account, and contain the 2 distinct configured monitors. Each monitor must be active,
have a valid percentage and dates, and have an update no more than 15 minutes old. Missing
or invalid data hides only that monitor's percentage. If neither is available, the route is
unavailable. No private Checkly API key or Site metrics monitor is needed. The route does not
return monitor addresses, run logs, check identifiers, or the Checkly account identifier.

`/api/traffic-performance` reads Cloudflare's sitewide Core Web Vitals for
`www.alethical.com`. It publishes the score at which 3 in 4 measurements are no worse (the
75th percentile) for main-content paint,
click response, and unexpected movement, plus each score's sample count and date range. It
uses the last 30 complete UTC days, known-bot exclusion, and document navigation types
`navigate`, `reload`, `back-forward`, `restore`, and `prerender`. Soft navigation is excluded;
cache and prefetch deliveries are included. Each score stays hidden until its own actual
sample count is at least 50. These counts come from Cloudflare's confidence `sampleSize`
fields, not weighted totals divided by an average sampling interval. An invalid or missing
count cannot produce a published score. The Cloudflare token stays on the server.
Because the website is served directly by Vercel, `apps/frontend/public/index.html` loads
Cloudflare's public browser beacon with the public site token. The private account-read token
never reaches the browser. The beacon is loaded `async` so it can never hold up the app: the
page lists it before the app's own files, and without `async` a module script waits its turn
in that list. It still reports page speed, because it sends that report on the page's load
event rather than on its own position.

A sitewide score cannot prove that a particular page meets its own limit. It combines
measurements from different pages; a percentile is not an average of their individual scores.
[`scripts/report_page_speed_by_address.py`](../../scripts/report_page_speed_by_address.py)
asks Cloudflare the same question one address at a time, for the money pages first, and
prints the answer to whoever ran it. It reads the same 2 server settings, loads nothing
into anyone's browser, and publishes nothing.

The per-address report uses the same document-load population and actual confidence sample
counts as the sitewide route. Its default is 30 complete UTC days, excluding today; `--days`
can select another positive window. Its main-content and layout scores each require their
own 50 actual measurements. `--min-measurements` can raise that floor, not lower it. Missing
or invalid sample counts stay unavailable. Weighted totals divided by an average sampling
interval are not exact sample counts and must not be substituted. Historical ranges starting
before September 4, 2026 carry a warning that older document-load records may include soft
navigation. The JSON result names this population `documentLoads`, not `firstLoad`.

`--since-release <commit>` bounds a run to the days after a change went live and prints that
bound above the table. The window starts on the first whole UTC day after the commit merged,
because the merge day itself still holds the hours before it: a 5 to 7 September window is not
a post-release reading for something that shipped on 7 September. `--since <date>` does the
same from a date, for a boundary that is not a commit here. When no whole day has passed inside
the bound, the report prints nothing and exits with an error rather than an empty table,
because an empty reading is not a pass and `--fail-on-breach` would otherwise exit 0 on it.

A committee's own page and its payments page are asked about separately, as
`/money/committees/<committee>` and `/money/committees/<committee>/payments`. They are 2 pages
with 2 speeds, and a single prefix match averaged them into a figure true of neither.

With `--what-moved`, the report also lists up to 6 elements associated with layout movement,
using the same document-load population and each element's actual layout sample count.
An element's score stays hidden below 50 measurements. Cloudflare orders these elements by
estimated measurement volume, not movement size.

Each element row also carries how many observations sat above Alethical's own 0.1 limit. That
count is read from Cloudflare's bands rather than inferred from one of them: Cloudflare calls a
visit Good at 0.1 or less, Needs Improvement above 0.1 up to 0.25, and Poor above 0.25, so 0.1
is exactly the Good band's upper edge and the other 2 bands added together are the visits over
our limit. The Poor band is never read on its own, because on its own it passes every visit
between 0.1 and 0.25 under a column calling them over the limit. Both bands are read as actual
confidence sample sizes, and read that way the 3 bands add up to the total exactly: 495, 3 and
544 against 1,042 on the live account on 7 September 2026. If either band is missing the count
prints as unknown rather than as a smaller number. An element name
is a fact about the page rather than the person who opened it; country, device, browser,
resource, and referrer stay out of the report's requests.

Main-content paint measures the browser's largest content element, not when the app is
ready. In 3 browser runs on September 4, 2026 that element was the server-written snapshot;
this does not establish every reader's largest element. The browser report
[`report-page-load-beacons.mjs`](../../apps/frontend/scripts/report-page-load-beacons.mjs)
reads the beacon payloads, and
[`real-visitor-page-speed-sources.md`](../research/real-visitor-page-speed-sources.md)
records those observations.

Publishing is the line, not measuring. The Privacy Policy tells readers that Alethical
publishes only sitewide speed scores, so a per-address breakdown on the public page would
contradict a promise a reader has already read. Changing that promise is the Alethical
team's decision. A page address is a fact about the page rather than about the person who
opened it, and Cloudflare already receives these paths, which is why reading them
privately is not the same act as publishing them.

The server settings are:

- `VERCEL_ANALYTICS_ACCESS_TOKEN`: a sensitive Vercel key for the Alethical team and all
  its projects, used by this route only to read `alethical-web` totals;
- `VERCEL_ANALYTICS_PROJECT_ID`: the Vercel website identifier;
- `VERCEL_ANALYTICS_TEAM_ID`: the Vercel team identifier;
- `TRAFFIC_COUNTING_STARTED_AT`: the exact UTC time counting was switched on;
- `TRAFFIC_EXCLUDED_ACCOUNT_IDS`: additional comma-separated Supabase account identifiers
  for the backend classifier; the 6 known mailboxes and test-domain rules do not depend on
  this setting. Browser collection uses the authenticated backend decision; and
- `EXPO_PUBLIC_CHECKLY_STATUS_URL`: the HTTPS public dashboard address on
  `<name>.checkly-dashboards.com`.

Google Search Console settings:

- `GOOGLE_SEARCH_CONSOLE_GCP_PROJECT_NUMBER`;
- `GOOGLE_SEARCH_CONSOLE_SERVICE_ACCOUNT_EMAIL`;
- `GOOGLE_SEARCH_CONSOLE_WORKLOAD_IDENTITY_POOL_ID`;
- `GOOGLE_SEARCH_CONSOLE_WORKLOAD_IDENTITY_PROVIDER_ID`; and
- `GOOGLE_SEARCH_CONSOLE_SITE_URL=sc-domain:alethical.com`.

Bing Webmaster Tools settings:

- `BING_WEBMASTER_API_KEY`, sensitive; and
- `BING_WEBMASTER_SITE_URL=https://alethical.com/`.

Checkly settings:

- `CHECKLY_ACCOUNT_ID`, required to match the public dashboard's owner;
- `CHECKLY_WEB_CHECK_ID`; and
- `CHECKLY_API_READY_CHECK_ID`.

The dashboard address above and these 3 identity settings are required for public
availability totals. `CHECKLY_API_KEY` and `CHECKLY_TRAFFIC_CHECK_ID` are not required by the
public metrics build. A separate Site metrics check may continue operating independently.

Cloudflare settings:

- `CLOUDFLARE_ANALYTICS_API_TOKEN`, sensitive and limited to Account Analytics Read; and
- `CLOUDFLARE_ACCOUNT_ID`.

A Production build stops before release when any required public-metrics setting is
missing. Preview and local builds do not need them. After a setting changes, Vercel must
create a new Production deployment because an older deployment keeps its older settings.

The current key expires on August 15, 2027. A free daily GitHub check opens 1 replacement
issue 60 days before that date and adds 1 urgent note 14 days before it. If the issue is
closed without changing the saved expiry date, the check reopens it. Missing the date makes
only the public Site metrics totals unavailable. The rest of Alethical stays up and new releases
can continue.

Before adding a second project to the Alethical Vercel team, replace or review this key. Its
All Projects access would automatically include the new project too. Vercel stores the key
as a sensitive Production setting. It must never be sent to the browser or written to logs.

## Page states

- Loading: the page says the totals are loading to screen readers and shows quiet placeholders.
- Normal: each source shows its approved totals, source, time range, and freshness.
- Collection dates: the bottom section keeps known starts visible, names what they measure,
  and reports missing start dates without guessing.
- Unavailable: the whole totals area says the data is temporarily unavailable and still names Vercel.
- Zero: a real zero is printed as `0`.
- Independent source failure: only that company's block says unavailable.
- Stale: the last good answer stays visible with a note that a newer reading has not arrived.
- Capped: a distinct-profile count says `100+` instead of pretending the source returned every path.
- Cloudflare building history: each speed score says `Building sample` until that score has
  50 actual measurements.

The Privacy Policy names Vercel, Google Search Console, Bing Webmaster Tools, Checkly, and
Cloudflare Web Analytics, along with what each receives and what Alethical publishes.

## Automatic source checks

[`site-metrics-health.yml`](../../.github/workflows/site-metrics-health.yml) reads all 7 cached
public answers daily and on demand using [`check_site_metrics_health.py`](../../scripts/check_site_metrics_health.py).
It checks source freshness, matching period boundaries, Money category completeness,
independent account totals, and actual per-score sample floors. A genuine zero or a score
building its sample is valid. Missing or stale sources fail by name without hiding the
remaining checks. It writes only the GitHub run summary; it creates no test visits,
actions, accounts, messages, paid model calls, or private-interest records.

The public and private metrics screens share 1 on-demand feature download. Their display
validators and report-only API readers are not imported by the global analytics collector.
A code-only shared download grants no private access; the backend still checks every private
request. The unchanged initial-download limit is 390000 compressed bytes.
