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
(Railway `us-east-1` ↔ Supabase `us-east-2`, ~6 queries per request) plus app
overhead — not any single slow query. Squeezing the queries further is
diminishing returns. Caching the *response* skips all of it: bill lists and bill
detail are public records that change only when ingestion runs (infrequent,
human-triggered), so they are safe to serve from an edge cache for a short TTL.

The response headers that drive the cache are **already live** (PR #363):

```
Cache-Control: public, max-age=60, stale-while-revalidate=300   # anonymous reads
Cache-Control: private, no-store                                # signed-in / tracking reads
```

So the edge caches public reads for 60 s (and serves a slightly-stale copy for
up to 5 more minutes while it refreshes), and never caches a signed-in user's
personalized response.

## Current topology

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

- **Frontend host (activates the CDN for users):** the deployed app still calls
  `alethical-api-production.up.railway.app` directly, so it isn't getting the CDN
  yet. Point `EXPO_PUBLIC_API_URL` at `https://api.alethical.com` in Vercel and
  redeploy (it's a build-time var, so a rebuild is required). Mine to drive once a
  `VERCEL_TOKEN` is in `.env` (same pattern as the Cloudflare token), or a
  two-field change in the Vercel dashboard. CORS is unaffected — the browser origin
  stays `alethical.com`.
- **Tighten DMARC** from `p=none` to `quarantine`/`reject` after a monitoring
  period (check `rua` reports first; add any non-Google sender to SPF beforehand).
- **Origin latency:** the uncached first-hit is still ~1–2 s (cross-region
  multi-query DB path) — backend items tracked in #364.

## Rollback

Every step is reversible: unproxy the `api` record (grey-cloud) or point
`EXPO_PUBLIC_API_URL` back to the Railway host and redeploy — traffic returns to
the direct origin immediately. Nameservers can be pointed back to Porkbun if
needed (propagation applies).
