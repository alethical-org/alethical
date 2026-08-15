# How the Traffic page works

<!-- describes: api/traffic.ts, api/traffic-collection.ts, apps/frontend/src/components/TrafficAnalytics.tsx, apps/frontend/src/components/TrafficAnalytics.web.tsx, apps/frontend/src/lib/traffic.ts, apps/frontend/src/screens/TrafficScreen.tsx, apps/frontend/scripts/check-traffic-production-env.mjs -->

The public `/traffic` page shows 4 combined totals from Vercel Web Analytics:

- estimated visitors during the trailing 24 hours;
- page views during the trailing 24 hours;
- page views during the trailing 7 days; and
- page views during the trailing 30 days.

The page is the same for signed-in and signed-out readers. It is listed in the public
sitemap, but it is not linked from the top navigation or footer. A later release can add
more detail to this same address.

## What the numbers mean

A page view is 1 page load. Opening several pages creates several views. Opening or
reloading `/traffic` creates a view too. Refreshing only the numbers does not.

Vercel makes its visitor estimate without an analytics cookie. The estimate resets each
day, so the same person may count again on another day. A person using 2 devices may also
count twice. Vercel removes traffic it identifies as automated.

Every period trails backward from the fetch time. The page fetches a new combined result
about every 5 minutes. While fewer than 30 days have been collected, it names the counting
start date and explains that the longer totals contain only the available days.

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
identifiers in `TRAFFIC_EXCLUDED_ACCOUNT_IDS`. The public method note claims team exclusion
only after that list contains at least 1 identifier. Visits counted before the list is saved
cannot be removed later.

## Public and private routes

`/api/traffic` is the only route the public page reads. The Vercel access token stays on the
server. Vercel can limit this token to the Alethical team, but it does not offer a one-project
token. The route uses the token only to read traffic totals. It asks Vercel for all 3 periods,
checks that the returned periods and totals
are valid, and returns only the 4 numbers, the fetch time, the counting start time, and
whether team exclusion is configured. A valid zero is shown as `0`. A missing or invalid
answer is shown as unavailable, never as zero.

`/api/traffic-collection` accepts a signed-in account identifier and returns 1 yes-or-no
collection decision. Its answer is never stored in a public setting.

The server settings are:

- `VERCEL_ANALYTICS_ACCESS_TOKEN`: a secret Vercel token limited to the Alethical team and
  used only to read this website's totals;
- `VERCEL_ANALYTICS_PROJECT_ID`: the Vercel website identifier;
- `VERCEL_ANALYTICS_TEAM_ID`: the Vercel team identifier;
- `TRAFFIC_COUNTING_STARTED_AT`: the exact UTC time counting was switched on; and
- `TRAFFIC_EXCLUDED_ACCOUNT_IDS`: optional comma-separated Supabase account identifiers.

A Production build stops before release when any of the first 4 required settings is
missing. Preview and local builds do not need them. After a setting changes, Vercel must
create a new Production deployment because an older deployment keeps its older settings.

## Page states

- Loading: the page says the totals are loading to screen readers and shows quiet placeholders.
- Normal: all 4 exact totals, source, fetch age, and trailing-period note are shown.
- Collecting history: the counting start sentence appears until 30 complete days exist.
- Unavailable: the whole totals area says the data is temporarily unavailable and still names Vercel.
- Zero: a real zero is printed as `0`.

The Privacy Policy names Vercel Web Analytics, address cleaning, the lack of analytics
cookies, and the private team-account check.
