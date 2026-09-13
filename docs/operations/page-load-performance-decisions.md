<!-- describes: .github/workflows/production-release-failed.yml, apps/frontend/App.tsx, apps/frontend/package.json, vercel.json, apps/frontend/src/data/api.ts, apps/frontend/src/lib/appQueryClient.ts, apps/frontend/src/lib/billFreshness.ts, apps/frontend/src/navigation/RootNavigator.tsx, apps/frontend/src/providers/AppProviders.tsx, apps/frontend/src/providers/AuthProvider.tsx, apps/frontend/src/screens/redesign/AskAnswerScreen.tsx, apps/frontend/src/screens/redesign/LegislatorProfileMobileScreen.tsx, alethical/api/routers/ask.py, alethical/api/routers/public.py, alethical/api/services/outside_spending.py, alethical/api/services/campaign_finance_races.py, alethical/api/services/committee_finance.py, alethical/api/services/campaign_finance_search.py, alethical/pipeline/campaign_finance_filings.py, api/page.ts, .github/workflows/warm-money-pages.yml, apps/frontend/src/providers/AuthProvider.web.tsx, apps/frontend/src/providers/SignInModalProvider.tsx, apps/frontend/src/providers/SignInMachinery.tsx, apps/frontend/src/lib/auth/loadSignInBundle.ts, apps/frontend/src/lib/auth/signInBundle.ts, apps/frontend/src/lib/auth/signInWorkPending.ts, apps/frontend/src/lib/supabaseConfig.ts, apps/frontend/src/components/auth/accountControls.tsx, apps/frontend/scripts/check-first-load-budget.mjs, apps/frontend/scripts/report-page-load-stages.mjs, apps/frontend/src/lib/currentClaimFreshness.ts, apps/frontend/src/lib/pageData.ts, apps/frontend/src/hooks/useCurrentClaimExpiry.ts, alethical/api/main.py, scripts/report_origin_share_by_address.py, apps/frontend/src/lib/committeeConfirmation.ts -->

<!-- describes: apps/frontend/metro.config.js, patches/@expo__metro-config@57.0.7.patch, pnpm-workspace.yaml, pnpm-lock.yaml, apps/frontend/scripts/__tests__/sharedScreenChunks.test.ts, apps/frontend/src/lib/committeeMoney.ts, apps/frontend/src/lib/committeePaymentsPage.ts, apps/frontend/src/lib/committeeMoneyShared.ts, apps/frontend/src/components/campaignMoney/MoneyDetailsBundle.ts, apps/frontend/src/components/campaignMoney/MoneyDetailsOnDemand.tsx, apps/frontend/src/lib/committeeOutsideSpending.ts -->

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

Each release issue records a fresh before-and-after measurement because the startup program changes whenever `main` changes.

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
| Cloudflare, the 5 named campaign-money record reads and explicit dated-only committee finance | `public, max-age=300, stale-while-revalidate=86400, stale-if-error=604800` | `MONEY_RECORDS_CACHE_CONTROL`, same file, granted to `MONEY_RECORD_PATHS` by `public_cache_control_for_path`, and by the finance handler only after a successful anonymous `GET` with `include_confirmation=false` |
| Vercel, in front of the page HTML | `public, max-age=0, s-maxage=300, stale-while-revalidate=300, stale-if-error=300` | `OK_CACHE` in `api/page.ts` |

**Bill, vote and legislator reads keep the short window. The 5 named
campaign-money record reads and explicit dated-only committee finance get the longer
one.** The 2 differ because the records behind them change at genuinely different rates.
`.github/workflows/vote-backfill.yml` re-reads and writes votes every day at 09:00
UTC, so bill and vote records change daily; a long stale window there would hand a
reader a week-old bill status, the harm
[`.claude/rules/grounded-answers.md`](../../.claude/rules/grounded-answers.md)
rule 7 names. A campaign-money load is human-triggered and on no schedule, and
production's snapshot was dated 2026-08-12 when this was measured on 4 Sep 2026,
23 days old. One window set from the money cadence and applied to both was wrong
for bill reads.

**The 5 paths are named one at a time, and the shape of an address grants nothing.**
The finance path remains short by default for compatible mixed responses. Only its
explicit `include_confirmation=false` variant can receive the dated window, after a
successful anonymous `GET`. An unclassified route, an authorized request or a failed
read never gains that window from a query parameter alone.

| Long window | Short window |
|---|---|
| `/api/v1/campaign-finance/committees` | `/api/v1/campaign-finance/search` |
| `/api/v1/campaign-finance/filings` | `/api/v1/campaign-finance/summary` |
| `/api/v1/campaign-finance/outside-spending` | `/api/v1/legislators/{id}/campaign-finance` |
| `/api/v1/campaign-finance/payments-under-name` | `/api/v1/committees/{registration_number}/finance` |
| `/api/v1/campaign-finance/races` | `/api/v1/committees/{registration_number}/confirmation` |
| `/api/v1/committees/{registration_number}/finance?year=2025&include_confirmation=false` | every other public read |

**The test is what an answer CLAIMS, never whether it names a person.** A person's
name printed inside an accepted filing is a dated record: the filing happened, its
date is on it, and no later event makes yesterday's copy of it false. Two kinds of
claim may not be held that long, and both change with no money load involved:

| Claim | Where it is served | What moves it |
|---|---|---|
| somebody currently holds an office (`chamber`, `district_code`, `party`) | `/campaign-finance/search`, and `sitting_member_count` on `/campaign-finance/summary` | an election, a resignation |
| a committee currently belongs to a named member (`confirmed_for`, `link_state`) | `/legislators/{id}/campaign-finance`, `/committees/{registration_number}/confirmation`, the compatible mixed `/finance` answer, and `confirmed_member_count` on `/campaign-finance/summary` | a confirmation, or one taken back |

A confirmation can be taken back. `withdrawn` is a real third decision state with
its own `withdrawn_at`, `withdrawal_reason` and `withdrawn_by`
(`alethical/db/models.py`;
[`docs/architecture/campaign-finance-system-design.md`](../architecture/campaign-finance-system-design.md)
§5.1), and someone withdraws one precisely when money was attached to the **wrong**
legislator. A held copy would keep naming that person for as long as the window
allowed, which is an identity error rather than an out-of-date figure, and
[`.claude/rules/grounded-answers.md`](../../.claude/rules/grounded-answers.md)
rule 3 is what it would break.

