# What the 2 measurement services on every Alethical page already report

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

## The first numbers, per page address

Real visits to `www.alethical.com`, 8 August to 4 September 2026, slowest 1 in 4. Read
from Cloudflare's own records. The limits are 2,500 ms and 0.1.

| Page address | Main content | Layout movement | Over the limit |
| --- | --- | --- | --- |
| `/money` | 1,640 ms | 1 | layout movement |
| `/money/committees` | 46 ms | 0 | no |
| `/money/races` | too few (10) | too few (20) | not known yet |
| `/money/outside-spending` | too few (10) | too few (10) | not known yet |
| `/money/search` | 300 ms | 1 | layout movement |
| a committee's own page | 5,420 ms | 1 | main content, layout movement |
| `/bills` | 3,784 ms | 1 | main content, layout movement |
| `/` | 1,448 ms | 1 | layout movement |
| every address | 5,596 ms | 1 | main content, layout movement |

**Three honest limits on those figures.**

* **Cloudflare keeps a sample, not every visit.** Across these addresses it reported 1
  measurement per 10 to 102 visits, and it publishes that rate alongside the data.
* **Two money addresses cannot be judged yet**, at 10 to 20 measurements each. A percentile
  drawn from 10 measurements is not a number, so it is withheld rather than printed, and a
  withheld figure never counts as a limit met.
* **Unexpected layout movement appears to stop at 1.** Across 130 address groups over 30
  days, no value above 1 appeared at any percentile up to the slowest 1 in 1000. So read a
  printed 1 as "1 or worse", which is 10 times the limit either way.

**Two findings in these numbers that bear on issue 1966.**

The first is that main-content time on real visits does not line up with that issue's lab
measurements, in both directions. `/money/committees` measures 46 ms here against about
1.8 s warm in the lab, and `/money/outside-spending` and `/money/search`, the 2 addresses
that issue records as returning head only, measure 160 ms and 300 ms, faster than addresses
that do ship a server-rendered snapshot. The 2 methods are timing different moments and the
release limit is about this one, so the gap is worth settling before that issue's first or
third acceptance criterion is reported as met. What causes it is not established here.

The second is that unexpected layout movement is the failure no acceptance criterion on
that issue targets: 6 of 9 addresses sit at or over 1, against a limit of 0.1. That issue's
own account of the wait names the moment, "the app boots and clears the snapshot", so its
second criterion, handing each page's server-read records to the app so it draws them
without a second fetch, is the change most likely to move the number.

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
that vendor's page. Every figure was read from Cloudflare rather than computed here, except
the conversion from microseconds to milliseconds and the withholding of percentiles under 50
measurements.

Decisions this drove: [PR #643](https://github.com/alethical-org/alethical/pull/643) closed
as superseded, and [PR #1974](https://github.com/alethical-org/alethical/pull/1974) added
the per-address read. The living record of how the measurement works is
[`docs/product-onboarding/traffic-guide.md`](../product-onboarding/traffic-guide.md), not
this file.
