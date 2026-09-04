# How the Site metrics page works

<!-- describes: api/traffic.ts, api/traffic-google.ts, api/traffic-bing.ts, api/traffic-uptime.ts, api/traffic-performance.ts, api/traffic-collection.ts, alethical/api/routers/site_metrics.py, alethical/db/models.py, alethical/alembic/versions/0038_site_metric_event.py, apps/frontend/src/components/TrafficAnalytics.tsx, apps/frontend/src/components/TrafficAnalytics.web.tsx, apps/frontend/src/lib/traffic.ts, apps/frontend/src/lib/siteMetricEvents.ts, apps/frontend/src/screens/TrafficScreen.tsx, apps/frontend/public/index.html, apps/frontend/scripts/check-traffic-production-env.mjs, apps/frontend/scripts/traffic-token-expiry.mjs, .github/workflows/traffic-token-expiry.yml, scripts/report_page_speed_by_address.py, apps/frontend/scripts/report-page-load-beacons.mjs -->

The public `/site-metrics` page combines 6 independent sources:

- Vercel Web Analytics shows estimated visitors, page views, destinations, and profile breadth for 24 hours, 7 days, or 30 days;
- Alethical's own records show fixed action totals, registered readers, and bill watches;
- Google Search Console shows sitewide appearances and visits for 30 finalized days;
- Bing Webmaster Tools shows the same 2 sitewide search totals;
- Checkly shows 30-day availability for the home page and data service; and
- Cloudflare Web Analytics shows 30-day page-speed scores from real Chromium visits.

The public totals are the same for signed-in and signed-out readers. The About menu links
to the page. Signed-in team accounts also see links to the 5 private vendor dashboards;
each vendor still requires its own sign-in.

Each source has its own server route and page state. A Google problem hides only Google.
A Checkly problem cannot erase Vercel visits. The browser keeps the last good answer from
each source when a later refresh fails. Vercel's delivery network also keeps the last valid
Vercel traffic answer available for up to 24 hours when that source temporarily fails, so a
reload does not immediately replace working traffic totals with an unavailable message.

## What the numbers mean

A page view is 1 page load. Opening several pages creates several views. Opening or
reloading `/site-metrics` creates a view too. Refreshing only the numbers does not.

Vercel counts without an analytics cookie and removes traffic it identifies as automated.
Destination percentages are shares of page views, not people. Profile breadth is capped at
`100+` when Vercel cannot list more distinct paths.

Every period trails backward from the most recent completed UTC hour. The page shows that
ending hour in Minnesota's time zone, labeled `CT`. The 3 windows contain 24, 168, and 720
complete hours. The page fetches a new combined result about every 5 minutes. While fewer
than 30 days have been collected, it names the counting start date.

## Privacy boundary

The browser removes everything after `?` or `#` before sending a page address to Vercel.
Alethical stores only 4 fixed action names: a bill search with results, a legislator search
with results, a successful Find My Legislator lookup, and an official Minnesota source link
opened. Each record has only that fixed name and its time. It never contains search words,
page paths, addresses, districts, account identifiers, referrers, or other details. New bill
watches come from the existing bill-watch record instead of a second event.

Analytics waits until sign-in has been checked. A signed-in account identifier goes only
to Alethical's private decision route (`/api/traffic-collection`). That route compares the
identifier with the server-only team list. It returns only whether collection may begin.
If that private check fails, collection stays off for the signed-in visit. Vercel never
receives the account identifier.

Google and Bing return only combined 30-day appearances and visits. The public routes do
not request or return search phrases, page addresses, countries, devices, or positions.
Google uses a read-only machine account that is separate from a reader's Google sign-in.

Checkly opens only 3 public Alethical addresses from North Virginia. Cloudflare receives
page-speed measurements, page paths without the question text after `?`, referrers, broad
place and browser facts, and some element or resource details. Alethical publishes none of
those details. It publishes only sitewide speed scores after at least 50 measured visits.
Cloudflare Web Analytics uses no cookies, local storage, or fingerprinting.

The team list uses stable Supabase account identifiers, not email addresses. Save the same
comma-separated identifiers in Vercel and Railway as `TRAFFIC_EXCLUDED_ACCOUNT_IDS` only
after each one is confirmed. The live list contains 3 of the 4 team accounts; append the 4th
identifier after it is confirmed. Vercel stops collecting signed-in page loads for accounts
on the list, and Railway discards their signed-in actions before storage and removes their
readers and watches from its totals. Anonymous history collected before an identifier is
saved cannot be cleaned later. Reader and watch history can be recalculated after it is saved.

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

`/api/traffic-collection` accepts a signed-in account identifier and returns 1 yes-or-no
collection decision. Its answer is never stored in a public setting.