Evidence, 7 Sep 2026: while an address prefix granted the long window, the money
search and the money summary held it, and neither is a dated record. Read live,
the search answered with Jim Abeler as senate, district 35, party R, on a window
allowing a saved copy to repeat that for a day, and for a week while our own
service is unavailable. Nothing establishes that a reader was handed a stale
office; what is established is that nothing bounded how old one could get
([#1985](https://github.com/alethical-org/alethical/issues/1985)).

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
the mixed `GET /api/v1/committees/{registration_number}/finance` answer carried that
person in `confirmed_for`. The committee HTML now reads that claim independently
from `/confirmation`; separating the API reads does not lengthen the HTML window.

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

So the worst **page copy** a reader can be handed was generated **10 minutes** ago,
on every path including an outage. That bounds this hop and not what a reader sees:
the answer inside that page had already aged in the API's own cache before the page
was built, and until the deadline below existed the app then held it indefinitely.
The end-to-end figure is 20 minutes and it is set out under "How old a current claim
can be, end to end". The cost of this hop is real and named: outside those windows a
reader waits for the page function, and past them an outage returns the handler's own
503 instead of a dated page.

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

**The clearing step exists in code and is switched off**
(`alethical/pipeline/cache_purge.py`). It decides which saved copies each of those
events makes false, and asks Cloudflare to discard exactly those, by prefix rather
than by address -- a money answer's address carries a query string and
purge-by-prefix discards every copy under a path whatever its query string. All 5
Cloudflare purge methods are on every plan including Free
([Cloudflare, 1 April 2025](https://developers.cloudflare.com/changelog/post/2025-04-01-purge-for-all/)),
and the limits that bind are 100 prefixes per request and 5 requests a minute.

A purge leaves the process only when **both** of these hold, and neither holds
today: a Cloudflare token carrying the **Cache Purge** permission on the
`alethical.com` zone (`CLOUDFLARE_API_TOKEN` plus `CLOUDFLARE_ZONE_ID`), **and**
`ALETHICAL_CLEAR_SAVED_ANSWERS=on`. Two conditions rather than one, so a token
turning up in an environment for another reason cannot start purging by itself.
Unarmed, each load and each review sitting prints the exact prefixes it would have
cleared and carries on. **A window lengthens on a measured purge and never on the
existence of purge code**, which is the whole reason the caps above are still caps.

**A clearing that is armed and fails is loud and never silent.** It prints a banner
naming the prefixes still being served and makes the command exit non-zero, and it
never undoes the publish or the decision -- the new state is correct and live, and
what failed is the step that tells Cloudflare to stop handing out the old one. A
clearing that failed quietly would be worse than none, because it would justify a
longer window it is not earning.

**A load clears twice, because the verdicts land about 72 minutes after the
figures.** A publish re-runs both money checks against what it just published, and
those write the `stated_split_state` and `money_out.stated_spending_state` a
committee page serves. Clearing only at publish time would replace a stale copy with
a fresh copy saying nobody compared this committee's figures. So the events are 5
rather than the 4 listed above.

**And proving it lifts the cap only where a response names nobody.** Clearing is
what stops a *stale* copy; the reason a response that can name a person is capped
is what happens in the window before a correction has propagated. So a
pure-figures route can lengthen once clearing is proven, and
`committees/{registration_number}/confirmation`, its compatible mixed `/finance`
answer (which also returns `confirmed_for`),
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

### How old a current claim can be, end to end

**A cache window bounds one hop. Nothing bounded the total until
[issue 2023](https://github.com/alethical-org/alethical/issues/2023), and the total
was the number that mattered.** Every hop above was short and every hop's own test
passed, and a reader could still be shown a member's name indefinitely: the answer
embedded in a page reached the app's store with no age attached, so the app stamped
it as fetched at first render whatever its real age, and no money read was ever
rechecked afterwards. A reader who left a committee page open was never asked to be
told again.

**The deadline is 20 minutes on a displayed claim about who currently holds office,
or whose committee this currently is.** It lives in
[`apps/frontend/src/lib/currentClaimFreshness.ts`](../../apps/frontend/src/lib/currentClaimFreshness.ts)
as `CURRENT_CLAIM_MAX_AGE_MS`, and it is the sum of the hops rather than a number
chosen beside them:

| Hop | Worst it adds | Set by |
| --- | --- | --- |
| API shared cache, before the page function reads the answer | 6 min | `PUBLIC_CACHE_CONTROL` (`max-age=60` + `stale-while-revalidate=300`) |
| Page cache, before that page reaches a reader | 10 min | `OK_CACHE` in `api/page.ts` (`s-maxage=300` + `stale-while-revalidate=300`) |
| The reader's own browser | 4 min | the remainder, and it is a grace period rather than a working window |

`currentClaimDeadlineFitsTheChain` asserts that sum in a test, so raising a cache
window without raising the deadline fails rather than quietly outliving the figure
published here.

The 4 conceptual current reads are committee confirmation, legislator campaign
finance, campaign-finance name search and campaign-finance summary. Their query
roots are `committee-confirmation`, `legislator-campaign-money`,
`campaign-finance-name-search` and `campaign-finance-summary`. The default mixed
finance endpoint is a compatibility alias for the same current claim, not a fifth
conceptual read. The dated-only finance query is keyed by registration and year;
confirmation is keyed by registration alone. Only a confirmation refresh renews
that committee ownership claim. Changing year or refreshing figures cannot.

**Past the deadline the relationship is withheld and every dated figure stays.**
That split is the whole point: a filing carries the period it covers and the day we
copied it, so §7's "older and labelled beats blank" still governs the money
(`docs/architecture/campaign-finance-system-design.md` §7). A claim that a committee
belongs to a named person carries no such date and goes wrong silently the moment
somebody takes the confirmation back, which is the identity error
[`.claude/rules/grounded-answers.md`](../../.claude/rules/grounded-answers.md) rule 3
exists to prevent. Reaching the deadline asks the service again first, so only a
reader whose recheck cannot complete sees anything withheld.

**A withheld claim gets its own words and never the "nobody has confirmed one"
state.** Those are different facts, and swapping in the second would replace a claim
we cannot vouch for with one that is plainly false. The 2 sentences are
`CONFIRMED_MEMBER_WITHHELD_LINE` and `confirmedCommitteesWithheldLine` in the same
file.

**A validation time is a fourth kind of time on these payloads and is served as a
body field, `current_claim_validated_at`.** Not a header: the page function reads
the body to write a page's first words, and the app's own store never sees a header
at all, so a header alone reaches neither. It is deliberately distinct from
`reported_through` (the period a figure covers), `fetched_at` and `as_of` (the day we
copied a publication from the Board). Only the validation time expires.

**Ages are durations added, never 2 clocks subtracted.** A reader's clock can be
wrong by hours, and `now - validated_at` across 2 machines would then read a stale
claim as fresh, which is the failure the whole mechanism exists to stop. So the
caches report what they added through `Age`: the page function reads it off its own
API response and writes it onto the seeded entry, and the API lists it in
`Access-Control-Expose-Headers` so a browser is allowed to read it on a read the app
makes itself. The app then adds only elapsed time from its own clock. Where `Age` is missing or hidden the app
assumes the worst its window allows, so a header we cannot see costs freshness
rather than honesty.

**What still waits on the clearing key.** Clearing a held copy after a publication, a
confirmation, a withdrawal or an officeholder change needs a Cloudflare token only
the maintainer can create
([issue 1979](https://github.com/alethical-org/alethical/issues/1979)): My Profile →
API Tokens → Create Token → Create Custom Token, permission **Zone → Cache Purge →
Purge**, zone resources **Include → Specific zone → alethical.com**, saved as the
GitHub Actions secret `CLOUDFLARE_API_TOKEN` and as the same name in the production
environment. The zone's own id is on the Cloudflare dashboard's overview page and is
saved as `CLOUDFLARE_ZONE_ID`. Until both exist the deadline is the whole protection
rather than a backstop, which is why it is 20 minutes rather than merely shorter than
a day.

**How a purge is proved, once the token exists.** Read the address twice so a copy is
saved and `Age` is climbing, run the clearing with
`ALETHICAL_CLEAR_SAVED_ANSWERS=on`, then read the same address again and check that
`Age` came back small or absent instead of continuing from where it was. On a cache
hit Cloudflare does send `Age` and it increments correctly -- measured 8 Sep 2026, 8
reads of one live money page at 12, 15, 18, 21, 25, 28, 31 and 34 seconds -- and on a
revalidation it sends no `Age` at all, so a purged address returning no `Age` or a
small one is the signal. Run it once per event, because the prefixes differ per
event, and read back from more than one machine: Cloudflare holds a copy per edge
server, so a read-back from one machine proves less than it looks.

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

**Warming only counts if it saves the copy a browser reads, and until 8 Sep 2026 it
did not.** Cloudflare's default cache identity includes the `Origin` header a
browser attaches when the site asks the API, and the API answers it with
`Vary: Origin`. The warming job and `api/page.ts` sent no such header, so every read
they made saved a copy under a different identity: measured on one address that day,
MISS then HIT with no `Origin`, then MISS again with the browser's. Both now send
`Origin: https://www.alethical.com`, and any origin-share reading taken before that
change describes a cache the warmers were not warming
([issue 2120](https://github.com/alethical-org/alethical/issues/2120);
[`api-cdn-setup.md`](api-cdn-setup.md) holds the measurement table).

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

Screen code is downloaded on demand when the router first needs its screen group
([#1966](https://github.com/alethical-org/alethical/issues/1966),
[#491](https://github.com/alethical-org/alethical/issues/491)). The 13 September local
web export for [issue 2012](https://github.com/alethical-org/alethical/issues/2012)
names 1 `index-*.js` file in its HTML, with the Expo runtime inside it. The app then
fetches the screen files it needs. The earlier production build named 3 files: the
runtime, shared code and entry program. The dated measurements below describe that
earlier shape; the new local result and its tradeoff have their own section below.
`docs/operations/deployment.md` § What a web release ships owns the mechanics.

The `/site-metrics` and `/admin/metrics` screens share 1 on-demand download through
`apps/frontend/src/screens/metricsScreens.ts`. The single import target in
`apps/frontend/src/navigation/screenChunks.ts` keeps their shared report code out of the
initial common download. Opening either route fetches both screens' code, but private
report data still requires the server's administrator permission check.

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

**Everything sign-in arrives when somebody needs it, the client that talks to the sign-in
service included** ([#1976](https://github.com/alethical-org/alethical/issues/1976)). The
section below owns that change and its measurements.

### The 8 September build: 2 screens put a shared part in the first download

In that build, a part 1 screen read was downloaded with that screen and cost a reader
who never opened it nothing. A part 2 or more screens read went into the shared file
every reader downloaded (`__common-*.js`). Measured 8 Sep 2026 with 2 probe modules built
for the purpose: the one imported by 1 screen landed in that screen's own file, and the one
imported by 2 screens landed in `__common-*.js`.

Under that build rule, taking a part out of the program every page needs
(`index-*.js`) bought a reader nothing unless exactly 1 screen was left reading it,
and it could cost. Brotli compresses a file against
the text already in that file, and `__common-*.js` is a sixth the size of `index-*.js`, so the
same part is dearer in the smaller one. Measured 8 Sep 2026 on
[`lib/committeeMoney.ts`](https://github.com/alethical-org/alethical/blob/main/apps/frontend/src/lib/committeeMoney.ts):
5,064 bytes inside `index-*.js`, 6,077 inside `__common-*.js`, for the identical file.

Read a module's cost in the bytes a reader receives, never in the bytes the file holds.
On 8 September, `lib/committeeMoney.ts` was 16,528 bytes of the built program once
minified and 4,997 bytes of what a reader downloaded, because English prose beside more English prose compresses about
3 to 1. A saving quoted from the first number is roughly 3 times the saving there is.

### What every committee page's words cost a reader who opens the homepage

On 8 September 2026, `lib/committeeMoney.ts` held every sentence a committee's money
page could print, and the address table reached it through
[`lib/paymentsUnderName.ts`](https://github.com/alethical-org/alethical/blob/main/apps/frontend/src/lib/paymentsUnderName.ts),
so every reader downloaded all of them. It cost 4,997 bytes of the 391,752-byte first load,
about 1 byte in 78.

In that 8 September build, removing it from the browser entirely measured 387,768
bytes, a floor the then-current shared-code rule could not reach. 48% of the file,
counted in source characters, was read by 2 or more screens: the
money cards a legislator's profile draws are the same cards a committee page draws
([`components/campaignMoney/MoneyCards.tsx`](https://github.com/alethical-org/alethical/blob/main/apps/frontend/src/components/campaignMoney/MoneyCards.tsx)),
and 3 more screens read the closed-committee chip. That half landed in `__common-*.js`
wherever it was put, so a reader still paid it. Cutting the other half loose measured about
2,000 bytes, against splitting 1,530 lines of reader-facing sentences 3 ways under a rule
that no word may change.

That measurement originally closed
[issue 2070](https://github.com/alethical-org/alethical/issues/2070), which was filed
against the 39,747-byte reading and asked for a ratchet cut. Doing exactly what it asked —
leaving no first-load file importing that module — was built and measured on 8 Sep 2026 and
made the first load 1,013 bytes **bigger**, because the module left `index-*.js` for the
dearer `__common-*.js` and 7 screens still read it.

The ordered campaign-money speed work reopened
[issue 2070](https://github.com/alethical-org/alethical/issues/2070) on 13 September.
It moves the genuinely single-screen parts instead of moving the entire module into
the common download. The 49 committee-screen exports stay in `lib/committeeMoney.ts`,
21 standalone-payment exports move to `lib/committeePaymentsPage.ts`, and the 48
shared exports live in `lib/committeeMoneyShared.ts`. Both browser screens and the
first-HTML readers use these same definitions. Every original declaration and every
reader-facing string is preserved.

Measured with the actual public production settings and a cleared export cache,
the intermediate first download fell from 392,674 to **389,287 bytes**, a saving of
**3,387 bytes** after the separate ownership-read change. The entry program fell
from 340,333 to 336,944 bytes; the common file changed from 50,725 to 50,727; the
runtime stayed at 1,616. This is a configured local comparison, not a hosted result
or permission to lower the production limit. The subsequent local shared-code
change is recorded below; hosted production measurements remain pending.

`committeePageImports.test.ts` follows value imports from the entry and every lazy
screen. Each route-only text file must have no entry path and exactly its own
screen as a consumer. In-memory bad imports prove it catches both a first-load
edge and an unintended second screen consuming the route-only words.
The 2,695-test frontend suite passes. Docs check: the API contract and reader
wording are unchanged by this move; this decision record owns the download change.

**The earlier production build moved shared code between first-load files.** Its
HTML named 3 files, including one holding parts used by more than 1 screen. Expo
filled that file with `extractCommonChunk` in `@expo/metro-config`, so moving code
out of the entry program did not necessarily remove a byte from the first download.
These 3 production measurements predate the 13 September serializer change:

- Taking the committee-money library out of the router's reach, which counting source bytes
  said was worth 5,697, saved **21 bytes**: the program lost 32 and the shared file gained 11.
- Pointing `data/api.ts` at the 6 bill-status helpers it uses, instead of at the whole
  bill-page file, made the first load **1,164 bytes larger**: every byte of that file moved
  from the program to the shared file, and the new module boundaries cost the difference.
- Making everything sign-in arrive on demand was worth 260,702 by the same counting method,
  and saved **50,963**: the program lost 38,927 and the shared file lost 12,036 as well,
  because what came out of both went into a download only a reader who signs in fetches.

Under that earlier rule, leaving the first download required exactly 1 later
consumer. Counting bytes in the entry program alone measured where code sat, not
what a reader downloaded. The budget check counts every program file named by the
HTML, whatever their number (`apps/frontend/scripts/check-first-load-budget.mjs`).

**And that check cannot see a deferred download that something asks for anyway, so compare it
against a real browser rather than assuming they agree.** It counts the files the built page
names, which is right, and a download the running app then fetches immediately is invisible to
it. Measured live on 7 Sep 2026, median of 5 loads with a fresh browser context per load: the
sign-in dialog had been given its own download, and `SignInModalProvider` drew it on every page
with `open` false, so the fetch started the moment the provider mounted and its 8,694 bytes
landed **before** the app first drew. The check reported 439,253 and a reader was receiving
452,893. Nothing about either number looked wrong. A deferral is only real once a browser has
been watched not making the request.

**The earlier evaluation found no deferral path to the 300,000-byte target on
[#1966](https://github.com/alethical-org/alethical/issues/1966).** It measured the
framework beneath the app:
`react-native-web` 249,244 minified bytes, `react-dom` 178,881, React Navigation about
158,000, the query library 79,724 and `react-native-svg` 47,415. Its conclusion depended
on the then-current rule that code used by 2 screens entered the first download.
The 13 September local change removes that rule for production web exports and
reaches 338,333 compressed bytes, still above 300,000. The earlier figures remain
evidence of that build, not a lower bound for a different serializer.

The 2 costs, both accepted:

- **A first visit waits for its screen file after the program lands.** The app does not
  draw until that file arrives, so the server's readable text stays up rather than being
  replaced by an empty box, and the wait replaces part of a longer wait rather than adding
  to it.
- **A later click waits for a screen nobody has downloaded yet.** These files are small,
  and warming the next screen on hover is a separate item on
  [#1966](https://github.com/alethical-org/alethical/issues/1966).

## Shared screen code stays with the screen, 13 September 2026

[Issue 2012’s local result](https://github.com/alethical-org/alethical/issues/2012#issuecomment-5651104226)
follows [issue 2070’s helper split](https://github.com/alethical-org/alethical/issues/2070#issuecomment-5651083520).
The local output uses the actual production settings. Vercel’s separate
production-target build of committed source `a30d7941` measures the same 338,333
bytes. The public-domain release and its timing checks remain pending.

The smaller attempted change was to remove the common script from the generated
HTML without changing its contents. That measured 338,560 compressed HTML-linked
program bytes, but all 4 public money roots showed “This page hit a problem”. Expo’s
runtime did not fetch the absent common file automatically. Removing a script tag
alone is rejected; each requested screen must contain the code it needs.

The accepted local change is a pinned pnpm patch to `@expo/metro-config@57.0.7`,
enabled by `serializer.alethicalKeepSharedWithScreens` in
`apps/frontend/metro.config.js`. The guard applies only to a production web client
export. After Expo removes startup dependencies from later chunks, the patch skips
`extractCommonChunk`. Each lazy chunk keeps its complete synchronous dependency
closure; nested lazy imports remain separate downloads. Modules already in the
startup program are not copied into every screen.

Expo’s own Metro runtime (`@expo/cli/build/metro-require/require`) handles those
chunks. Repeated `__d` definitions use the same Metro module IDs and are ignored
after the first registration, so shared state remains 1 live instance when another
screen loads. Expo’s existing content hashes and asynchronous filename mapping
remain in use. There is no output postprocessor or custom production loader.
Native, development, non-export, Node and React Server builds retain upstream
common extraction, as does a build without the opt-in flag.

The cost is repeated download bytes when a reader visits several screens that share
code. The code runs as 1 instance, but its definition can travel in more than 1
screen file. An Expo version update also requires maintaining or removing this
small pinned patch and rerunning its serializer checks; the pnpm patch and lockfile
record exactly which dependency it changes.

| Build stage | HTML-linked compressed program bytes | Scope |
| --- | ---: | --- |
| Public before baseline | 392,136 | Published release from the 12 September baseline below |
| Separate confirmation read | 392,674 | Local production-configured build |
| Split committee helpers | 389,287 | Local production-configured build |
| Keep shared code with screens | 338,333 | Local production-configured build |

The final local stage saves 50,954 bytes against the helper split and 53,803 against
the public baseline. Its HTML names 1 index file with the runtime inside, and no
common script. Vercel’s
[hosted build](https://vercel.com/alethical/alethical-web/2wadpZBF3EsRdzsM97axhR8FuBsE)
reported `First-load budget passed: 338333 bytes` on 13 September at 04:41:02 UTC.
The uploaded source is a clean archive of commit `a30d7941`; no local logs, caches
or settings files were uploaded. The build used the production target with
`--skip-domain`. Vercel assigned only its project `.vercel.app` alias; the public
`www.alethical.com` address still served `a8e42d9a` afterward. The size limit is now
339,072 bytes, the hosted figure plus the existing 739-byte headroom.

**HTML-linked bytes are not all the JavaScript a page requests.** The local browser
also fetched each requested screen and, where needed, its later details chunks.
The following totals count those requested application program files with the same
compressed-byte method. They exclude API data, images and fonts; they are not total
page transfer sizes or promises for a visitor’s network connection.

| Local direct visit | Requested application program bytes, including the first file |
| --- | ---: |
| `/money` | 362,134 |
| `/money/committees` | 369,103 |
| `/money/races` | 359,383 |
| `/money/outside-spending` | 363,478 |
| `/money/committees/gottfried-david-house-committee-19193?year=2025` | 400,323 |
| `/legislators/jim-abeler?tab=money&year=2025` | 418,658 |

The local browser matrix covered 10 screens at phone and desktop widths, 20 direct
visits, without a rendering failure or horizontal overflow. The Abeler desktop run
logged a failed 502 resource request, so that result is not a claim that every
network request succeeded. A separate fresh-context phone/desktop reader pass
completed all requested money routes, including real outside-spending totals, the
committee filters and expansions, linked committee and named-payment navigation,
year, Filings, Share and Back. Bills, Votes, Bill Text and the Abeler money tab
also loaded. That independent pass recorded no script/console errors, HTTP errors,
unintended document reloads or horizontal overflow. It used the same read-only
local public-data proxy, so final public-domain timing and live checks remain
pending. Its exact evidence is `/tmp/2012-independent-reader/report.md`.

The 12 focused tests call the installed patched serializer and run its output with
Expo’s actual runtime. They cover both screen orders, 1 shared live instance,
nested imports, a target already in its own chunk, content-hash changes and all
excluded build modes. Type checking also passes. Docs check: the affected loading
sections and moved-helper references were read and updated; previous 3-file
measurements remain dated history, and reader-facing words and financial contracts
are unchanged by these 2 download changes.

## Sign-in is fetched when someone signs in

Everything sign-in is 1 download that a reader fetches only when sign-in is reachable
([#1976](https://github.com/alethical-org/alethical/issues/1976)): the client that talks to the
sign-in service, the dialog and its fields, the account menu and its password dialog, and the
email-link page. A money reader who is not signed in fetches none of it.

Measured on the production build, at the settings Vercel compresses with: a first load of
**439,253 bytes fell to 388,290** — the program 376,006 to 337,079, the shared file 61,631 to
49,595, the runtime unchanged at 1,616. Before any of
[#1976](https://github.com/alethical-org/alethical/issues/1976) it was 451,044. What moved out
is a 262,766-byte download named `signInBundle`.

Private account visibility ([issue 2014](https://github.com/alethical-org/alethical/issues/2014))
adds the administrator route and a shared permission check. Its account-list parsing and
search request load only with `/admin/users`. The release measures **389,116 bytes**:
337,513 for the program, 49,987 shared, and 1,616 runtime. This is 826 bytes (0.21%) above
the 388,290-byte baseline. The limit for that release was 390,000 bytes to admit this measured feature;
the private list itself is not a cost paid by public readers.

The end-to-end freshness deadline
([issue 2023](https://github.com/alethical-org/alethical/issues/2023)) adds **878 bytes** measured
locally: main built 389,083 and it builds 389,961. What every reader downloads for it is the
deadline, the 4 read names it applies to, and the arithmetic that reads a cache's `Age`. What they
do not download is the 2 sentences a withheld claim prints, which moved into the 2 screens that
draw them and took 475 bytes back off every other page.

**The 8 September limit was 391,500 bytes, set from Vercel's own build because a local
build reads 542 bytes smaller and a limit set from the smaller number stops the deploy.** Measured
on commit `01ffcbb0`: this Mac builds 390,219 bytes where Vercel builds 390,761, the whole
difference in `index-*.js`, whose content hash differs between the 2 because the build inlines
configuration a laptop does not hold. On 8 September 2026 a limit of 390,500 set from a local
reading of 389,961 failed its own hosted build, and production served no merge for 50 minutes with
4 commits merged and unshipped. So the limit sits 739 bytes above Vercel's 390,761, which is more
than the measured gap, and the next change to move it takes its number from a hosted build
([issue 2052](https://github.com/alethical-org/alethical/issues/2052) closes the trap itself).

**One measurement there is worth keeping, because it reverses the tidier choice.** Folding the
age-reading fetch helper into `publicApiRequest` so there is a single implementation makes the
first load **409 bytes bigger**, since that function has dozens of callers and the wrapper's
returned object inlines into each. So `apps/frontend/src/data/api.ts` keeps 2 near-identical
readers on purpose, and says so where a reader of that file will find it.

**Two mechanisms now enforce what a comment could not
([issue 2052](https://github.com/alethical-org/alethical/issues/2052)).** The comment
telling a session to take this figure from the hosted build already existed, was read, and
was quoted in the commit message that then ignored it, so 4 merges sat unshipped for 50
minutes. Words were the wrong instrument.

- **A build that inlined no settings is checked against what a build with them will
  measure.** `HOSTED_BUILD_EXCESS_BYTES` is 542, measured on commit `01ffcbb0` where a
  settings-less build produced 390,219 and Vercel produced 390,761. Such a build adds that
  before comparing, and reports the sum rather than its own number, so a passing line can
  never be quoted as headroom the deploy does not have. Replayed against the incident:
  389,961 plus 542 is 390,503, which fails the 390,500 limit that was set from it. Its
  honest limit is that it is one measurement of one commit, so a future commit with a
  larger gap could still pass here and fail there.

  **The condition is what the built program CONTAINS, not where it ran, and getting that
  wrong the first time is worth recording.** This first keyed on Vercel's own `VERCEL=1`,
  which asks "is this the host" when the question is "did this build have its settings".
  The main checkout holds a `.env`, so a build there inlines real values and is already the
  size the host produces; adding the excess there would have failed a build that would
  have deployed. `firstLoadCarriesItsSettings` now reads the program for a Supabase
  address instead, because that setting is the one a deployable build cannot work without
  and the one a worktree never has: measured 8 Sep 2026, 1 hit in the live program and 0
  in a worktree's build.
- **A failed production release opens an issue by itself**
  (`.github/workflows/production-release-failed.yml`), on the `deployment_status` event,
  for the `Production` environment only, reusing one issue across a run of failures and
  closing it when a release next succeeds. This is the half that generalises: the next
  cause will not be a byte count, and the thing that went wrong on 8 September was nobody
  looking rather than nobody knowing where to look.

**Rejected: committing the public settings so a local build has no gap to project.** All 6
`EXPO_PUBLIC_*` values already ship inside the program every reader downloads, so a committed copy
exposes nothing new, and it would make a worktree measure exactly what the host measures. It still
loses. This repository is public, so it would put 2 permanently readable credential-shaped strings
in it, including a Supabase publishable key, where a secret scanner has to be taught to ignore them
and a future reader has to be told they are safe. What that buys is only that 2 numbers match, and
`firstLoadCarriesItsSettings` already asks the built program what it contains rather than trusting
either number. A real standing risk for a cosmetic gain. Revisit only if the settings ever have to
be present for a local build to be correct rather than merely to be the same size.

**And the reason nobody could confirm the cause for hours: the build reuses a cached translation of
each module, so setting a variable and rebuilding produces a byte-identical program.** Two sessions
each set `EXPO_PUBLIC_API_URL`, measured no change, and concluded the settings were not inlined.
An empty `TMPDIR` plus `--clear` on the export reproduces the host: the program's content hash
changes and `api.alethical.com` appears where a cached build had it 0 times. Measured 8 Sep 2026.
The arithmetic is worth keeping because no one would predict it from the code: 261 raw bytes of
settings become 1,510 after the optimiser and 542 compressed, since the values are high-entropy
strings that compress poorly and change what the minifier can fold. Two other candidates were ruled
out by measurement rather than argument, and both are cheap to re-test: the host's Node 24 against a
local 22 produces byte-identical output on the same source, and 2 consecutive local builds are
byte-identical, so it is not build-to-build noise.

**Rejected: committing the public settings so a local build has no gap to project.** All 6
`EXPO_PUBLIC_*` values already ship inside the program every reader downloads, so a committed copy
exposes nothing new, and it would make a worktree measure exactly what the host measures. It still
loses. This repository is public, so it would put 2 permanently readable credential-shaped strings
in it, including a Supabase publishable key, where a secret scanner has to be taught to ignore them
and a future reader has to be told they are safe. What that buys is only that 2 numbers match, and
`firstLoadCarriesItsSettings` already asks the built program what it contains rather than trusting
either number. A real standing risk for a cosmetic gain. Revisit only if the settings ever have to
be present for a local build to be correct rather than merely to be the same size.

**And the reason nobody could confirm the cause for hours: the build reuses a cached translation of
each module, so setting a variable and rebuilding produces a byte-identical program.** Two sessions
each set `EXPO_PUBLIC_API_URL`, measured no change, and concluded the settings were not inlined.
An empty `TMPDIR` plus `--clear` on the export reproduces the host: the program's content hash
changes and `api.alethical.com` appears where a cached build had it 0 times. Measured 8 Sep 2026.
The arithmetic is worth keeping because no one would predict it from the code: 261 raw bytes of
settings become 1,510 after the optimiser and 542 compressed, since the values are high-entropy
strings that compress poorly and change what the minifier can fold. Two other candidates were ruled
out by measurement rather than argument, and both are cheap to re-test: the host's Node 24 against a
local 22 produces byte-identical output on the same source, and 2 consecutive local builds are
byte-identical, so it is not build-to-build noise.

**`lib/auth/signInWorkPending.ts` is the whole design, and it answers 1 question: does this page
load have sign-in work to do?** It says yes when a session is saved in this browser, when the
address is a sign-in return, when a request was stashed before a redirect to Google, or when a
link named a sign-in screen. Otherwise no, and nothing is fetched until somebody presses
something. It reads those 4 things and consumes none of them, because the provider's own reader
clears the stash and rewrites the address. **A wrong no is the dangerous answer**: it would show
a reader who is signed in the site as a stranger, which is why every way sign-in work can start
without a press is in that list.

Three things follow from it:

- **`SignInModalProvider.tsx` is what every page carries**, and it is small. It hands each screen
  the 1 function they call (`openSignIn`) from the first byte, holds the press that arrives before
  the code does, and mounts the machinery as a sibling of the page rather than a wrapper around
  it — so the fetch landing does not remount the page and lose what a reader had on screen.
- **`AuthProvider.web.tsx` stops waiting when the answer is no.** It sets its loading state false
  without fetching the client. It observes the first later request through
  `onSignInBundleRequested`, then attaches the session listener before sign-in can finish.
  A fresh visitor can therefore sign in without reloading, while untouched public visits
  keep the saving. The observer also handles a request made before the provider mounts.
- **The top bar's account controls cost a signed-in reader nothing.** The bar draws them only when
  somebody is signed in, and nothing can know that until the client has read the saved session, so
  the download they live in is already in hand by the time one is asked for.

**One download, not two.** `lib/auth/signInBundle.ts` holds all of it and nothing imports it
directly; `lib/auth/loadSignInBundle.ts` is the only name for it. Splitting it in half puts
everything the halves share — the sign-in client included — into the shared file every page
fetches, which happened once during this change and cost most of the saving.

**The cost, accepted: a signed-in reader fetches the dialog along with the client that restores
their session**, because both are in that 1 download. They pay it after the page can draw rather
than before, and they are the reader most likely to open the dialog next.

**Two guards, both seen to fail before being kept.**
`apps/frontend/src/lib/auth/__tests__/signInIsFetchedNotCarried.test.ts` walks the plain imports
from the app's own start **and from every screen** and fails if any of them reaches sign-in. The
screens are in that walk because the first version left them out, and it then passed while the top
bar imported the account menu directly — a real regression, sitting in the shared file, that a walk
from `index.ts` alone cannot see.
`apps/frontend/src/lib/auth/__tests__/signInWorkPending.test.ts` covers the gate, and each of its 4
yes cases was removed on purpose and watched to fail.

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

## Committee money load baseline, 12 September 2026

[Issue 2126’s public baseline](https://github.com/alethical-org/alethical/issues/2126#issuecomment-5650886167)
records the starting release, browser traces, decoded response sizes and 28-day
origin shares for the 3-part speed work. These are before measurements, not results
of the finance/confirmation split. Chromium used a 1280 × 900 viewport with no
synthetic network or CPU slowdown. Each first visit had an empty browser cache;
the repeat used the same browser context. Database coldness was not established.
All 3 visits selected 2025.

| Address | Donor list ready, first / repeat | History ready, first / repeat |
| --- | --- | --- |
| `/legislators/jim-abeler?tab=money&year=2025` | 6.320 s / 0.722 s | 12.967 s / 0.741 s |
| `/money/committees/100-percent-future-fund-41363?year=2025` | 1.422 s / 0.429 s | No history requested |
| `/money/committees/mn-dfl-state-central-committee-20003?year=2025` | 7.133 s / 0.443 s | No history requested |

Committee 41363 led the 28-day finance traffic: it had
287 estimated requests from 275 observations, excluding verified bots. Committee
20003 was also sampled for its large payment list. Decoded API response bytes were
302,683 for Abeler, 14,720 for 41363 and 994,708 for 20003. Abeler’s 31 response
events include browser-cache events and are not 31 network transfers. His selected
2025 received-payments read took 4.233 s with `EXPIRED`; the 2024 history read took
3.625 s with `EXPIRED`.

Across 16 August to 12 September, finance had 8,560 observations and 8,806 estimated
requests: 84.76% rebuilt at the origin and 78.38% made the reader wait. Payments
had 5,111 observations and 5,587 estimated requests: 94.68% and 91.32%, respectively.
Ineligible and bypassed requests were excluded. The finance split changes the
explicit dated-finance cache policy; it does not lengthen the payment-route policy.
All sampled donor lists completed without a failed state or page error. The DFL
repeat’s outside-spending recheck took about 23.5 s after donors were ready, so its
20-second network-idle wait expired; donor readiness is not background completion.

The public first-load program was 392,136 compressed bytes against the unchanged
392,321-byte limit. After measurements remain open until the completed 3-part
change is released: repeat these addresses and browser conditions, report final
program bytes, donor/history readiness, response sizes and origin shares, and name
the deployed commit. Local intermediate measurements belong on
[issue 2126](https://github.com/alethical-org/alethical/issues/2126) with their exact
build identity and must not be labelled as a live improvement.

## What a committee's own pages carry in their first response

`/money/committees/{name}-{number}` and its `/payments` view are served with the reads
the page function already made handed on inside the same response, under the keys the
app's own hooks ask for (`committeeMoneyQueryKey` and
`committeePaymentsListQueryKey` in `apps/frontend/src/lib/committeeMoneyShared.ts`, plus
`committeeConfirmationQueryKey` in `apps/frontend/src/lib/committeeConfirmation.ts`, seeded
through `apps/frontend/src/lib/pageData.ts`). Before this, both addresses read a
committee's figures to write the words a reader sees, handed on nothing, and the app then
asked the data service for the identical answer and replaced those served words with
loading placeholders while it waited
([issue 2024](https://github.com/alethical-org/alethical/issues/2024)).

**The committee figures are carried on both addresses; a payment page is carried on
`/payments`.** Both follow the year in the address, and the payment page also follows its
requested direction. The redesigned committee screen loads its complete selected-year
received and made lists after the app starts, in requests of up to 250 rows. It uses
separate complete-list keys and publishes no donor chart, grouping or sum from a short
page. Its old 6-payment read and seed are removed because no rendered list consumes them.
The profile's history read is disabled on this committee screen.

The shared chart, payment browser and outside-spender code also arrives only when a
money view needs it. Both routes use the same on-demand module; importing the same
components directly from 2 route bundles would otherwise put them in the shared first
download for unrelated pages. This preserves the existing production-derived size limit.
The legislator tab's outside-spending fallback card uses that same module, including
its loading and failed-read states. A failed code download stays inside the details
section and leaves the independently accepted filing figures on screen.

**The 2 reads on `/payments` run together rather than one after the other.** Neither needs the other's
answer: the registration number comes out of the address and the year out of
`campaignMoneyYear`. The payments view used to wait for the figures before asking for the
rows, which put a whole round trip into its first response for nothing.

**A seeded committee confirmation carries `servedAgeMs: 0`, and that is not a rounding.** The
whole age of a seeded answer rides in React Query's `initialDataUpdatedAt`
(`seededClaimAgeMs`), so passing the API cache's age into the shaped answer as well counts
the shared caches twice: a 16-minute claim reads as 22 minutes, past a deadline it has not
reached, and the page then withholds a member nobody has withdrawn.
`apps/frontend/src/hooks/__tests__/currentClaimAgeEndToEnd.test.tsx` fails on exactly that
mistake.

**The current claim is rechecked independently of the figures.** The committee HTML
asks for dated finance and confirmation concurrently and carries separate seeds.
Confirmation is stale on arrival by design: the page it travelled in can have sat in
the HTML cache for 10 minutes. Its recheck runs behind the accepted figures. Dated
finance has the ordinary dated-record query behavior and does not renew that claim.
A first confirmation failure keeps the figures and the neutral ownership explanation,
uses `no-store`, and carries no failed confirmation seed. An explicit successful
`null` retains the existing kind-specific prose.

On `/payments`, dated finance and the first 50 rows run concurrently, and no
confirmation is requested or seeded. The carried first page removes the matching
initial payment request. The redesigned committee chart and tabs still
need their complete selected-year payment reads. The old 6-row hooks and their
unused query key are removed with that redesign, so every page no longer downloads
readers that no screen uses.

The first pending confirmation says “Checking whose committee this is…”. Its first
unavailable answer says “We could not check whose committee this is. The money shown
here is the committee’s own filed record.” An expired previously known confirmation
keeps `CONFIRMED_MEMBER_WITHHELD_LINE`, removes the member name, link and checked
evidence, and leaves the dated money visible. A read failure never becomes the prose
for a successful unconfirmed committee.

Measured 8 Sep 2026 against the live release and the live data service, with the page
cache deliberately missed on every read.

The measurements below describe that release. On `/payments`, the first payment read is
now 50 rows, followed by up to 250 per request, to leave more room inside the 5-second first-response
deadline. A failed payment read uses the existing could-not-load words and prevents
success caching of that partial response ([issue 2068](https://github.com/alethical-org/alethical/issues/2068)).

| Address | First response, gzipped | Reads removed | Cost |
|---|---|---|---|
| `.../100-percent-future-fund-41363?year=2025` | 5,642 → 6,614 | short payments list (567 gzip, 29 ms) | +972 bytes |
| `.../100-percent-future-fund-41363/payments?year=2025` | 5,470 → 6,749 | full payments page, 24 rows (788 gzip, 31 ms) | +1,279 bytes |
| `.../mn-dfl-state-central-committee-20003?year=2025` | 5,983 → 7,228 | short payments list (741 gzip, 32 ms) | +1,245 bytes |
| `.../mn-dfl-state-central-committee-20003/payments?year=2025` | 9,562 → 16,258 | full payments page, 250 rows (5,789 gzip, 34 ms) | +6,696 bytes |

**The 250-row case is a wash on bytes and a round trip cheaper**, which is the whole
argument for carrying it: 6,696 bytes added against 6,660 removed, arriving in one response
instead of that response plus a request to a different host. 250 was the cap that release
served, so the last row of that table was the worst case for that release rather than a
middling one. The rows were already in the response as text either way: the payments
snapshot printed every one of them.

**The redesigned committee screen retains 1 outside-spending presence read.** It asks
whether this filer spent about other committees, for the separate Spent by them view;
that first page contains up to 50 rows and is not embedded in the first response.
Spending about this committee instead uses the selected-year finance summary and a
matching grouped request. Opening a spender obtains the complete underlying payment
list from the same source copy. The September 8 table's 6-row seed and 2 presence-read
comparison describe the earlier screen, not this request shape.

## A failed list read holds the space the placeholder rows held

`/bills` and `/legislators` reserve a window's height around every state of their results
panel, not only the loading one (`useOneScreenTall` in
`apps/frontend/src/components/Skeleton.tsx`, applied in `SearchBillsScreen.tsx` and
`SearchLegislatorsScreen.tsx`). A failed read swaps the placeholder rows for 1 sentence,
which shortened the page by about 690px and pulled the footer 449px up into view in the
same paint that said the load failed.

**The failure box carries the same 22px top margin the list above it uses.** React reuses
one element for the list branch and the failure branch, so a failure box with no top margin
reads to the browser as that element sliding 22px up the page. Equal margins are what make
the swap invisible.

**What the failure state says and shows is unchanged**, and it already kept the heading,
the search box and every filter: both screens hand the page frame a header band in every
state, so the frame's remembered-height rule for a page handed none never applies here.

Measured for [#2011](https://github.com/alethical-org/alethical/issues/2011) on 8 Sep 2026,
2 local production-like builds each served behind the real page function against the live
data service, cold browser per address, every record request refused. The baseline
reproduces the live figures.

| Address | Width | Before | After | Live before |
|---|---|---:|---:|---:|
| `/bills` | 1280x900 | 0.1491 | 0.0000 | 0.1491 |
| `/legislators` | 1280x900 | 0.1082 | 0.0000 | 0.1082 |
| `/bills` | 390x844 | 0.0000 | 0.0000 | 0.0000 |
| `/legislators` | 390x844 | 0.0048 | 0.0000 | 0.0048 |

Against Google's passing mark of 0.1. A successful load is unchanged: 0.0000, 0.0000,
0.0007 and 0.0016 on the same 4 rows both before and after, and the settled desktop page
screenshots are byte-identical.

## What the `/bills` wait is actually spent on

`/bills` publishes the site's slowest main-content figure. In 1 controlled profile, 60% of
the load is the shared program every address downloads rather than anything the bill list
does. [`report-page-load-stages.mjs`](../../apps/frontend/scripts/report-page-load-stages.mjs)
loads an address with a cold cache and a brand-new browser per run, attaches every observer
before the page loads, and splits the wait into its stages. Measured 7 Sep 2026 against
production, 9 runs, throttled to 1,600 kbit with 150 ms latency and a processor 4x slower.
The 9 runs spread under 40 ms.

**Every share below belongs to that profile and to no visitor.** The profile was picked so
its total sits near the published figure, and 2 loads can reach the same total with
completely different stages behind it, because device, cache state, window width, server
wait and network all differ. So the shared program leading is a hypothesis about real
visits, testable by shrinking the program and re-reading the published figure, not a
measurement of them.

| Stage | 1280x900 | Share |
|---|---:|---:|
| First response finished | 241 ms | 6% |
| Downloading the program | 2,281 ms | 60% |
| Starting the program | 339 ms | 9% |
| Running on until the list is asked for | 347 ms | 9% |
| Waiting for the list answer | 490 ms | 13% |
| Drawing 10 cards | 84 ms | 2% |
| **Main content** | **3,832 ms** | |

In this dated measurement, the program was 389,512 bytes over the wire across the
same 3 files every address named, so most of this page's wait belonged to the
shared first download, not to the bill list.
The `/bills` screen's own file is 4,793 bytes. Everything the page itself owns, the list
request and the drawing, is 574 ms.

**Which element counts as the main content changes with the window's width, so one address
publishes 2 very different figures.** 3 runs at each width, same profile: 390 px reads
564 ms and the element is a bill title inside the served text (`SPAN.ps-record-detail`);
600, 768, 900 and 1,100 px read about 3,256 ms and the element is the app's own heading;
1,280 px reads 3,860 ms and the element is a card's text. Every width sees the served list
at the same early moment, because the first response and its styles are the same whatever
the window, and what differs is only which element the browser calls largest. On a 1,280 px
window the first readable paint is 560 ms and a screenshot at 900 ms already carries the
heading, the count and all 10 bill numbers with their titles, each a working link.

**Those are controlled readings, and they say nothing about the mix of real windows.**
Nobody knows what share of visits arrives narrow, because the per-address report
deliberately asks Cloudflare for no device or width breakdown
(`docs/product-onboarding/traffic-guide.md`). So a published figure for an address may
average 2 populations that differ by 3 seconds, and a controlled table and a visitor table
are never read into each other.

**Matching the served text's heading to the app's would move that figure without moving
anything a reader waits for**, from about 3,300 ms to about 550 ms on every width. It is a
design question about whether the 2 headings should be the same size, and it is never a
performance change.

**The 490 ms list stage is what a warm nearby cache costs, and a visit that finds no copy
pays more.** Measured at the origin on 7 Sep 2026 with a cache-busting parameter, 3 reads
each: the answer takes 565 ms cold against 90 ms when the nearby cache holds it, so a visit
that finds no copy waits roughly 950 ms for its list rather than 490. The same reads split
that cold time: 234 ms with no rows returned at all, which is the count and the plan; 307 ms
for 10 rows in the slim view; 454 ms for 1 full row; 565 ms for 10. So most of it is loading
each bill's full record, and 1 row costs nearly as much as 10, which points at a fixed cost
in the loading rather than a per-row one.

**Report both numbers with the cache state named, and take which one a reader gets from the
measurement rather than from how often the page is visited.** Visit frequency cannot answer
it: a first-time visitor can be handed an answer somebody else's visit put there minutes
earlier, and copies are held per location rather than once for everybody. What answers it is
Cloudflare's own record of what its cache did, and on `/api/v1/bills` the reader was the one
waiting for 87.3% of reads over the 28 days to 7 September 2026 (**How often a reader gets
each of the 2 speeds** below). So the honest pair is still "565 ms cold, 90 ms warm", and the
cold figure is now known to be what nearly every reader pays.

**The list response carried far more than a card draws, and cutting it is worth about
40 ms.** `/bills` asked for 10 bills and received 127,201 bytes,
22,145 as production gzipped it. Action
history is 79,410 of those bytes, 396 rows so that each card can print 1 line, and the AI
analysis is 27,441, of which the key points, the suggested questions and the citations are
drawn on the bill page and the Ask page and never on a card. Compressed the same way, the
response as served is 22,527 bytes, without everything no card draws 15,053, and carrying
only what a card draws with 1 action line each 9,115. At this profile's bandwidth those are
113, 75 and 46 ms of transfer. What a smaller response saves beyond that transfer is not
established: a smaller body is also less to parse and less for the server to build, and
neither was measured. Sizing the whole avenue needs a controlled before-and-after, so the
bytes above are the finding and the seconds are not.

**The list wait splits into 3 parts, and which one dominates depends entirely on whether
the answer was already held nearby.** The data service now permits a page on our own site to time its
own requests (`Timing-Allow-Origin`, #2039), so the parts are readable rather than guessed.
Measured 8 Sep 2026, same profile, 9 runs, on the trimmed response:

| Inside the list request | Middle run | Range |
|---|---:|---|
| Opening the connection | 58 ms | 49 to 137 |
| Waiting on the server | 35 ms | 31 to 47 |
| Downloading the answer | 330 ms | 273 to 336 |
| **The whole request** | **424 ms** | 415 to 456 |

**The server figure here is the warm one.** The probe loads the same address 9 times, so
every run after the first is answered from a nearby copy. What building the answer costs is
in the table below, measured on its own.

**A stage's name is not its cause, and this is where that bites.** The download stage being
the largest does not make the bytes the largest cost. Measured the same day at the same
profile, fetching the same 2 real answers on their own with nothing else loading:

| Answer | Over the wire | Connecting | Server | Downloading |
|---|---:|---:|---:|---:|
| Slim view, warm | 608 B | 63 ms | 38 ms | 121 ms |
| What a card draws, warm | 14,698 B | 53 ms | 33 ms | 205 ms |
| Slim view, cold | 608 B | 56 ms | 240 ms | 5 ms |
| What a card draws, cold | 14,698 B | 58 ms | 497 ms | 78 ms |

A 608-byte answer cannot spend 121 ms transferring 608 bytes, so most of that stage is the
connection reaching speed rather than the body. **What the size actually costs is the
difference between the 2 rows: about 84 ms warm and 73 ms cold for 14,090 extra bytes, so
roughly 5 to 6 ms per 1,000 bytes over the wire at this profile.**

So the size lever is real and small. Removing everything no card draws took the answer from
22,145 to 14,698 bytes, worth about 40 ms. Going further to a card-shaped 9,115 bytes would
be worth about another 30 ms.

**Neither is the roughly 330 ms the same stage reads during a page load, and that gap is
unexplained rather than explained.** The in-page figure reproduces across runs and the
isolated figure for the same body is 205 ms warm, so the difference is real and not noise.
Two obvious suspects are ruled out: the probe's own page watcher costs nothing measurable
(312 ms without it against 307 ms with it, 5 runs each), and in the 1 load checked for it
nothing else was downloading while the answer arrived. Anything sizing this stage should
establish the cause first rather than treat it as transfer.

**Cold, the server is the largest part by far**: 497 ms of a 640 ms request against 78 ms of
downloading. That is the same cost #2040 is filed against, seen from the browser this time.

## What the bill list's fixed cost turned out to be

**The cost that makes 1 row nearly as expensive as 10 is the number of separate database
statements, not any one of them.** One card list ran 11, and the API and the database sit in
neighbouring regions, so each one pays a hop across that gap whatever it asks for
([`api-cdn-setup.md`](api-cdn-setup.md) records the 2 regions). A page asking for 1 row runs
the same 11 as a page asking for 10, which is the whole shape the readings above show.
Measured 8 Sep 2026 by running the real route against production and timing every statement
it issued.

| What the statement was for | 10 rows | 1 row |
|---|---:|---:|
| The sessions of the current Legislature, twice | 69 ms | 65 ms |
| The bills themselves, with the total | 103 ms | 61 ms |
| Their chief authors, then those authors' own rows | 71 ms | 63 ms |
| Their 4 counters | 33 ms | 32 ms |
| Their stored analysis | 128 ms | 40 ms |
| Their action history | 62 ms | 33 ms |
| Their co-author counts | 36 ms | 33 ms |
| The current version of each signed bill, then its sections | 233 ms | 66 ms |
| **The whole route** | **861 ms** | **409 ms** |

**These timings are from a laptop, where the hop to the database is about 30 ms, and the API
is far closer than that.** So the figures say which statements exist and roughly how their
costs compare, and they never say what a reader waits. The origin reading in the table
further up is what says that.

**The largest single cost was reading whole bills' text to extract one date, and almost all
of it was thrown away.** A signed bill's card can print the day the law takes effect, and
that is resolved from the bill's own sections. All 3 ways of resolving it gate on the
sections' effective-date *headings* before reading a word of section text: 2 of them need
every section to carry a heading, and the third needs none of them to. So a bill mixing
headed and silent sections resolves nothing however its text reads. It was still fetching
that text. On page 1 of `/bills?sort=progress`, where signed bills sort first, that was
482 kB of section text crossing the region hop to serve 2 bills' dates, because 8 of the 10
bills mix the 2 shapes. Corpus-wide, 6,430 kB of the 7,379 kB held by the 146 signed bills
belongs to that unresolvable shape.

**The second was loading every stored analysis a bill has and keeping 1.** A bill keeps its
superseded summaries: 10,159 of the 10,517 enriched bills hold 2 rows, averaging 3.6 kB of
stored document each, and the serializer picks the current one and drops the rest. That was
104 kB fetched on a 10-bill page to use 67 kB of it.

**What the route runs now is 7 statements**, and none of the 4 changes alters a served
value:

- The sessions of the current Legislature come back in 1 statement rather than 2.
- A signed bill's effective date is resolved in 1 statement rather than 2, and that
  statement fetches text only for the bills whose headings leave a tier open.
- A bill's 4 counters ride back on the bill read itself, which cannot repeat a bill row
  because a bill has exactly 1 counters row.
- The chief author's own row rides back on the read of the sponsorship that names them.

**Proved rather than assumed, because "the output is the same" is the whole claim.** Ten
request shapes -- both sorts, a keyword search, a status filter, a later page, the slim
view, the count alone, one session and the whole Legislature -- were run against production
before and after and returned byte-identical bodies. Separately, all 146 signed bills in the
corpus were replayed through the old and new effective-date reads and served the identical
value for every one.

**The round-trip counts are pinned by tests, because no assertion about a served value can
see them.** Every statement above could be split back into 2 and every response body would
stay identical. `alethical/tests/test_bill_list_round_trips.py` counts them instead, and
`alethical/tests/test_bill_effective_dates_sql.py` builds the 3 section shapes in real
Postgres and requires the unresolvable one to fetch no text at all.

**What the origin reads afterwards.** Same method as the reading that raised this: the
production origin directly, a cache-busting parameter so no nearby copy can answer, on the
deployed change (commit `a5a42091`, deployed 13:40 UTC 8 Sep 2026). 7 reads each rather
than 3, reported as the median, because the spread is wide enough that 3 reads can mislead.

| What was asked for | Before | After | After, min of 7 |
|---|---:|---:|---:|
| Nothing at all, no database (`/healthz`) | 90 ms | 149 ms | 91 ms |
| No rows at all, just the count | 234 ms | 192 ms | 169 ms |
| 10 rows, slim view (`view=directory`) | 307 ms | 306 ms | 241 ms |
| 1 full row | 454 ms | 336 ms | 333 ms |
| 10 full rows, what the page asks for | 565 ms | 464 ms | 437 ms |

**The 2 columns were measured from different machines on different days, so read the
comparison as approximate rather than controlled.** The floor row is why: the machine
measuring the "after" column sits 59 ms further from the origin at its median, so every
figure in it carries overhead the "before" column does not. That makes the raw comparison
harsher on the change than a fair one would be, and the page's own read still moved from
565 ms to 464 ms.

**Taking each column's own floor off leaves what the server spends**: 475 ms before against
315 ms after for the 10 full rows a page asks for, and 364 ms against 187 ms for 1 row. That
subtraction assumes the network cost is a constant added on top, which is close to true and
not exactly true, so those 4 figures are the shape of the change rather than measurements in
their own right.

**1 row still costs much of what 10 do, because 7 statements is still 7 hops.** What
changed is how many, not that the cost is fixed. Closing the remaining gap means reading
fewer times again, which is the paragraph below.

**What is left, and not attempted here.** Three statements remain that could in principle
fold into others: the action history, the co-author counts and the effective-date read.
Each fetches many rows per bill, so folding it into the bill read would repeat every bill's
own columns once per action or per co-author, and whether that trades a hop for more bytes
than it saves is unmeasured. The cache window is deliberately untouched: bills keep the
short window so a status cannot go stale, which is a product decision and not a fix for a
slow read.

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

## How often a reader gets each of the 2 speeds

**Both speeds above were real and neither said how often it happens, so every
decision made from them rested on a guess. It does not any more: over 28 complete
UTC days, 11 August to 7 September 2026, our own server built 91.9% of the reads of
`/api/v1/bills`, and the reader was the one waiting for 87.3% of them.** So the
464 ms origin figure is very nearly what a bill-list reader pays, and the 90 ms
cached figure describes about 1 read in 8. Read from Cloudflare's own record of its
own cache by
[`scripts/report_origin_share_by_address.py`](../../scripts/report_origin_share_by_address.py)
([issue 2045](https://github.com/alethical-org/alethical/issues/2045)).

**Two shares, not one, and the difference is the whole reason the money window is
worth having.** Cloudflare labels every response with what its cache did
([its own definitions](https://developers.cloudflare.com/cache/concepts/cache-responses/)).
`miss` and `expired` mean the reader waited on Railway. `updating` means the reader
was handed a stale copy immediately while Cloudflare refreshed it behind them: our
server still built an answer, but no reader waited for it. `hit` means no origin read
at all. So "built here" is what the origin cost us and "reader waited" is what it
cost a person, and only the second one is a reader-facing problem.

Requests Cloudflare never considered cacheable are counted apart and left out of
every share: a signed-in read, an admin read and the saved-question reads carry
`private, no-store` or an `Authorization` header, and a share that put them in its
denominator would report the cache as failing on requests it was never offered.

| API address | Requests | Built here | Reader waited |
|---|---:|---:|---:|
| `/api/v1/bills` | 9,595 | 91.9% | 87.3% |
| `/api/v1/bills/<bill>` | 117,303 | 96.3% | 95.7% |
| `/api/v1/bills/<bill>/versions` | 4,918 | 98.1% | 97.2% |
| `/api/v1/bills/<bill>/votes` | 442 | 89.1% | 80.5% |
| `/api/v1/bills/featured` | 559 | 87.1% | 71.6% |
| `/api/v1/legislators` | 2,985 | 96.5% | 94.9% |
| `/api/v1/legislators/<who>` | 3,302 | 96.3% | 93.0% |
| `/api/v1/legislators/<who>/campaign-finance` | 1,185 | 96.9% | 93.8% |
| `/api/v1/legislators/<who>/independent-spending` | 1,433 | 94.6% | 80.0% |
| `/api/v1/legislators/<who>/bills` | 325 | 91.4% | 82.8% |
| `/api/v1/legislators/<who>/votes` | 295 | 82.4% | 72.2% |
| `/api/v1/committees/<n>/finance` | 5,567 | 87.7% | 79.9% |
| `/api/v1/committees/<n>/payments` | 2,013 | 95.4% | 93.1% |
| `/api/v1/campaign-finance/summary` | 664 | 74.4% | 50.8% |
| `/api/v1/campaign-finance/committees` | 404 | 79.2% | 59.4% |
| `/api/v1/campaign-finance/outside-spending` | 388 | 70.9% | 49.7% |
| `/api/v1/campaign-finance/filings` | 311 | 80.7% | 62.1% |
| `/api/v1/campaign-finance/races` | 228 | 61.4% | 28.5% |
| `/api/v1/campaign-finance/search` | 110 | 77.3% | 63.6% |
| `/api/v1/sessions` | 1,706 | 76.8% | 58.7% |
| `/api/v1/policy-areas` | 652 | 88.2% | 73.0% |
| `/api/v1/meta` | 780 | 84.2% | 68.2% |
| every `/api/v1` read | 157,273 | 95.0% | 92.9% |

`/api/v1/campaign-finance/payments-under-name` (40 records) and
`/api/v1/committees/<n>/filings` (6) are withheld rather than printed, and so is
`/api/v1/search`, which was asked for once. A percentage of 6 requests is not a
measurement, and the tool refuses one under 50 records rather than printing a
confident figure.

**The gap between the 2 shares is what serving a stale copy is worth, and it is
large.** On `/api/v1/bills` it is 5.3 points and on
`/api/v1/campaign-finance/races` it is 32.9, which is more than half of that address's
origin reads happening behind a reader who had already been answered. That is
`stale-while-revalidate` doing its job, and it is on every public read, at 5 minutes
for bill and vote records and at a day for the 5 named money records.

**Nothing here prices the difference between those 2 windows, and the addresses
cannot be compared to work it out.** Both windows carry a stale grace, so both
produce background refreshes; the addresses with the widest gaps include short-window
ones (`/api/v1/legislators/<who>/independent-spending`, 14.1 points) and the money
addresses whose figures are partly our own traffic. Changing a window is out of scope
on [issue 2045](https://github.com/alethical-org/alethical/issues/2045) and is a
reader-visible trade for the Alethical team to make, not a conclusion to draw from
this table.

**Why so little is answered from a copy at all is traffic against window, and the
traffic is not there yet.** Cloudflare keeps a separate copy at each of its own
locations, and a bill read keeps one for 60 seconds plus a 5-minute grace.
`/api/v1/bills` was asked for about 369 times a day across the whole world, so the
previous reader at the same location rarely asked for the same address inside the
same 6 minutes. Nothing is misconfigured. A location that has served nobody inside
the window has nothing to hand over, which is the same per-location fact recorded
above under **How old a current claim can be, end to end**.

**So a saved database statement is worth its full measured cost to nearly every
reader, and a cache is not an argument against removing one.** The 4 statements
removed from the bill list for
[#2040](https://github.com/alethical-org/alethical/issues/2040) are paid by 91.9% of
its reads, not by a cold minority.

### What this measurement can and cannot say

**It counts our own answers, not the people who asked for them.** The only thing the
tool asks Cloudflare per address is the cache status. No country, device, browser,
element, referrer, query string, network or reader identity is requested, and a test
pins that (`alethical/tests/test_report_origin_share_by_address.py`).

**It covers `api.alethical.com` only.** The Vercel records for `www.alethical.com`
are DNS-only, so Cloudflare never sees the page HTML and holds no copy of it. What
Vercel's own page store does is bounded by `api/page.ts` and is not measured here.

**Who is asking turns out not to change the answer, which was worth checking rather
than assuming.** Verified bots are excluded from the table; counting them in moves
the bill list from 91.9% to 92.5% and the whole surface from 95.0% to 95.2%. A
one-off read of Cloudflare's browser-family totals, taken to test this and not part
of the tool, put `/api/v1/bills` at 91.9% built here for requests carrying a
recognised browser against 92.0% for everything else. So the share is a property of
the window and the traffic rather than of the requester.

**A request count is not reader demand, and the biggest row is the one that proves
it.** `/api/v1/bills/<bill>` is the busiest address family in the table and its
volume is a machine walking the whole corpus. Measured over the same 28 days with
verified bots excluded: the requests are spread across at least 10,000 distinct bill
addresses, which is the query's own row limit, against a corpus of 10,471 bills; the
least-requested of those 10,000 was asked 7 times and the busiest single bill only
215 times; and 106,174 of 117,891 kept records carry no recognised web browser,
against 5,759 Chrome, 3,377 Firefox and 2,211 Edge. Readers concentrate on a few
bills and leave most of the corpus untouched, so a near-uniform 7 to 14 requests
against every address we hold is a sweep. It is not a *verified* bot, so
`--include-verified-bots` does not separate it and nothing in this dataset can.

**The shares survive that and a ranking by request count does not.** For requests
carrying a recognised browser `/api/v1/bills/<bill>` is 94.5% built here and 93.6%
reader waiting, against 96.5% and 95.9% for everything else, which is the same
near-identical split the bill list shows. So every share above stands. What this
table cannot answer is which page readers most want faster: page views answer that,
Vercel already records them, and `api/traffic.ts` reads them. Choosing work by the
request counts here would be optimising for a crawler.

**The 4 money addresses a job warms, and the ones our own probes reach, are not
reader behaviour.** `.github/workflows/warm-money-pages.yml` reads
`campaign-finance/summary`, `committees`, `races` and `outside-spending` after each
production release and once a day; it first ran on 4 September 2026 and succeeded 12
times inside this window, so 48 of those rows are the warmer.
`/api/v1/campaign-finance/races` received requests on only 4 of the 28 days: 156 on
4 September, 3 on the 5th, 4 on the 6th and 70 on the 7th. The 2 busy days are the 2
days this file's own money measurements were taken. So the money rows are largely
measuring us, and 3 requests a day is the size of the reader traffic underneath them.
The bill addresses, at 343 a day every day, are not in that position.

**Cloudflare drops records under load and says by how much, and its `count` is
already corrected for it.** Every count above is Cloudflare's own whole-traffic
estimate, read straight off `count`; the records it kept are the separate
`confidence.count.sampleSize`, and the floor of 50 is applied to those, for the same
reason `scripts/report_page_speed_by_address.py` does it: an estimate can look like a
hundred measurements while resting on one. Until 8 Sep 2026 the tool multiplied
`count` by the group's average sampling interval as well, which scaled every total
twice (up to 10% high on these rows) and, because each cache status is its own group
with its own interval, moved the shares: on the bill list a second scaling read 91.6%
built here where the estimates alone read 91.9%
([issue 2121](https://github.com/alethical-org/alethical/issues/2121)). Every figure
in this section is from the corrected tool.

**One cross-check is unavailable and the reason is a permission.** Cloudflare's
unsampled hourly totals would confirm these estimates, and they sit in a zone-scoped
dataset that the Account Analytics Read token cannot reach: asked on 8 September 2026,
that token returns an empty zone list, and the account-scoped hourly dataset refuses
the path outright. So the adaptive dataset is the only source, and its near-1
sampling interval is what stands in for a second opinion.

Run it with `CLOUDFLARE_ANALYTICS_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` set:

```bash
python scripts/report_origin_share_by_address.py
```

Nothing reads it on a schedule. The token lives on Vercel and not in GitHub Actions'
secrets, which only the maintainer can change, and
[issue 516](https://github.com/alethical-org/alethical/issues/516) already owns that
gap for the page-speed report next to it.


## Private activity totals: 8 Sep 2026

The activity totals used by `/admin/metrics` asked the database 19 questions
per read. Combining the time windows, lifetime totals, and current reader/follow
counts reduced that to 6. The 7-day and 30-day UTC boundaries, incomplete-history
markers, and team/test exclusions retain their existing meaning.

These are 3 runs before and 3 after, using local code against the production
database in enforced read-only transactions. The clock covers only
`site_metric_data`; it excludes opening connections, HTTP requests, sign-in
checks, and browser work. Returned records and query parameters were not printed.

| Code | Database questions per read | Each run, milliseconds | Median, milliseconds |
|---|---:|---|---:|
| Before batching | 19 | 646.400, 1,228.734, 622.344 | 646.400 |
| After batching | 6 | 198.842, 179.917, 185.541 | 185.541 |

The median fell 71.3%. This measures the database-read improvement, not a full
page-load or deployed-server time. Local database tests enforce the 6-question
bound and cover exact window edges, incomplete history, excluded/inactive
accounts, and distinct people and followed records.

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
