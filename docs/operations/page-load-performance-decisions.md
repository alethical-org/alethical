<!-- describes: apps/frontend/App.tsx, apps/frontend/package.json, vercel.json, apps/frontend/src/data/api.ts, apps/frontend/src/lib/appQueryClient.ts, apps/frontend/src/lib/billFreshness.ts, apps/frontend/src/navigation/RootNavigator.tsx, apps/frontend/src/providers/AppProviders.tsx, apps/frontend/src/providers/AuthProvider.tsx, apps/frontend/src/screens/redesign/AskAnswerScreen.tsx, apps/frontend/src/screens/redesign/LegislatorProfileMobileScreen.tsx, alethical/api/routers/ask.py, alethical/api/routers/public.py, alethical/api/services/outside_spending.py, alethical/api/services/campaign_finance_races.py, alethical/api/services/committee_finance.py, alethical/api/services/campaign_finance_search.py, alethical/pipeline/campaign_finance_filings.py, api/page.ts, .github/workflows/warm-money-pages.yml -->

# Page-load performance decisions

**Net:** Improve the shared first download and the saved Ask path without changing what readers see or how current the record is. Keep every option that delays another click, risks stale data, or depends on experimental routing out of the automatic safe-work lane.

## Priority order

Reliability comes first: every public page and deep link must load on its first attempt without a refresh. After that, reduce the work before useful content appears.

The Aug 7, 2026 production audit found:

- The shared website program was about 1.97 MB before compression and about 510 KB over its live Brotli path.
- A high-quality local Brotli build of the same program was about 401 KB.
- The saved SF 334 answer became readable in about 610 ms with the website program already saved by the browser.
- The saved-answer server request took 363 to 438 ms, then the page requested bill detail, votes, and structured text.
- A cold phone legislator profile requested 100 chief-authored bills, about 47 KB, and the request took about 1.56 seconds.
- Cached public reads commonly took 60 to 90 ms; uncached reads commonly took 500 to 1,600 ms.

Each release issue records a fresh before-and-after measurement because the shared file changes whenever `main` changes.

## Current record freshness

The website treats a public read as fresh for 5 minutes. After that window, returning to the browser tab or reconnecting to the network rechecks every active read that can show a saved bill record: bill detail, votes, bill text, bill lists, legislator bill lists, featured cards, tracked bills, and saved Ask suggestions. The update replaces data in place, so the selected URL tab and the reader's scroll position stay put. React Query shares an in-flight request for one key, so a burst of return signals cannot start duplicate reads.

A free-form Ask is the exception. Its request can generate paid prose, so focus and reconnect never repeat it. The prose remains the answer originally served, while one read-only featured-bills request refreshes the bill cards it displays. The query-root list, the 5-minute gate, burst sharing, and the free-form Ask exception are enforced by `apps/frontend/src/lib/__tests__/billFreshness.test.ts` and `apps/frontend/src/lib/__tests__/appQueryClient.test.ts`.

## Safe work with no intended reader tradeoff

