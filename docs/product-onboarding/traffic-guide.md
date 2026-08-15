# How the Traffic page works

<!-- describes: api/traffic.ts, api/traffic-collection.ts, apps/frontend/src/components/TrafficAnalytics.tsx, apps/frontend/src/components/TrafficAnalytics.web.tsx, apps/frontend/src/lib/traffic.ts, apps/frontend/src/screens/TrafficScreen.tsx, apps/frontend/scripts/check-traffic-production-env.mjs, apps/frontend/scripts/traffic-token-expiry.mjs, .github/workflows/traffic-token-expiry.yml -->

The public `/traffic` page shows 3 page-view totals from Vercel Web Analytics:

- page views during the trailing 24 hours;
- page views during the trailing 7 days; and
- page views during the trailing 30 days.

The page is the same for signed-in and signed-out readers. It is listed in the public
sitemap, but it is not linked from the top navigation or footer. A later release can add
more detail to this same address.

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

The team list uses stable account identifiers, not email addresses. When the 4 team emails
are supplied, resolve them to their Supabase account identifiers and save the comma-separated
identifiers in `TRAFFIC_EXCLUDED_ACCOUNT_IDS`. Visits counted before the list is saved cannot
be removed later.

## Public and private routes

`/api/traffic` is the only route the public page reads. The Vercel access token stays on the
server. Vercel's traffic service rejected a project-only key. The working key covers the
Alethical team and all its Vercel projects. That team currently contains only
`alethical-web`. The route uses the key only to read traffic totals. It splits 30 days into
5 requests because Vercel allows no more than 168 hourly rows per request. It checks that
every returned hour and page-view count is valid. A successful empty period is a real zero.
The route then returns only the 3 totals, the fetch time, the end of the last complete hour,
the counting start time, and whether team exclusion is configured. A valid zero is shown as
`0`. A missing or invalid answer is shown as unavailable, never as zero.

`/api/traffic-collection` accepts a signed-in account identifier and returns 1 yes-or-no
collection decision. Its answer is never stored in a public setting.

The server settings are:

- `VERCEL_ANALYTICS_ACCESS_TOKEN`: a sensitive Vercel key for the Alethical team and all
  its projects, used by this route only to read `alethical-web` totals;
- `VERCEL_ANALYTICS_PROJECT_ID`: the Vercel website identifier;
- `VERCEL_ANALYTICS_TEAM_ID`: the Vercel team identifier;
- `TRAFFIC_COUNTING_STARTED_AT`: the exact UTC time counting was switched on; and
- `TRAFFIC_EXCLUDED_ACCOUNT_IDS`: optional comma-separated Supabase account identifiers.

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

The Privacy Policy names Vercel Web Analytics, address cleaning, the lack of analytics
cookies, and the private team-account check.
