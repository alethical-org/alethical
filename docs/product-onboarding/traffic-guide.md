# How the Traffic page works

<!-- describes: api/traffic.ts, api/traffic-google.ts, api/traffic-bing.ts, api/traffic-uptime.ts, api/traffic-performance.ts, api/traffic-collection.ts, apps/frontend/src/components/TrafficAnalytics.tsx, apps/frontend/src/components/TrafficAnalytics.web.tsx, apps/frontend/src/lib/traffic.ts, apps/frontend/src/screens/TrafficScreen.tsx, apps/frontend/public/index.html, apps/frontend/scripts/check-traffic-production-env.mjs, apps/frontend/scripts/traffic-token-expiry.mjs, .github/workflows/traffic-token-expiry.yml -->

The public `/traffic` page combines 5 independent sources:

- Vercel Web Analytics shows page views for 24 hours, 7 days, and 30 days;
- Google Search Console shows sitewide appearances and visits for 28 finalized days;
- Bing Webmaster Tools shows the same 2 sitewide search totals;
- Checkly shows 30-day availability for the home page, Traffic page, and data service; and
- Cloudflare Web Analytics shows 28-day page-speed scores from real Chromium visits.

The page is the same for signed-in and signed-out readers. It is listed in the public
sitemap, but it is not linked from the top navigation or footer.

Each source has its own server route and page state. A Google problem hides only Google.
A Checkly problem cannot erase Vercel visits. The browser keeps the last good answer from
each source when a later refresh fails.

## What the numbers mean

A page view is 1 page load. Opening several pages creates several views. Opening or
reloading `/traffic` creates a view too. Refreshing only the numbers does not.

Vercel counts without an analytics cookie and removes traffic it identifies as automated.

Every period trails backward from the most recent completed UTC hour. The page shows that
ending hour in Minnesota's time zone, labeled `CT`. The 3 windows contain 24, 168, and 720
complete hours. The page fetches a new combined result about every 5 minutes. While fewer
than 30 days have been collected, it names the counting start date.

## Privacy boundary

The browser removes everything after `?` or `#` before sending a page address to Vercel.
No custom actions, typed searches, names, emails, account identifiers, locations, device
lists, referrers, or per-person records are sent or shown.

Analytics waits until sign-in has been checked. A signed-in account identifier goes only
to Alethical's private decision route (`/api/traffic-collection`). That route compares the
identifier with the server-only team list. It returns only whether collection may begin.
If that private check fails, collection stays off for the signed-in visit. Vercel never
receives the account identifier.

Google and Bing return only combined 28-day appearances and visits. The public routes do
not request or return search phrases, page addresses, countries, devices, or positions.
Google uses a read-only machine account that is separate from a reader's Google sign-in.

Checkly opens only 3 public Alethical addresses from North Virginia. Cloudflare receives
page-speed measurements, page paths without the question text after `?`, referrers, broad
place and browser facts, and some element or resource details. Alethical publishes none of
those details. It publishes only sitewide speed scores after at least 50 measured visits.
Cloudflare Web Analytics uses no cookies, local storage, or fingerprinting.

The team list uses stable account identifiers, not email addresses. When the 4 team emails
are supplied, resolve them to their Supabase account identifiers and save the comma-separated
identifiers in `TRAFFIC_EXCLUDED_ACCOUNT_IDS`. Visits counted before the list is saved cannot
be removed later.

## Public and private routes

`/api/traffic` reads Vercel page views. The Vercel access token stays on the server.
Vercel's traffic service rejected a project-only key. The working key covers the
Alethical team and all its Vercel projects. That team currently contains only
`alethical-web`. The route uses the key only to read traffic totals. It splits 30 days into
5 requests because Vercel allows no more than 168 hourly rows per request. It checks that
every returned hour and page-view count is valid. A successful empty period is a real zero.
The route then returns only the 3 totals, the fetch time, the end of the last complete hour,
the counting start time, and whether team exclusion is configured. A valid zero is shown as
`0`. A missing or invalid answer is shown as unavailable, never as zero.

`/api/traffic-collection` accepts a signed-in account identifier and returns 1 yes-or-no
collection decision. Its answer is never stored in a public setting.

`/api/traffic-google` reads 70 Pacific calendar days from Google, removes every day Google
marks incomplete, waits 3 days for final data, and returns the latest 28 finalized days plus
the 28 days before them. Vercel gives it a short-lived identity. Google exchanges that for a
read-only service-account token, so no permanent Google private key is stored.

`/api/traffic-bing` reads Bing's daily sitewide totals with a server-only API key and returns
the same 2 finalized windows. It uses Bing's JSON service. The older SOAP and XML services
retire on 31 August 2026; this route does not use them.

`/api/traffic-uptime` reads 30-day availability from 3 Checkly URL monitors. Each monitor
runs from North Virginia every 2 minutes. A missing or invalid percentage makes only this
route unavailable. It never returns monitor addresses, run logs, check identifiers, the
Checkly account identifier, or the key.

`/api/traffic-performance` reads Cloudflare's sitewide Core Web Vitals for
`www.alethical.com`. It publishes only the slowest 1 in 4 result for main-content paint,
click response, and unexpected movement, plus the number of samples and date range. A score
stays hidden until 50 measured visits exist. The Cloudflare token stays on the server.
Because the website is served directly by Vercel, `apps/frontend/public/index.html` loads
Cloudflare's public browser beacon with the public site token. The private account-read token
never reaches the browser.

The server settings are:

- `VERCEL_ANALYTICS_ACCESS_TOKEN`: a sensitive Vercel key for the Alethical team and all
  its projects, used by this route only to read `alethical-web` totals;
- `VERCEL_ANALYTICS_PROJECT_ID`: the Vercel website identifier;
- `VERCEL_ANALYTICS_TEAM_ID`: the Vercel team identifier;
- `TRAFFIC_COUNTING_STARTED_AT`: the exact UTC time counting was switched on; and
- `TRAFFIC_EXCLUDED_ACCOUNT_IDS`: optional comma-separated Supabase account identifiers.

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

Cloudflare settings:

- `CLOUDFLARE_ANALYTICS_API_TOKEN`, sensitive and limited to Account Analytics Read; and
- `CLOUDFLARE_ACCOUNT_ID`.

A Production build stops before release when any of the first 4 required settings is
missing. Preview and local builds do not need them. After a setting changes, Vercel must
create a new Production deployment because an older deployment keeps its older settings.

The current key expires on August 15, 2027. A free daily GitHub check opens 1 replacement
issue 60 days before that date and adds 1 urgent note 14 days before it. If the issue is
closed without changing the saved expiry date, the check reopens it. Missing the date makes
only the public Traffic totals unavailable. The rest of Alethical stays up and new releases
can continue.

Before adding a second project to the Alethical Vercel team, replace or review this key. Its
All Projects access would automatically include the new project too. Vercel stores the key
as a sensitive Production setting. It must never be sent to the browser or written to logs.

## Page states

- Loading: the page says the totals are loading to screen readers and shows quiet placeholders.
- Normal: all 3 exact totals, source, check age, and completed-hour time in `CT` are shown.
- Collecting history: the counting start sentence appears until 30 complete days exist.
- Unavailable: the whole totals area says the data is temporarily unavailable and still names Vercel.
- Zero: a real zero is printed as `0`.
- Independent source failure: only that company's block says unavailable.
- Cloudflare building history: each speed score says `Building sample` until 50 measured
  visits exist.

The Privacy Policy names Vercel, Google Search Console, Bing Webmaster Tools, Checkly, and
Cloudflare Web Analytics, along with what each receives and what Alethical publishes.
