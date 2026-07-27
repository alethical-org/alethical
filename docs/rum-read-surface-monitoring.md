# Real-user monitoring: read-surface latency (#516)

**Net:** This is how we see what *real* visitors experience when the bills list
loads or a filter chip is applied — timing measured on their device, from their
location — instead of guessing from lab curls. It's built end to end but ships
**off**; nothing is collected until the maintainer flips one flag. When it's on,
a documented SQL query returns p50/p75/p95 latency broken down by device,
cold/warm, cache hit/miss, and rough region.

## What it does

1. **Capture** (client): when the bills list loads or a filter is applied, the
   query layer measures the request's duration and reads a few coarse dimensions
   off the device and response.
2. **Send** (client): a small fraction of those measurements (sampled) are
   POSTed as a fire-and-forget beacon to `/api/v1/rum`. Capture and send are
   separate modules (`apps/frontend/src/lib/rum/`) so the sink can later be
   swapped for a hosted tool (PostHog / Sentry / Cloudflare) without touching
   instrumentation — replace `send.ts`'s `deliver`.
3. **Sink** (backend): `POST /api/v1/rum` validates the event, rate-limits per
   client, caps body size, and writes one row to `rum_latency_event`.
4. **Readout**: the SQL below returns p50/p75/p95 by dimension. No dashboard.

## Privacy posture — exactly what is collected

Timing + coarse dimensions **only**. No PII, no personal data, no precise
location, no IP, no user id, no user agent is ever stored. The payload's shape is
pinned by `RumEventRequest` (`alethical/api/schemas.py`), which **forbids extra
fields**, so nothing else can be smuggled in. Fields stored in
`rum_latency_event`:

| Field           | Meaning                                                            |
| --------------- | ------------------------------------------------------------------ |
| `interaction`   | `bills_list` or `bills_filter` — which read was measured            |
| `duration_ms`   | client-measured total request duration                             |
| `ttfb_ms`       | time-to-first-byte when the platform exposes it (web), else null   |
| `cache_status`  | `hit` / `miss` / `unknown` — from `cf-cache-status` / `age`         |
| `device_class`  | `mobile` / `desktop`                                               |
| `cold`          | first measured read of the app session (cold) vs a later one (warm) |
| `coarse_geo`    | the visitor's IANA timezone (e.g. `America/Chicago`) — region only  |
| `created_at`    | server-stamped receive time (server side, never client-supplied)   |

The per-client rate-limit key uses the request IP **in memory only** (same as
the existing `/ask` limiter) — it is never written to the table.

## Enabling collection (default: OFF)

Collection is gated on the client and ships disabled, so no real-user data is
collected until it's deliberately turned on. To enable in an environment, set:

```
EXPO_PUBLIC_RUM_ENABLED=true          # required — off unless exactly "true"
EXPO_PUBLIC_RUM_SAMPLE_RATE=0.1       # optional — fraction of loads sent, default 0.1 (10%)
```

Optional backend tuning (per-client beacon ceiling, default 60/min):

```
ALETHICAL_RUM_RATE_PER_MIN=60
```

To turn it back off, unset `EXPO_PUBLIC_RUM_ENABLED` (or set it to anything other
than `true`) and redeploy the frontend. The backend endpoint is harmless when
idle — it simply receives nothing.

## Readout query — p50/p75/p95 by dimension

Run against the app database (read-only). Adjust the time window as needed.

```sql
SELECT
  interaction,
  device_class,
  cold,
  cache_status,
  coarse_geo,
  count(*)                                                        AS samples,
  round(percentile_cont(0.50) WITHIN GROUP (ORDER BY duration_ms))::int AS p50_ms,
  round(percentile_cont(0.75) WITHIN GROUP (ORDER BY duration_ms))::int AS p75_ms,
  round(percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms))::int AS p95_ms
FROM rum_latency_event
WHERE created_at >= now() - interval '7 days'
GROUP BY interaction, device_class, cold, cache_status, coarse_geo
ORDER BY interaction, samples DESC;
```

Coarser roll-up (just interaction × cache status), useful for a quick read:

```sql
SELECT
  interaction,
  cache_status,
  count(*)                                                        AS samples,
  round(percentile_cont(0.50) WITHIN GROUP (ORDER BY duration_ms))::int AS p50_ms,
  round(percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms))::int AS p95_ms
FROM rum_latency_event
WHERE created_at >= now() - interval '7 days'
GROUP BY interaction, cache_status
ORDER BY interaction, samples DESC;
```

The grouped percentile shape is pinned by
`alethical/tests/test_rum_beacon.py::test_readout_query_returns_sane_percentiles`.