`/api/v1/site-metrics/events` accepts only the 4 fixed action names. Extra or unknown fields
are refused. If the signed-in reader is on the team list, the route returns success without
storing an event. `/api/v1/site-metrics` returns 7-day and 30-day action totals plus current
reader and watch totals. It never returns event rows or account identifiers.

`/api/traffic-google?window=30` reads Pacific calendar days from Google, removes every day
Google marks incomplete, waits 3 days for final data, and returns the latest 30 finalized
days plus the 30 days before them. Vercel gives it a short-lived identity. Google exchanges that for a
read-only service-account token, so no permanent Google private key is stored.

`/api/traffic-bing` reads Bing's daily sitewide totals with a server-only API key and returns
the same 2 finalized windows. It uses Bing's JSON service. The older SOAP and XML services
retire on 31 August 2026; this route does not use them.

`/api/traffic-uptime` reads 30-day availability from 3 Checkly URL monitors. The public page
shows the home page and data service; Checkly continues checking the Site metrics page without
using that page's own availability as a public measure of whether people can reach Alethical.
Each monitor runs from North Virginia every 2 minutes. A missing or invalid percentage makes
only this route unavailable. It never returns monitor addresses, run logs, check identifiers,
the Checkly account identifier, or the key.

`/api/traffic-performance` reads Cloudflare's sitewide Core Web Vitals for
`www.alethical.com`. It publishes only the slowest 1 in 4 result for main-content paint,
click response, and unexpected movement, plus the number of samples and date range. A score
stays hidden until 50 measured visits exist. The Cloudflare token stays on the server.
Because the website is served directly by Vercel, `apps/frontend/public/index.html` loads
Cloudflare's public browser beacon with the public site token. The private account-read token
never reaches the browser. The beacon is loaded `async` so it can never hold up the app: the
page lists it before the app's own files, and without `async` a module script waits its turn
in that list. It still reports page speed, because it sends that report on the page's load
event rather than on its own position.

A sitewide score cannot be checked against a limit written for one page, because a fast
page and a slow one average into a figure true of neither.
[`scripts/report_page_speed_by_address.py`](../../scripts/report_page_speed_by_address.py)
asks Cloudflare the same question one address at a time, for the money pages first, and
prints the answer to whoever ran it. It reads the same 2 server settings, loads nothing
into anyone's browser, and publishes nothing.

Two things it does that the sitewide route does not, and both change what a figure means.
It reads first page loads only, because Cloudflare's records for an address change without a
page fetch are dominated by the program's own start-up rewriting the address it already has,
timed from the original page load, while the record a real click opens carries no figure at
all. And it counts real measurements rather than Cloudflare's reported totals: those totals
are the raw count multiplied by the sampling interval, so a percentile resting on 4
measurements can arrive labelled 60. Its default window is 7 days for the same reason, since
Cloudflare keeps that period unsampled.

One thing this makes plain about the sitewide figures on the public page too. The beacon's
main-content element on a first load is the server-written snapshot's text, so both the
sitewide score and the per-address ones say when the snapshot appeared rather than when the
app drew. `apps/frontend/scripts/report-page-load-beacons.mjs` reads the beacon's own
payloads and shows this, and `docs/research/real-visitor-page-speed-sources.md` records how
it was found.

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
- `TRAFFIC_EXCLUDED_ACCOUNT_IDS`: comma-separated stable Supabase account identifiers,
  required in Vercel and Railway and currently holding 3 of the 4 confirmed team accounts; and
- `EXPO_PUBLIC_CHECKLY_STATUS_URL`: Checkly's public availability-detail address.

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

- `CHECKLY_API_KEY`, sensitive;
- `CHECKLY_ACCOUNT_ID`;
- `CHECKLY_WEB_CHECK_ID`;
- `CHECKLY_TRAFFIC_CHECK_ID`; and
- `CHECKLY_API_READY_CHECK_ID`.

The 3 checks and public dashboard stay on Checkly's free Hobby plan.

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
- Collecting history: the counting start sentence appears until 30 complete days exist.
- Unavailable: the whole totals area says the data is temporarily unavailable and still names Vercel.
- Zero: a real zero is printed as `0`.
- Independent source failure: only that company's block says unavailable.
- Stale: the last good answer stays visible with a note that a newer reading has not arrived.
- Capped: a distinct-profile count says `100+` instead of pretending the source returned every path.
- Cloudflare building history: each speed score says `Building sample` until 50 measured
  visits exist.

The Privacy Policy names Vercel, Google Search Console, Bing Webmaster Tools, Checkly, and
Cloudflare Web Analytics, along with what each receives and what Alethical publishes.
