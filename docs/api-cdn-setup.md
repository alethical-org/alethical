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
moving `alethical.com`'s nameservers from Porkbun to Cloudflare. Cloudflare
auto-imports the existing DNS records on zone add; we verify the import is
complete **before** the nameserver cutover so the live site never breaks.

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
7. Make Railway accept the new host. Two options:
   - **Origin Rule (no Railway change):** Cloudflare rewrites the Host header sent
     to origin back to `alethical-api-production.up.railway.app`. I can set this
     with the token. Simplest.
   - **Railway custom domain:** add `api.alethical.com` in Railway (needs Railway
     access or you do it in the Railway UI) so Railway routes it and issues TLS.
8. Add a **Cache Rule** (Rules → Caching): when hostname = `api.alethical.com`
   and URI path starts with `/api/v1/`, set **Eligible for cache** and **Respect
   origin Cache-Control** (Edge TTL = "Use cache-control header if present").
   This is what makes Cloudflare cache the JSON; it will honor `max-age`/`s-w-r`
   for anonymous reads and skip `private, no-store` for signed-in ones.
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

## What I need from you to drive it

- The scoped **Cloudflare API token** (step 3).
- Either confirm I should use the **Origin Rule** (step 7, no Railway access
  needed) or grant Railway access to add the custom domain.
- Confirm I may set the **Vercel** env var + redeploy (I can use the existing
  Vercel token path), or you'll do step 9.

The two things only you can do are creating the Cloudflare account (step 1–2) and
flipping the nameservers at Porkbun (step 4). Everything else I can execute and
verify.

## Rollback

Every step is reversible: unproxy the `api` record (grey-cloud) or point
`EXPO_PUBLIC_API_URL` back to the Railway host and redeploy — traffic returns to
the direct origin immediately. Nameservers can be pointed back to Porkbun if
needed (propagation applies).
