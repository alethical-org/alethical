# Putting a CDN in front of the API

**Net:** The production API answers each request in ~1 second because the work
happens in the database on a server in a different region from that database, and
nothing caches the answers. A CDN fixes what users feel: it keeps a copy of each
public answer at edge locations worldwide, so after the first request everyone
else gets it in tens of milliseconds. The app already sends the caching
instructions the CDN needs (PR #363); this doc is how to turn on the CDN.

Tracking issue: [#364](https://github.com/alethical-org/alethical/issues/364).

## Why this is the right fix

Measured on production (`EXPLAIN ANALYZE` + `curl`):

| Probe | Result | Meaning |
| --- | --- | --- |
| `GET /healthz` (no DB) | ~130 ms | network + hosting are fine |
| `GET /bills?limit=2` | ~900 ms–1.2 s | the cost is the DB request path |
| same query, after index #415 | rows step 70 ms → 0.6 ms | helped, but end-to-end still ~1.2 s |

The remaining ~1 s is the **multi-query, cross-region round-trip pattern**
(Railway `us-east4-eqdc4a`, the region `railway.json` actually sets, ↔ Supabase
`us-east-2`; about 6 queries per bill-list request, measured Aug 7 2026 on that
route only — the campaign-money routes are heavier and their count is not
established here) plus app
overhead — not any single slow query. Squeezing the queries further is
diminishing returns. Caching the *response* skips all of it: bill lists and bill
detail are public records that change only when ingestion runs (infrequent,
human-triggered), so they are safe to serve from an edge cache for a short TTL.

**That last sentence is about the bill-list route and does not carry to the
campaign-money routes, which is why their count is left open above.** A cache is
the fix for what a reader waits on and never a reason to leave a slow query in
place, and on the money routes the query was the whole cost. Measured for
[#1966](https://github.com/alethical-org/alethical/issues/1966) on 4 Sep 2026,
`/campaign-finance/outside-spending` answered in 2,787 ms and `EXPLAIN ANALYZE` put
2,761 ms of that inside 2 statements: the 11 trips were worth tens of milliseconds
between them. So a route's plan is read before its trip count is blamed
(`docs/operations/page-load-performance-decisions.md`, "What an uncached money
answer spends its time on").

The response headers that drive the cache are **already live** (PR #363):

```
Cache-Control: public, max-age=60, stale-while-revalidate=300                             # anonymous bill / vote / legislator reads
Cache-Control: public, max-age=300, stale-while-revalidate=86400, stale-if-error=604800   # the 5 named campaign-money record reads
Cache-Control: private, no-store                                                          # signed-in / tracking reads
```

There are 2 windows because the records behind them change at genuinely
different rates, and one window was wrong for both.

**Bill, vote and legislator reads keep the short window.**
`.github/workflows/vote-backfill.yml` re-reads and writes votes every day at
09:00 UTC, so these records change daily. A long stale window here would let a
reader be handed a week-old bill status, which is the harm
`.claude/rules/grounded-answers.md` rule 7 names: "a status-stale answer
misframes enacted law as a pending proposal."

**Five named campaign-money record reads get the longer window**, because a load
is human-triggered and on no schedule: production's snapshot was dated 2026-08-12
when this was measured on 4 Sep 2026, 23 days old. Against that, the old 60 s
plus 5 minutes was minutes, so any gap over 5 minutes between readers sent the
next one to the origin, measured at 2975 ms on
`/campaign-finance/outside-spending` — a figure that says what the window was worth
then, not what an origin read costs now. That same read answers in 0.46 s at the
direct origin (7 Sep 2026), so the window is worth about a tenth of what it was. Cloudflare honours both directives,
measured rather than assumed: the same morning `/campaign-finance/races`
returned `cf-cache-status: UPDATING` (serving stale, refreshing behind the
reader) and `/campaign-finance/outside-spending` returned `EXPIRED` (past the
window, so that reader waited on the origin).

Only `stale-while-revalidate` was lengthened, because it is the directive that
costs nothing: inside it the edge never makes a reader wait. `max-age`, which
does delay an update, moved from 60 s to 5 minutes and no further.

**The money window is capped at a day rather than a week because nothing yet
clears these copies when a load lands.** 4 events can move a money answer: a new
campaign-money download release, a new filed-totals or registered-filer release,
a committee-to-legislator link being confirmed, and one being withdrawn. None of
them purges the edge today. So the cap is what we are willing to be wrong by
with no clearing at all, and lengthening it is gated on proving automatic
clearing for all 4, not on judgement. Tracked on
[#1979](https://github.com/alethical-org/alethical/issues/1979).

`stale-if-error` applies only when the origin is failing, where the last good
copy beats an error page.

## Clearing a saved copy

`alethical/pipeline/cache_purge.py` decides which saved copies each of those events
makes false and asks Cloudflare to discard them. It is **switched off**: a purge
leaves the process only when a token carrying the **Cache Purge** permission is set
(`CLOUDFLARE_API_TOKEN` plus `CLOUDFLARE_ZONE_ID`) **and**
`ALETHICAL_CLEAR_SAVED_ANSWERS=on`. Two conditions rather than one, so a token
turning up for another reason cannot start purging by itself. The token Eugene has
to create, and the proof recipe once it exists, are in
[`docs/operations/page-load-performance-decisions.md`](page-load-performance-decisions.md)
under "How old a current claim can be, end to end".

The token already in the gitignored `.env` is a **different** token and cannot purge:
it carries `Zone.DNS: Edit`, `Zone.Cache Rules: Edit`, `Zone.Zone Settings: Read` and
`Zone.Zone: Read`. Editing cache *rules* is not clearing saved copies.

**Prefixes, not addresses.** A money answer's address carries a query string -- year,
page, office, committee, direction, name, search text -- and that space is far too
large to list. Purge-by-prefix discards every saved copy under a path whatever its
query string, which is the only shape that can clear an answer completely. All 5
purge methods are on every plan including Free
([Cloudflare changelog, 1 April 2025](https://developers.cloudflare.com/changelog/post/2025-04-01-purge-for-all/));
the limits that bind are 100 prefixes per request and 5 purge requests a minute.

**A purge can only reach the API host.** The Vercel records are DNS-only, so
`www.alethical.com` is not behind Cloudflare's cache at all -- measured 8 Sep 2026,
it answers with `server: Vercel`, no `cf-ray` and no `cf-cache-status`. Vercel holds
the page HTML in its own store (`x-vercel-cache: HIT`, and it strips `s-maxage` from
what it sends on, so the window is invisible in the response headers), bounded by
`api/page.ts` at 300 s plus 300 s. Clearing that store needs `Cache-Tag` headers on
`api/page.ts` and Vercel's tag invalidation, which is available on all plans.

## Smart Tiered Cache is off for this zone

Read from the zone on 8 Sep 2026: `tiered_cache_smart_topology_enable` is `"off"`
and `editable: true`, on a `Free Website` plan. Turning it on is one call:

```bash
curl -X PATCH "https://api.cloudflare.com/client/v4/zones/$CLOUDFLARE_ZONE_ID/cache/tiered_cache_smart_topology_enable" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" --data '{"value":"on"}'
```

What it would buy: a data centre with no saved copy fetches from an upper-tier data
centre instead of from Railway, so the per-edge cold read measured below stops
reaching the origin. Smart Topology is available on every plan; **Generic Global
Tiered Cache and Regional Tiered Cache are Enterprise-only** -- the zone refuses
`regional_tiered_cache` with "not available for your plan type" -- so neither is an
option here.

## An omitted default and a written-out default are saved twice

The cache rule sets no custom cache key: its whole action is
`{"cache": true, "edge_ttl": {"mode": "respect_origin"}, "browser_ttl": {"mode":
"respect_origin"}}`. So the default key applies, which carries the query string
verbatim, and a custom cache key is Enterprise-only. Measured on the live zone,
8 Sep 2026, with a unique parameter so nothing else could have saved the address
first:

| Request | Result |
| --- | --- |
| `?probe=N` then `?probe=N` again | MISS, then HIT age 0 |
| `?probe=N&sort=newest` | MISS -- a second copy of the same answer |
| `?sort=newest&probe=N` | MISS -- a third copy, so the order counts too |

`sort` defaults to `newest`, so all 3 return identical bytes. **Nothing can merge
them at the edge on this plan**, which leaves one fix: every requester asks for the
same address. The app and the page function both send `?sort=newest`
(`getOutsideSpendingRecordFromApi` in `apps/frontend/src/data/api.ts`), and
`.github/workflows/warm-money-pages.yml` sends the same. All 4 warmed data addresses
match the app's own request character for character, and each one's source is named
in a comment beside the list, because a warm on a near-miss address saves a copy no
reader ever asks for.

Every meaningful difference stays its own copy, which is what the default key gives
for free: year, page, office, committee, direction, name and search text all change
the address and so all change the key.

**What the window does and does not touch.** Every money page prints `as_of`,
read off the loaded snapshot's `fetch_completed_at` and carried inside the
payload, so a cached copy prints the day its own records were copied rather than
the day it was cached. That means a stale answer stays honestly dated. It does
**not** mean a stale answer is current: a truthful old date and a fresh figure
are 2 different things, which is exactly why the window is capped above rather
than justified by the date.

**Which reads those 5 are is a written-down list, and the shape of an address
decides nothing.** A route nobody has classified gets the short window, including
a brand-new one.

Evidence, 7 Sep 2026: while an address prefix decided this, 2 answers sitting
behind `/api/v1/campaign-finance/` inherited the long window without being dated
records. The money search returns a sitting legislator's `chamber`,
`district_code` and `party`; the money summary counts who is sitting and how many
members have a confirmed committee. Those change at an election, a resignation or
a withdrawn confirmation, with no money load involved, so a money-cadence window
was the wrong clock for them
([#1985](https://github.com/alethical-org/alethical/issues/1985)).

The test that decides membership is what an answer *claims*, never whether it names
a person: a person's name inside an accepted filing is a dated record and is fine on
the long window; a claim that somebody currently holds an office, or that a committee
currently belongs to a named member, is not. The list and that reasoning live beside
the code that applies them, in `alethical/api/routers/public.py`.

A signed-in reader's response is never held at a shared cache: the middleware
skips any request carrying `Authorization`, pinned by
`test_a_signed_in_read_is_never_given_a_shared_window`. Which window each read gets
is pinned one group at a time, and swept across every route the app serves, by the
`_window` tests beside it in `alethical/tests/test_api_contract.py`.

## Starting topology before 20 July 2026

- Frontend: `alethical.com` / `www` on **Vercel**.
- API: `alethical-api-production.up.railway.app` on **Railway** (no custom
  domain, no cache in front).
- DNS/registrar: **Porkbun** (nameservers `*.ns.porkbun.com`).

## Recommended approach — Cloudflare, full zone

Cloudflare's free plan honors origin `Cache-Control`, caches JSON via a single
Cache Rule, and also accelerates/protects the whole site. The one-time cost is
moving `alethical.com`'s nameservers from Porkbun to Cloudflare. **Porkbun stays
the registrar** — we only change the nameserver delegation, so ownership,
renewal, and WHOIS remain at Porkbun; only DNS *hosting* (and record editing)
moves to Cloudflare. Cloudflare auto-imports the existing DNS records on zone
add; we verify the import is complete **before** the nameserver cutover so the
live site never breaks.

(Lower-commitment alternative, if you'd rather not move the zone: a pull-CDN that
gives you a CNAME target — Bunny, Fastly, CloudFront — added as a single
`api.alethical.com` CNAME at Porkbun, origin = the Railway host. Same end result
for the API; skips the nameserver move but doesn't accelerate the main site and
is a little more setup per provider. The steps below assume Cloudflare.)

## Steps

Split by who must do each: account/registrar actions are yours (I can't create
accounts or move nameservers); the configuration I can drive once you grant a
scoped token.

### You — account & registrar (one-time)
1. Create a **Cloudflare** account (free plan).
2. **Add site** `alethical.com`. Let Cloudflare scan and import the existing DNS
   records. **Do not change nameservers yet.**
3. Create a **scoped API token** (My Profile → API Tokens → Create) with, for
   zone `alethical.com`: `Zone.DNS: Edit`, `Zone.Cache Rules: Edit`,
   `Zone.Zone Settings: Read`, `Zone.Zone: Read`. Send it to me via a secret
   channel (not chat). This lets me finish the config and verify.
4. After I confirm the imported records match Porkbun (step 5), **change the
   nameservers at Porkbun** to the two Cloudflare gave you. This is the cutover.

### Me — configuration (with the token)
5. **Pre-cutover safety check:** read every imported Cloudflare DNS record and
   diff it against the current Porkbun records, so the apex/`www`/mail/verification
   records are all present. I report the diff; you only flip nameservers once it's
   clean. (Frontend records stay **DNS-only / grey-cloud** so Vercel is untouched.)
6. Add a **proxied** (orange-cloud) record for the API:
   `CNAME api.alethical.com → alethical-api-production.up.railway.app`.
7. Make Railway accept the new host. Railway routes by the `Host` header, and
   `api.alethical.com` is a host it doesn't know yet. Two ways:
   - **Railway custom domain (recommended):** add `api.alethical.com` in Railway
     (needs Railway access, or you click "add domain" in the Railway UI) so
     Railway issues a real TLS cert for it and routes on the true host. Canonical
     setup — Full (strict) TLS with a matching cert, no per-request header
     rewriting. One-time friction: Railway's domain verification with a *proxied*
     record can be fiddly (grey-cloud the record to verify, then re-proxy).
   - **Cloudflare Origin Rule (shortcut):** Cloudflare rewrites the Host header
     sent to origin back to `alethical-api-production.up.railway.app`, so Railway
     needs no change. Fastest and fully reversible, good for a trial — but it
     permanently leaves the public host ≠ origin host, which can surprise on
     redirects/absolute-URL/cookie edge cases. Our API is stateless JSON so the
     risk is low. Use this if Railway access isn't available.
8. Add a **Cache Rule** (Rules → Caching). Match expression:

   ```
   (http.host eq "api.alethical.com"
    and http.request.method eq "GET"
    and starts_with(http.request.uri.path, "/api/v1/")
    and not any(http.request.headers.names[*] eq "authorization"))
   ```

   Action: **Eligible for cache** on; **Edge TTL = Respect origin** ("Use
   cache-control header if present"); Browser TTL = respect origin. This caches
   the JSON, honoring `max-age`/`s-w-r` for anonymous reads and skipping
   `private, no-store` for signed-in ones. Two independent safety nets keep
   per-user data out of the shared cache: the `authorization`-header exclusion in
   the match, and the app tagging user-varying responses `private, no-store`.

   The **entire** public `/api/v1` GET surface is safe to target: every public
   read endpoint sends an explicit `public` Cache-Control — the bill endpoints via
   PR #363, and everything else (legislators, districts, meta, sessions,
   policy-areas, search, bill actions/versions) via the response middleware in PR
   #423. Public read paths: `bills*`, `legislators*`, `districts*`, `meta`,
   `sessions*`, `policy-areas`, `search`.
9. Point the frontend at the new host: set Vercel env
   `EXPO_PUBLIC_API_URL=https://api.alethical.com` and redeploy. I can do this
   with a Vercel token (a `VERCEL_TOKEN` already exists in GitHub Actions), or you
   set it in the Vercel dashboard. CORS is unaffected — the frontend origin is
   still `alethical.com`, which the API already allows.

### Verification (me)
10. `curl -sD- https://api.alethical.com/api/v1/bills?limit=2 -o /dev/null`
    twice: expect `cf-cache-status: MISS` then **`HIT`**, TTFB dropping to tens of
    ms on the hit.
11. Confirm a signed-in tracking request shows `cf-cache-status: BYPASS`/`DYNAMIC`
    (i.e. `private, no-store` is respected — no personal data cached).
12. Load the live app and confirm it fetches from `api.alethical.com` and renders
    (mobile home, bill detail, search).

## Status (2026-07-20)

Done manually via the Cloudflare/Railway/Porkbun dashboards:
- Cloudflare account created, `alethical.com` zone added, DNS import verified
  (A + `www` → Vercel; MX + TXT → Google). Porkbun remains registrar.
- Nameservers flipped at Porkbun (`isla`/`lochlan.ns.cloudflare.com`), live.
- Vercel records left **DNS-only** (grey cloud) — Vercel runs its own TLS/CDN.
- `api.alethical.com` on the **Railway custom-domain** path (port 8080), Railway
  cert issued, Cloudflare CNAME proxied. Verified Full (strict) TLS end to end.

Done via the Cloudflare API (scoped token in the gitignored `.env` as
`CLOUDFLARE_API_TOKEN`):
- **Cache Rule** live (step 8 expression). Verified: `api.alethical.com/api/v1/bills`
  `cf-cache-status: MISS` (2.3 s) → **`HIT` (0.32 s)**; `/api/v1/legislators`
  MISS (0.9 s) → HIT (0.13 s); an `Authorization`-bearing request returns
  `DYNAMIC` (never cached). The whole `/api/v1` public GET surface caches now that
  #423 is deployed.
- **SPF + DMARC** added (see below), both resolving.

**CDN work is complete.** Remaining optional follow-ups: tighten DMARC after a
monitoring period, and reduce origin-side latency (issue #364 backend items).

## Email authentication (SPF / DMARC / DKIM)

Adding the zone surfaced that `alethical.com` had **no SPF and no DMARC** — Google
Workspace mail (`MX → smtp.google.com`) was unprotected against spoofing. Both are
now added (both additive, zero delivery impact), and DKIM was already present:

| Type | Name | Value | Status |
| --- | --- | --- | --- |
| TXT | `@` | `v=spf1 include:_spf.google.com ~all` | added, resolving |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:eug@alethical.com` | added, resolving |
| TXT | `google._domainkey` | `v=DKIM1; …` | already present |

DMARC is at `p=none` (monitor only); after a couple weeks of clean reports at
`rua`, tighten to `p=quarantine` then `p=reject`. **Before tightening**, if
anything other than Google Workspace sends mail as `@alethical.com` (a marketing
or transactional-email provider), add its `include:` to the SPF record first, or
those messages will start failing.

## Open follow-ups

- **Frontend host — done.** `EXPO_PUBLIC_API_URL` was repointed to
  `https://api.alethical.com` (Vercel production) and the app redeployed. Verified
  on live `alethical.com`: all `/api/v1` calls now go to `api.alethical.com`, and a
  repeat fetch dropped 1197 ms → 66 ms (edge cache). CORS unaffected — browser
  origin stays `alethical.com`.
- **Tighten DMARC** from `p=none` to `quarantine`/`reject` after a monitoring
  period (check `rua` reports first; add any non-Google sender to SPF beforehand).
- **Origin latency:** the uncached first-hit is still ~1–2 s (cross-region
  multi-query DB path) — backend items tracked in #364.

## Rollback

Every step is reversible: unproxy the `api` record (grey-cloud) or point
`EXPO_PUBLIC_API_URL` back to the Railway host and redeploy — traffic returns to
the direct origin immediately. Nameservers can be pointed back to Porkbun if
needed (propagation applies).
