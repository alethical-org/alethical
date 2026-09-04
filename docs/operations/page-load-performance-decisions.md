<!-- describes: apps/frontend/App.tsx, apps/frontend/package.json, vercel.json, apps/frontend/src/data/api.ts, apps/frontend/src/lib/appQueryClient.ts, apps/frontend/src/lib/billFreshness.ts, apps/frontend/src/navigation/RootNavigator.tsx, apps/frontend/src/providers/AppProviders.tsx, apps/frontend/src/providers/AuthProvider.tsx, apps/frontend/src/screens/redesign/AskAnswerScreen.tsx, apps/frontend/src/screens/redesign/LegislatorProfileMobileScreen.tsx, alethical/api/routers/ask.py, alethical/api/routers/public.py, api/page.ts, .github/workflows/warm-money-pages.yml -->

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
| Cloudflare, campaign-money reads | `public, max-age=300, stale-while-revalidate=86400, stale-if-error=604800` | `MONEY_RECORDS_CACHE_CONTROL`, same file, routed by `MONEY_PATH_SEGMENT` in `alethical/api/main.py` |
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

**Caching is what hides the origin cost; it is not the cure.** The origin is
consistently slow rather than slow only when cold: forced cache misses on
4 Sep 2026 returned 2.91 / 2.75 / 2.73 s for `/campaign-finance/outside-spending`
across 3 runs, while `/readyz` answered in 0.17-0.19 s, so the server is awake and
the database work is the cost. Making those answers fast is separate work under
[#1966](https://github.com/alethical-org/alethical/issues/1966).

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

**How low this can go, measured rather than guessed.** Taking every movable thing out of the
program every page needs — the sign-in client and screens, the bill-page formatting, the text
of the published pieces, the committee-money display code — leaves 1,213,637 bytes of the
1,588,478 the program holds, which is 333,927 bytes rather than 430,493 once compressed the
way production compresses. Applied to the file a release actually ships that is about 324,000,
and with the shared file, the runtime and a screen file a money page's floor is near 366,000
bytes, so **the 300,000-byte target on
[#1966](https://github.com/alethical-org/alethical/issues/1966) is not reachable by loading
things later.** What is left below that floor is the framework the whole app is built
on: `react-native-web` 249,244 minified bytes, `react-dom` 178,881, React Navigation about
158,000, the query library 79,724 and `react-native-svg` 47,415. Reaching 300,000 would mean
changing that foundation, not deferring more of our own code.
[#1976](https://github.com/alethical-org/alethical/issues/1976) owns the movable part.

The 2 costs, both accepted:

- **A first visit waits for its screen file after the program lands.** The app does not
  draw until that file arrives, so the server's readable text stays up rather than being
  replaced by an empty box, and the wait replaces part of a longer wait rather than adding
  to it.
- **A later click waits for a screen nobody has downloaded yet.** These files are small,
  and warming the next screen on hover is a separate item on
  [#1966](https://github.com/alethical-org/alethical/issues/1966).

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
