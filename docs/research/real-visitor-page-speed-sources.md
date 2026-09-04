# What the 2 measurement services on every Alethical page already report

**Correction, 4 September 2026, same day as first publication.** The per-address figures
first published here were wrong, and the tool that produced them has been fixed. Two
mistakes, both of which printed a confident number rather than an error. Cloudflare's
reported sample totals are the raw measurement count multiplied by its sampling interval,
so a floor that appeared to require 50 measurements was letting through percentiles resting
on 1 to 15; and the request mixed first page loads with clicks inside the site, which are
different events, so addresses people mostly click into scored as though they were almost
instant. The corrected figures are below and the wrong ones are not kept, because a number
nobody should rely on has no business still being readable. What changed materially: no
money address has enough first-load measurements to be judged at all, and the layout-movement
failure is real sitewide and on `/bills` but not on the money list addresses, where the first
version attributed it.

**Dated snapshot, 4 September 2026.** Read at each service's own documentation and
measured against Alethical's live production account and live production routes. A later
pass gets a later file; nothing here is updated as the world changes
(`docs/folder-structure.md`, and `docs/research/README.md` for the convention).

Net: real-visitor page-speed monitoring already exists here, is live, and has been
collecting for weeks. Cloudflare Web Analytics records both numbers
[issue 1966](https://github.com/alethical-org/alethical/issues/1966)'s release limit is
written in, at the slowest 1 in 4 visits, per page address, free on every plan, and
Alethical already reads it with a private token and publishes the sitewide figures on the
public Site metrics page. Nothing needed building to collect it. The only gap was reading
it one address at a time, which a limit written per page requires and a sitewide figure
cannot supply.

## Why this question was asked

[Issue 1966](https://github.com/alethical-org/alethical/issues/1966) sets a release limit
in terms of real visitors: main content within 2.5 seconds and unexpected layout movement
at 0.1 or less, for the slowest 1 in 4 money-page visits. Every other limit on that issue
is measurable from one machine. That one is not, because it is about the spread across
real connections and devices.

[PR #643](https://github.com/alethical-org/alethical/pull/643) proposed building a
measurement system for it: a public beacon endpoint, a new database table with its own
migration, rate limiting, and 6 new browser files running during page start-up. Before
building any of that, the 2 services already loading on every page were checked.

## Cloudflare Web Analytics

Loaded from `apps/frontend/public/index.html`, which carries Cloudflare's public browser
beacon (`static.cloudflareinsights.com/beacon.min.js`) with the public site token. The
beacon reports to `cloudflareinsights.com/cdn-cgi/rum`.

**It records both numbers we need.** Cloudflare's own documentation states that "Three
core Web Vitals metrics are measured: Largest Contentful Paint, Interaction to Next Paint,
and Cumulative Layout Shift" — main content, click response, and unexpected layout
movement. Each table "also shows you the performance of these elements in the 75th
percentile (P75) at a glance", which is the slowest 1 in 4, with the 50th, 90th and 99th
also available. It records the "URL path at the time the Core Web Vitals are captured" and
allows filtering "by URL, Browser, Operating System, Country, Element and more".

**We can read it, at no charge.** Web Analytics is available on all Cloudflare plans, its
data is queryable through the GraphQL Analytics API, and it holds 6 months of history
(unsampled for the past 7 days, aggregated down to about 10% after that). Alethical's site
is registered and collecting: the dashboard reported 11,100 page views and 5,500 visits in
the 24 hours before this was written.

**We already read it in production.** `api/traffic-performance.ts` queries the
`rumWebVitalsEventsAdaptiveGroups` dataset with a private Account Analytics Read token and
publishes the sitewide slowest-1-in-4 figures on the public `/site-metrics` page. Read live
at `https://www.alethical.com/api/traffic-performance` on 4 September 2026: main content
5,596 ms, click response 64 ms, unexpected layout movement 1, over 14,900 measurements
across 28 days. The 2 server settings it uses,
`CLOUDFLARE_ANALYTICS_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, are recorded in
[`docs/product-onboarding/traffic-guide.md`](../product-onboarding/traffic-guide.md).

**What it does not record.** Whether a request was served from a warm cache or went to the
origin. Issue 516 asked for that dimension, and Cloudflare's page-speed records do not
carry it, so it would need a different source. Nothing on issue 1966 currently depends on
it.

## Vercel Analytics

Loaded by `apps/frontend/src/components/TrafficAnalytics.web.tsx`, which uses
`@vercel/analytics/react` (pinned at 2.0.1 in `apps/frontend/package.json`). It loads
`/_vercel/insights/script.js` and reports to `/_vercel/insights/view`.

**It records neither number we need.** Vercel's documentation describes Web Analytics as
visitors, page views, bounce rate, top pages, referrers, and demographics such as location,
operating system and browser. Core Web Vitals are a separate Vercel product, Speed
Insights, and its documentation is explicit about the split: "To monitor your site's
performance, use Speed Insights." Speed Insights is not installed here; no
`@vercel/speed-insights` dependency exists in the repository.

**Installing it would not answer the layout half without paying.** Vercel's own words:
"Speed Insights is available on every plan for free and includes the Real Experience Score
(RES). Upgrade a project to **Speed Insights Plus** to unlock all Core Web Vitals,
breakdowns, and Drains." Its metric list places First Contentful Paint and Largest
Contentful Paint in the free tier and notes that "Individual Core Web Vitals require Speed
Insights Plus". Unexpected layout movement is one of those individual metrics. A paid plan
is not authorized, so Vercel cannot answer issue 1966's limit at all.

## The gap, stated exactly

| What the limit needs | Cloudflare | Vercel |
| --- | --- | --- |
| Time to main content | Records it | Only with Speed Insights installed |
| Unexpected layout movement | Records it | Paid tier only |
| Slowest 1 in 4 rather than the average | Yes, and 4 other percentiles | Yes, where a metric is available |
| Broken down per page address | Yes | Yes, where a metric is available |
| Free | Yes, on every plan | Not for the layout number |
| Readable by us without a dashboard | Yes, through GraphQL, and we already do | Not for these metrics |

So the gap was never collection. It was that the route we already run asks Cloudflare for
one figure covering the whole site, and a limit written for one page cannot be checked
against it: a fast page and a slow one average into a figure true of neither.

## Two ways a per-address figure lies, both found the day this was written

The first per-address figures could not be reconciled with a browser measurement of the
same page: `/money/committees` read 46 ms against about 1.8 s measured in a browser with
an empty cache, which is not a physically plausible page load. Both causes were found, and
both produced a confident number rather than an error, which is why they are recorded here
rather than only fixed in code.

**Cloudflare's reported sample totals are estimates of visits, not counts of
measurements.** `lcpTotal` and `clsTotal` are the raw measurement count multiplied by
`sampleInterval`. Measured on 4 September 2026: over a 28-day window the interval was 10 to
20 and every reported total came back a round multiple of 10; over a 7-day window, which
Cloudflare keeps unsampled, the interval was about 1 and the totals were not round. So a
50-measurement floor applied to the reported total was letting through percentiles resting
on 1 to 15 real measurements. Divide by the interval and the count comes back. This is why
7 days is the right window despite covering fewer visits: a longer window buys visits and
pays for them in sampling, and a percentile needs measurements rather than estimates.

**A percentile that mixes first loads with clicks inside the site is a percentile of
nothing anyone does.** Alethical's website is one program that redraws itself, so moving
from `/money` to `/money/committees` by clicking never fetches a new page. Cloudflare
separates the 2 through its `navigationType` dimension and measures both. Across the money
addresses over 7 days a first load measured 1,536 ms against 58 ms for a click inside the
site. Issue 1966's limit is about the wait before a page appears, so it has to be read
against first loads alone; the mixed figure made pages people mostly click into score as
though they were instant.

## The numbers, first loads only

Real visits to `www.alethical.com`, 29 August to 4 September 2026, slowest 1 in 4, first
loads only, with real measurement counts. Read from Cloudflare's own records. The limits
are 2,500 ms and 0.1.

| Page address | Main content | Layout movement | Measurements | Over the limit |
| --- | --- | --- | --- | --- |
| `/money` | withheld | withheld | 9 | not known |
| `/money/committees` | withheld | withheld | 15 | not known |
| `/money/races` | withheld | withheld | 24 | not known |
| `/money/outside-spending` | withheld | withheld | 20 | not known |
| `/money/search` | withheld | withheld | 1 | not known |
| a committee's own page | withheld | withheld | 42 / 43 | not known |
| `/bills` | 4,300 ms | 1 | 365 | main content, layout movement |
| `/` | withheld | withheld | 32 / 27 | not known |
| every address | 4,764 ms | 1 | 9,276 / 9,268 | main content, layout movement |

**No money address can be judged yet.** Every one rests on 1 to 43 first-load measurements
in the unsampled window, against a floor of 50. That is the honest answer, and it is a
different answer from the one a figure printed without its count gives. A committee's own
page, at 42 and 43, is the closest to judgeable and reads 3,804 ms and 1 if the floor is
lowered to 40, which is worth knowing and is not the same as being measured.

**What can be judged is bad.** `/bills`, on 365 measurements, takes 4,300 ms to show main
content, and the whole site, on 9,276, takes 4,764 ms. Both are nearly twice the 2,500 ms
limit issue 1966 sets for the money pages, on the strongest counts we have.

For comparison, clicking inside the site rather than loading a page: only the sitewide
figure has enough measurements, and it reads 7,616 ms for main content and 0.475 for layout
movement on 902 and 834 measurements. Clicking through the site is measurably slower than
loading a page fresh, which is the opposite of what a program that has already loaded
should do, and nothing currently explains it.

**One honest limit remains on the layout figures.** Unexpected layout movement appears to
stop at 1. Across 130 address groups over 30 days, no value above 1 appeared at any
percentile up to the slowest 1 in 1000. So read a printed 1 as "1 or worse", which is 10
times the limit either way.

## What these numbers say about issue 1966

**Unexpected layout movement is a real failure, sitewide, on the strongest count we have.**
1 or worse at the slowest 1 in 4 across 9,268 first-load measurements, against a passing
mark of 0.1. `/bills` shows the same on 365. It is the worst reader-facing number this
investigation found, and no acceptance criterion on issue 1966 targets it.

**It is not, on the evidence, a money-list-page failure.** On first loads the money list
addresses measure 0.006, comfortably inside the limit, though on too few measurements to
state as a result. The first version of this file attributed the sitewide failure to those
addresses, on figures that were mixing in clicks inside the site. Where the movement is
happening is therefore an open question, and the addresses with both a solid count and a
failing figure are `/bills` and the site as a whole.

**Lab measurements and real-visitor measurements time different moments, and the release
limit is about the second.** The 46 ms that started this has an explanation: it was mostly
clicks inside the site. Whether the remaining gap between a 284 ms first load on
`/money/committees` and about 1.8 s in a browser is a real difference or an artefact of 15
measurements cannot be settled at these counts.

## Why the per-address breakdown is not published on the Site metrics page

Alethical's Privacy Policy (`apps/frontend/src/screens/LegalScreens.tsx`) tells readers
twice that "Alethical publishes only sitewide speed totals after at least 50 measured
visits" and "Alethical publishes only sitewide 30-day speed scores and sample counts". A
per-address breakdown on that public page would contradict a promise a reader has already
read, and changing that promise is the Alethical team's decision, not a side effect of a
measurement job.

Reading a page address privately is a different act from publishing it. The address
describes the page rather than the person who opened it, and Cloudflare already receives
these paths with the question text after `?` removed, which the Privacy Policy states. So
the per-address read is a command-line tool that prints to whoever ran it:
[`scripts/report_page_speed_by_address.py`](../../scripts/report_page_speed_by_address.py),
recorded in
[`docs/product-onboarding/traffic-guide.md`](../product-onboarding/traffic-guide.md). It
asks for 2 percentiles and 2 sample counts per address and for no country, device, browser,
element, resource or referrer, and a test pins that.

## How anything built here proves it does not delay content

The page's own start-up path is the thing under repair on issue 1966, so a measurement
added to it would risk causing the delay it exists to detect. Two rules follow, and the
first is what makes the second rarely necessary:

* **Prefer measuring from outside the browser.** Cloudflare's beacon is already loaded, so
  a reader of its records adds nothing to the page. The command-line tool above runs on
  someone's machine and never reaches a browser, which is why it needs no proof at all.
* **Where something must run in the page, the proof is this same measurement, per address,
  before and after.** Main-content time on the affected addresses is the number a start-up
  delay moves, so a change that raises it has failed its own test. That check is only
  possible because the per-address read exists, which is the argument for building the read
  before anything else.

## What this leaves open

A scheduled run, so the numbers arrive without anyone typing a command. That needs
`CLOUDFLARE_ANALYTICS_API_TOKEN` added to GitHub Actions' secrets; it exists on Vercel
today and not in Actions, and only the maintainer can add it. Tracked on
[issue 516](https://github.com/alethical-org/alethical/issues/516).

## Provenance

Produced 4 September 2026 in one pass. Sources: Cloudflare's Web Analytics documentation
(overview, metrics, Core Web Vitals, and FAQ pages) and Vercel's Web Analytics and Speed
Insights documentation, each read at the vendor's own site rather than relayed; Alethical's
live Cloudflare account, queried through the dashboard's GraphQL endpoint for the figures in
the tables above; Alethical's live `https://www.alethical.com/api/traffic-performance`
route; and this repository at commit `020f3980`. Every vendor claim quoted above was read at
that vendor's page. Every percentile was read from Cloudflare rather than computed here.
What is computed: microseconds to milliseconds, the real measurement count as Cloudflare's
reported total divided by its sampling interval, and the withholding of percentiles under 50
measurements.

Decisions this drove: [PR #643](https://github.com/alethical-org/alethical/pull/643) closed
as superseded, [PR #1974](https://github.com/alethical-org/alethical/pull/1974) added
the per-address read, and [PR #1983](https://github.com/alethical-org/alethical/pull/1983)
corrected both counting mistakes named at the top of this file. The living record of how the measurement works is
[`docs/product-onboarding/traffic-guide.md`](../product-onboarding/traffic-guide.md), not
this file.