| Order | Work | Why it is safe | Tracker |
|---:|---|---|---|
| 1 | Read an existing public suggested answer through a cacheable, self-contained address | A miss never generates, reader-written questions never enter the path, and citations stay unchanged | [#1230](https://github.com/alethical-org/alethical/issues/1230) |
| 2 | Send a smaller shared program and discover the existing fonts earlier | The design and behavior stay fixed; browser and route checks must prove file delivery before release | [#1231](https://github.com/alethical-org/alethical/issues/1231) |
| 3 | Keep phone-only sign-in code out of the website build | Sign-in timing and behavior stay fixed; the web build only stops carrying unused phone tools | [#1232](https://github.com/alethical-org/alethical/issues/1232) |

## How long a nearby cache holds a public read

A reader is never the one who waits on a cold read. There are 2 windows, because
the records behind them change at genuinely different rates.

| Layer | Header | Where it is set |
|---|---|---|
| Cloudflare, bill / vote / legislator reads | `public, max-age=60, stale-while-revalidate=300` | `PUBLIC_CACHE_CONTROL` in `alethical/api/routers/public.py` |
| Cloudflare, campaign-money record reads | `public, max-age=300, stale-while-revalidate=86400, stale-if-error=604800` | `MONEY_RECORDS_CACHE_CONTROL`, same file, chosen by `public_cache_control_for_path` |
| Vercel, in front of the page HTML | `public, max-age=0, s-maxage=300, stale-while-revalidate=300, stale-if-error=300` | `OK_CACHE` in `api/page.ts` |

**Bill, vote and legislator reads keep the short window, and campaign money
gets the longer one.** The 2 differ because the records behind them change at
genuinely different rates. `.github/workflows/vote-backfill.yml` re-reads and
writes votes every day at 09:00 UTC, so bill and vote records change daily; a
long stale window there would hand a reader a week-old bill status, the harm
[`.claude/rules/grounded-answers.md`](../../.claude/rules/grounded-answers.md)
rule 7 names. A campaign-money load is human-triggered and on no schedule, and
production's snapshot was dated 2026-08-12 when this was measured on 4 Sep 2026,
23 days old. One window set from the money cadence and applied to both was wrong
for bill reads, which is why the middleware now routes on the path.

**A money read that names a person keeps the SHORT window, and this is the line
that matters most here.** The longer window covers the campaign-money record
routes under `/api/v1/campaign-finance/` and nothing else. 2 money reads are not
dated dollar figures but statements about a named member, and both stay short:

| Read | Why it is not a plain figure |
|---|---|
| `/api/v1/legislators/{id}/campaign-finance` | the member's own money, resting on a confirmed link |
| `/api/v1/committees/{registration_number}/finance` | returns `confirmed_for`, naming the confirmed member |

A confirmation can be taken back. `withdrawn` is a real third decision state with
its own `withdrawn_at`, `withdrawal_reason` and `withdrawn_by`
(`alethical/db/models.py`;
[`docs/architecture/campaign-finance-system-design.md`](../architecture/campaign-finance-system-design.md)
§5.1), and someone withdraws one precisely when money was attached to the **wrong**
legislator. A held copy would keep naming that person for as long as the window
allowed, which is an identity error rather than an out-of-date figure, and
[`.claude/rules/grounded-answers.md`](../../.claude/rules/grounded-answers.md)
rule 3 is what it would break.

Those 2 were found by asking which handlers read the confirmed link, not by
reading path shapes: `confirmed_for` and `link_state` appear in those 2 routes and
nowhere else. Both already sit outside the prefix, so neither needs an exception.
Classifying every remaining route by what its answer contains is
[#1985](https://github.com/alethical-org/alethical/issues/1985).

**Only `stale-while-revalidate` is long, and that is the whole design** — on the
API side. Inside `max-age` or `s-maxage` the cache answers without asking the
origin, so lengthening those genuinely delays an update. Inside
`stale-while-revalidate` the cache answers *instantly from the copy it already
holds* and refreshes behind the reader, so lengthening it removes waiting and delays
nothing beyond a single reader seeing one generation of data while that refresh
runs. `stale-if-error` means an origin blip serves the last good copy instead of an
error page.

**The page HTML's stale window is 5 minutes, not a week, and the reason is that it
is now a data freshness window.** Since [#1966](https://github.com/alethical-org/alethical/issues/1966)
criterion 2 the page response carries the records it read, not only the markup
(§23 of
[`docs/architecture/page-metadata-for-search-and-sharing-decisions.md`](../architecture/page-metadata-for-search-and-sharing-decisions.md)),
so a held copy freezes those records with it. "One generation of data while the
refresh runs" is an acceptable price for a figure that carries its own date. It is
not acceptable for a **withdrawn** committee-to-legislator link: a person withdraws
one exactly when money was attached to the wrong named member, and it is a designed
path with its own state and stored reason
([`docs/architecture/campaign-finance-system-design.md`](../architecture/campaign-finance-system-design.md)
§5.1). That is an identity error, and
[`.claude/rules/grounded-answers.md`](../../.claude/rules/grounded-answers.md) rule 3
is what a held copy would break, by keeping a page asserting a relationship between
a named person and money that nobody stands behind any more. It is live rather than
theoretical: all 200 sitting members had a confirmed committee on 4 Sep 2026, and
`GET /api/v1/committees/{registration_number}/finance` returns that person in
`confirmed_for`, which the served committee page prints.

**All 3 of the page's windows are 5 minutes, and each one has to be**, which is why
the header carries no long value at all:

- `s-maxage` is the floor and the only one that matters on its own. Inside it Vercel
  answers from what it holds and does not call the function, so shortening a stale
  window while leaving an hour here shortens nothing a reader experiences.
- `stale-while-revalidate` is served while a refresh runs behind the reader.
- `stale-if-error` is served when the function cannot answer. The harm does not care
  why an old copy is handed out: a week-old page attaches money to the wrong person
  exactly as wrongly during an outage as outside one. §7's own permission to keep
  "older and labelled" figures through a failure is real and covers a response of
  dated figures; a money page carries an identity too, and a mixed response takes
  the shorter rule.

So the worst a reader can be shown is a copy generated **10 minutes** ago, on every
path including an outage. The cost is real and named: outside those windows a reader
waits for the page function, and past them an outage returns the handler's own 503
instead of a dated page.

**Nothing clears a held page copy when a record changes**, which is why the window
length is the whole protection rather than a backstop. Vercel clears these on a
deployment and a campaign-money import makes no deployment; the warming job is a set
of GETs, which a held address answers from what it holds. Splitting the page rule by
what each address actually contains is
[issue 1985](https://github.com/alethical-org/alethical/issues/1985), and a short
window is safe with no such classification at all.

**Every window here is capped because nothing clears a held copy when a load
lands.** 4 events can move a money answer: a new campaign-money download release,
a new filed-totals or registered-filer release, a committee-to-legislator link
being confirmed, and one being withdrawn. None purges a cache today, so each cap
is what we accept being wrong by with no clearing at all. They go back to a week
only once clearing is proven for all 4
([#1979](https://github.com/alethical-org/alethical/issues/1979)), which is a
measurement rather than a judgement call.

**And proving it lifts the cap only where a response names nobody.** Clearing is
what stops a *stale* copy; the reason a response that can name a person is capped
is what happens in the window before a correction has propagated. So a
pure-figures route can lengthen once clearing is proven, and
`committees/{registration_number}/finance` (which returns `confirmed_for`),
`legislators/{id}/campaign-finance` and every page the page function serves cannot.
The rule and where each side currently sits are in §23 of
[`docs/architecture/page-metadata-for-search-and-sharing-decisions.md`](../architecture/page-metadata-for-search-and-sharing-decisions.md).

**What a cache window does and does not touch.** Every money page prints `as_of`,
read off the loaded snapshot's `fetch_completed_at`
(`alethical/api/services/campaign_finance_register.py::_snapshot_date`) and
carried inside the payload, so a cached copy prints the day its own records were
copied. A stale answer therefore stays honestly dated. That is not a reason a
stale answer is acceptable: an old figure with a truthful old date is still an
old figure, which is why the window is capped above rather than excused by the
date.

**A deployment resets Vercel's page cache whatever the header says**, so
`.github/workflows/warm-money-pages.yml` re-reads the money addresses after each
successful production release and once a day as a floor. Production releases come
from Vercel's own Git connection rather than from
`.github/workflows/vercel-deploy.yml`, which is hand-run only; that connection
posts a GitHub deployment, which is the `deployment_status` hook the warmer
listens on. A GitHub runner warms whichever edge location it reaches rather than
every location worldwide, so the long window is what keeps a location warm once
any reader has touched it and the job covers the release reset and a quiet day.

**Warming is not clearing.** The job sends ordinary GETs, and a GET against a
held-but-stale address is answered *from* the held copy rather than replacing it.
So warming makes a first reader fast and does nothing whatever about a corrected
record. Nothing in the daily schedule counts toward the clearing story above.

**Cloudflare holds a separate copy per edge server, so an occasional slow read
survives all of this and is not a fault.** Measured 4 Sep 2026: 4 reads of
`/campaign-finance/outside-spending` seconds apart from one machine all returned
`HIT` with ages of 16, 72, 23 and 26 seconds, which is 4 stored copies on 4
servers rather than 1 copy ageing. A read that lands on a server holding no copy
still pays the origin, measured at 2816 ms in the same session while other money
addresses were answering in 100-180 ms. A cache window governs how long each
server keeps a copy it already has; it cannot put one on a server that has never
served that address.

The practical reading: where a copy exists a money read costs 0.10-0.23 s against
2.8-2.9 s at the origin, and that is what this buys. It is not a guarantee that
no reader ever waits, and a measurement that treats a single synthetic address as
proof of retention is measuring which server it landed on as much as the window.

**Caching hides an origin cost; it does not remove one, so the origin gets fixed
too.** A forced cache miss is what a reader waits for whenever an edge has served
nobody inside the window, and on 4 Sep 2026 that was 2.91 / 2.75 / 2.73 s across 3
runs of `/campaign-finance/outside-spending` while `/readyz` answered in 0.17-0.19 s
from the same container: the server was awake and the database work was the whole of
it. Narrowing those reads for
[#1966](https://github.com/alethical-org/alethical/issues/1966) brought the same
forced miss to 0.46 s on 7 Sep 2026, against a health check of 0.16 s on the same
run, so what a reader now waits for on a miss is 0.30 s of money work rather than
2.6 s. What that leaves is on **What an uncached money answer spends its time on**
below.

Measured before and after for
[#1966](https://github.com/alethical-org/alethical/issues/1966) acceptance
criterion 4: cold reads of 2975 / 1265 / 541 ms became 126 / 151 / 100 ms after
sitting idle past the old window, confirmed on 3 probe addresses no other reader
could request so the idle gap was guaranteed rather than assumed.

## Each screen downloads with its own route

Every screen the router can show is downloaded when the router first shows it, and not
before ([#1966](https://github.com/alethical-org/alethical/issues/1966),
[#491](https://github.com/alethical-org/alethical/issues/491)). A page names 3 files in its
HTML — the Expo runtime, a shared file of parts more than 1 screen uses, and the program
every page needs — and the app fetches the screen file for the address it was asked for.
`docs/operations/deployment.md` § What a web release ships owns the mechanics.

Measured on the production build, uncompressed: 1 file of 2,399,276 bytes became a
first-loaded set of 1,715,154 bytes across 3 files, plus a screen file of 11,567 bytes on
`/money/committees`, 13,322 on `/money/races` and 31,432 on `/money/outside-spending`. A
campaign-money reader no longer downloads the bill page (133,346 bytes), the address
lookup (55,866), the traffic dashboard (41,340), the answer page (28,842) or either chat
screen.

**The home page is not drawn under the address a reader asked for.** Every address puts the
home tab beneath itself so the in-app back button has somewhere to go
(`stateFromPathname` in `navigation/webRoutes.ts`), and a stack draws the screens beneath
the top one, so the heaviest screen we have was being downloaded and run under every other
page: 17,736 bytes and the whole marketing page, for a reader who was never going to see it.
`HomeRoute` now draws nothing while it is covered, and draws when a reader goes back to it.

**The sign-in surfaces arrive when somebody opens them.** The dialog and the email-link page
are fetched after the app can draw rather than before
([#1976](https://github.com/alethical-org/alethical/issues/1976)). The dialog is still
rendered on every page, so its open, close and reset behaviour is unchanged; only its arrival
moved. Measured on the production build at the settings Vercel compresses with: a page's 3
named files went from 451,044 bytes to 439,253, so every reader receives 11,791 fewer bytes
before anything can draw.

**Moving code out of the program every page needs usually saves a reader nothing, and this is
the trap to know about before planning any more of it.** A page names 3 files, and 1 of them
is the shared file holding parts that more than 1 screen uses. Code taken out of the main
program does not leave the first load; it lands in that shared file, which every page
downloads too. Two measurements, both on the production build:

- Taking the committee-money library out of the router's reach, which counting source bytes
  said was worth 5,697, saved **21 bytes**: the main program lost 32 and the shared file
  gained 11.
- The sign-in change above was worth 65,896 by the same counting method. The main program
  lost 36,680 and the shared file gained 24,889, so a reader received **11,791** fewer.

So a saving is only real when the code ends up somewhere a reader does not always fetch,
which means being wanted by exactly 1 screen. Counting bytes in the main program measures
where code sits, never what a reader downloads. **The way to tell the difference is to build
it and read the 3 named files**, which is what `apps/frontend/scripts/check-first-load-budget.mjs`
reports on every build.

**How low this can go, measured rather than guessed.** Counting every movable thing out of the
program every page needs gives about 324,000 bytes for that file, and with the shared file, the
runtime and a screen file a money page's floor is near 366,000, so **the 300,000-byte target on
[#1966](https://github.com/alethical-org/alethical/issues/1966) is not reachable by loading
things later.** Read that floor as the best case if every one of those moves also escaped the
shared file, which the 2 measurements above say most of them will not. What is left below the
floor is the framework the whole app is built on: `react-native-web` 249,244 minified bytes,
`react-dom` 178,881, React Navigation about 158,000, the query library 79,724 and
`react-native-svg` 47,415. Reaching 300,000 would mean changing that foundation, not deferring
more of our own code.
[#1976](https://github.com/alethical-org/alethical/issues/1976) owns what is left of the
movable part, which after the sign-in change is much smaller than counting source bytes
suggests.

The 2 costs, both accepted:

- **A first visit waits for its screen file after the program lands.** The app does not
  draw until that file arrives, so the server's readable text stays up rather than being
  replaced by an empty box, and the wait replaces part of a longer wait rather than adding
  to it.
- **A later click waits for a screen nobody has downloaded yet.** These files are small,
  and warming the next screen on hover is a separate item on
  [#1966](https://github.com/alethical-org/alethical/issues/1966).

## What a search page's first response carries

`/bills` and `/legislators` are served with the small reads their own controls need
already made, so the app draws those controls at its first paint rather than after a read
of its own: the issue buttons, the session dropdown's list, and the date under the result
count (`searchControlSeeds` in `api/page.ts`, keyed and pathed through
`apps/frontend/src/lib/searchPageReads.ts`). About 2 KB together, read alongside the list
read rather than after it, and each separately optional, so one that fails leaves the app
to make it and takes nothing else down with it.

**The list itself is not carried.** The app's bill cards need the full record for each
bill: 243 KB against the 3.8 KB the page function reads to build the served text, and a
cold read of 1.66 s against 0.63 s (measured 7 Sep 2026). Carrying it would move a wait
from after the page appears to before it. The placeholder rows already hold the list's
space, so the list arriving moves nothing.

**A count nobody has been told yet prints as a blank line of the same height, never as 0**
(`resultCountLine` in `apps/frontend/src/lib/resultCount.ts`). A verified zero still
prints `0`. Both search pages printed "0 bills" and "0 legislators" for the length of
their list read, which is a statement about Minnesota's records that is not true, and on a
failed load it sat directly above "We couldn't load bills right now".

Measured for [#1996](https://github.com/alethical-org/alethical/issues/1996) on 7 Sep 2026,
2 local production-like builds each served behind the real page function against the live
data service, cold browser per address. The baseline reproduces the live figures, which is
what makes the comparison worth reading.

| Address | Width | Before | After | Live before |
|---|---|---:|---:|---:|
| `/bills` | 390x844 | 0.2636 | 0.0000 | 0.2911 |
| `/legislators` | 390x844 | 0.0828 | 0.0016 | 0.0833 |
| `/bills` | 1280x900 | 0.0357 | 0.0000 | 0.0360 |
| `/legislators` | 1280x900 | 0.0008 | 0.0007 | 0.0008 |

Against Google's passing mark of 0.1. `/bills` was the worst address on the site.

**A seeded read is proved by the request that no longer happens.** A key built on one side
and written out on the other seeds nothing while the page still works, so the mistake is
invisible in every screenshot and every test of what the page draws. What settles it is
the browser's own request list: `/bills` made 4 data-service reads and now makes 1.

## What an uncached money answer spends its time on

A cache decides how often a reader waits. This decides how long that reader waits when
they do, and it is measured at the direct origin
(`https://alethical-api-production.up.railway.app`) with a unique query value on every
request, so no cache can answer.

**Read the query plan before blaming the distance to the database.** The API runs on
Railway in `us-east4-eqdc4a` and the database is Supabase's `us-east-2` pooler, so a
request that asks 11 questions pays that distance 11 times, and that is the shape a
slow route is expected to have. It was not the shape of these routes: measured for
[#1966](https://github.com/alethical-org/alethical/issues/1966) on 4 Sep 2026,
`/campaign-finance/outside-spending` answered in 2,787 ms while `EXPLAIN ANALYZE` put
2,761 ms of it inside 2 statements. Fixing the 2 statements saved 2.6 seconds and
removing 7 of the trips would have saved about 0.3 of one, so the plan came first.

**Then the distance is what is left, and it is about 35 ms a question.** Once a route
stops asking a wasteful question, its remaining time is very nearly its statement count
times that figure. Measured 7 Sep 2026 against the live database, warm, best of 3:
`/committees/{n}/finance` spends 359 ms on 11 statements of which about 50 ms is work,
and an office-filtered `/campaign-finance/races` spends 324 ms on 9 of which about 76 ms
is work. So on a route already asking only what it needs, a saved question is worth
roughly what a saved question costs, and the 2 questions worth removing first are the
ones every money read repeats: which register is live, and how many rows a list holds
beside the rows themselves.

**Four costs, each measured, each with a rule that follows from it.**

| What cost the time | Measured on the live release | The rule |
|---|---|---|
| `initcap(trim(...))` on every row, 4 times over | ~300 ms per pass over 41,130 rows, so ~1.2 s of one answer | Group on the column's own text first and tidy the handful of values the grouping leaves |
| `count(DISTINCT <expression>)` | 1.4 s for 2 of them over the same 41,130 rows; Postgres sorts for each | Count a `GROUP BY` instead, which hashes: the same 2 counts cost 43 ms |
| Asking a per-row question about a per-committee fact | 1.3 s to test 41,130 rows for linkability, 30 ms to test the 1,131 committees they name | Reduce to the distinct subjects before the question that is about subjects |
| Reading every filing in Minnesota to answer about a few committees | 55,845 figure rows returned, built twice per committee page | `campaign_finance_filings.reported_totals_for` for a read; `filings_context` is the loader's own sweep |
| Asking a 1-row question in 2 requests | resolving the live register read the pointer and then the snapshot it names, on every money read and twice on 4 of them | Join the pointer to what it names, so the answer costs 1 request; `campaign_finance_filings.live_filings_snapshot` |
| Asking for a list and its length separately | 2 walks of one matched set, 1 round trip apart | Carry the count on the rows with a window, as `campaign_finance_search` does for members |

**A statement count is a test and a time is not.** A seeded test database holds a few
rows on the same machine as the tests, so it cannot reproduce the distance to the
database and a wall-clock assertion there measures the laptop. What
`alethical/tests/test_money_read_costs.py` asserts instead is the *shape* of each
read: that a committee request never calls the statewide sweep, that an office-filtered
race page passes only that office's committees, and that the outside-spending record is
read in one request. Times live in the pull request and on the issue, measured against
production.

**What search still costs, and why no query shape fixes it.** `/campaign-finance/search`
is the one money read still far above 0.3 s: 0.62 s to 1.51 s at the direct origin on
7 Sep 2026, depending on what was typed. Nearly all of it is 1 question asked 3 times,
once per download: how many distinct names carry this string, counted up to 200.
Postgres answers it by walking the name index alphabetically and stopping at 200 names,
which is instant for a common fragment and slow for a rare one, because a rare one is
only confirmed by walking to the end of the alphabet: 838 ms for "education" against
39 ms for "smith". Gathering the match set through the trigram index instead reverses
which strings are slow rather than removing the slowness -- 19 ms for "education" and
374 ms for "mar" -- so it is not taken, and the full measured table sits beside
`COUNTED_UP_TO` in `alethical/api/services/campaign_finance_search.py`. The shape that
is cheap in both directions is a per-release list of the distinct names with their
counts: 131,510 names against the 1,002,326 payment rows they are read from. That is a
second copy of a fact, so it waits on a decision rather than on evidence.

**The one narrowing that must stay statewide is a coverage question.** Whether the
contributions download holds any row at all for a year decides whether a committee with
no rows is silent or beyond our copy (`.claude/rules/grounded-answers.md` rule 12).
Asked of the listed committees alone, a race page with no rows in an open year would
read "we have nothing for this year" instead of "nobody has filed yet", so that
question keeps the whole download as its subject and rides in the same statement.

## Remaining options with a real tradeoff or open proof gap

| Option | Benefit | Tradeoff or proof gap | Decision |
|---|---|---|---|
| Send useful page content in the first HTML response | Removes the empty-page wait on cold primary pages and deep links | The separate public serving path now covers records, Home, Find My Legislator, Bills, and Legislators; the full navigation rebuild remains larger | Shipped narrowly through [#1396](https://github.com/alethical-org/alethical/issues/1396); keep [#502](https://github.com/alethical-org/alethical/issues/502) for the broader rebuild |
| Load 2 chief-authored bills first on phone profiles | Avoids the measured 47 KB, 1.56-second cold request | “Show all” would start a later request and make that click wait | Do not ship as no-tradeoff work |
| Replace Space Grotesk or JetBrains Mono | Could remove about 13 to 44 KB of font downloads on pages using them | Changes the logo or code-like visual style | Do not treat as performance-only work |
| Remove screens that web links currently redirect away from | Removes about 5 KB from the website program | Some screens still support phone or signed-in flows, including the working chat room that currently lacks a public door | Do not call this dead code without a capability decision |
| Skip rendering off-screen bill text | Can help unusually large bills | Can break section jumps, browser search, and accessibility; the measured sample was only 477 elements | Reconsider only after a real large-bill trace shows rendering is the bottleneck |

## Release proof

A safe page-load release is done only when:

- every required public page type loads directly on phone and desktop with 0 browser errors;
- old shared links still work;
- sign-in, session restore, citations, and current record fields are unchanged;
- the current production file or request count is smaller by direct measurement; and
- the live release passes after the merge, not only in a local build.

**A guard that has never been seen to fail is not known to work, and the only way
to find out is to break the code on purpose and watch.** Both failures below
printed a pass, and neither was catchable by reading the guard:

- A test written for the cache-window rule asserted a fact about a string
  constant rather than about the middleware, so restoring the exact bug it
  existed for still passed it. The repair was to extract the decision into a
  named function the test could drive with real paths
  (`public_cache_control_for_path`), never to loosen the test.
- A build check compressed files differently from production, so it certified a
  size limit the real release was failing.

So a new guard is finished only once the change it forbids has been made,
the guard has been seen to fail, and the change has been reverted. Reviewing
2 people over a guard's source does not substitute: both of the above were
reviewed and neither reader could have seen it, because the guard's text looks
correct and only its reach is wrong.
