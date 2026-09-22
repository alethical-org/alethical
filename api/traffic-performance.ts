type RequestLike = { method?: string };
type ResponseLike = {
  status: (code: number) => ResponseLike;
  setHeader: (name: string, value: string) => void;
  send: (body: string) => void;
};

type VitalsGroup = {
  quantiles?: {
    largestContentfulPaintP75?: unknown;
    interactionToNextPaintP75?: unknown;
    cumulativeLayoutShiftP75?: unknown;
  };
  confidence?: {
    sum?: {
      lcpTotal?: { sampleSize?: unknown };
      inpTotal?: { sampleSize?: unknown };
      clsTotal?: { sampleSize?: unknown };
    };
  };
  avg?: { sampleInterval?: unknown };
};

const ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";
const OK_CACHE = "public, max-age=0, s-maxage=300, stale-while-revalidate=60";
const DAY_MS = 86_400_000;
const MIN_SAMPLES = 50;
// Cache/prefetch delivery is a separate dimension. Do not filter it out.
// https://developers.cloudflare.com/web-analytics/data-metrics/dimensions/
const DOCUMENT_NAVIGATION_TYPES = [
  "navigate",
  "reload",
  "back-forward",
  "restore",
  "prerender",
];
// Cloudflare's bot flag does not catch an automated client pool that runs the page
// program and reports measurements, so bot: 0 alone published a figure describing a
// scraper rather than a reader: over 15 to 21 Sep 2026 the same committee pages
// measured 4,524 ms with the pool in and 644 ms with it out, on opposite sides of
// the 2,500 ms limit. The pool reports itself as these browser-and-version pairs,
// each about 2 years behind its browser's current version; on /money/payments the 10
// browser-and-operating-system combinations they make up each carried 9.8% to 10.1%
// of 22,680 measurements, which is a fixed pool drawn from evenly rather than a
// population of people. Evidence and honest limits:
// docs/research/real-visitor-page-speed-sources.md, issue 2337.
const AUTOMATED_CLIENT_POOL: Array<[string, string[]]> = [
  ["Chrome", ["118", "119", "120"]],
  ["Firefox", ["120", "121"]],
  ["Edge", ["119", "120"]],
];
// Cloudflare recorded no browser version for this account before 11 Sep 2026 and
// recorded it for whole days from the 12th. A "not one of these versions" filter
// keeps the pool on an earlier day instead of removing it, so the window starts here
// at the earliest and the page prints the window it actually read.
const SEPARATION_POSSIBLE_FROM = "2026-09-12";
const READERS_ONLY = `AND: [${AUTOMATED_CLIENT_POOL.map(
  ([browser, versions]) =>
    `{ OR: [{ userAgentBrowser_neq: ${JSON.stringify(browser)} },` +
    ` { browserVersion_notin: ${JSON.stringify(versions)} }] }`,
).join(", ")}]`;
const VITALS_FIELDS = `{
        quantiles {
          largestContentfulPaintP75
          interactionToNextPaintP75
          cumulativeLayoutShiftP75
        }
        confidence(level: 0.95) {
          sum {
            lcpTotal { sampleSize }
            inpTotal { sampleSize }
            clsTotal { sampleSize }
          }
        }
        avg { sampleInterval }
      }`;
const BASE_FILTER = `requestHost: $host, date_geq: $start, date_leq: $end, bot: 0,
          navigationType_in: ${JSON.stringify(DOCUMENT_NAVIGATION_TYPES)}`;
const QUERY = `query TrafficVitals($accountTag: string!, $host: string!, $start: Date!, $end: Date!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      everyClient: rumWebVitalsEventsAdaptiveGroups(
        limit: 1
        filter: { ${BASE_FILTER} }
      ) ${VITALS_FIELDS}
      vitals: rumWebVitalsEventsAdaptiveGroups(
        limit: 1
        filter: { ${BASE_FILTER}, ${READERS_ONLY} }
      ) ${VITALS_FIELDS}
    }
  }
}`;

class PerformanceUnavailable extends Error {}

function sendJson(
  response: ResponseLike,
  status: number,
  body: object,
  cacheControl: string,
) {
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", cacheControl);
  response.status(status).send(JSON.stringify(body));
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function sampleCount(value: unknown): number {
  // Adaptive sums estimate traffic. sampleSize counts the actual observations
  // behind each metric, not all beacon events or sum / average sampleInterval.
  // https://developers.cloudflare.com/analytics/graphql-api/features/confidence-intervals/
  if (!finiteNonNegative(value) || !Number.isSafeInteger(value)) {
    throw new PerformanceUnavailable(
      "Cloudflare returned incomplete sample counts",
    );
  }
  return value;
}

function enough(
  value: unknown,
  count: number,
  transform: (value: number) => number,
) {
  if (count < MIN_SAMPLES) return null;
  if (!finiteNonNegative(value)) {
    throw new PerformanceUnavailable("Cloudflare returned an invalid score");
  }
  return transform(value);
}

export default async function handler(
  request: RequestLike,
  response: ResponseLike,
) {
  if (request.method && request.method !== "GET") {
    response.setHeader("Allow", "GET");
    sendJson(response, 405, { error: "Method not allowed." }, "no-store");
    return;
  }
  const token = process.env.CLOUDFLARE_ANALYTICS_API_TOKEN?.trim();
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  if (!token || !accountId) {
    sendJson(
      response,
      503,
      { error: "Page speed data is temporarily unavailable." },
      "no-store",
    );
    return;
  }

  const fetchedAt = new Date();
  // Last 30 complete UTC days. Exclude today's partial measurements.
  const today = Date.parse(
    `${fetchedAt.toISOString().slice(0, 10)}T00:00:00.000Z`,
  );
  const periodEndedOn = new Date(today - DAY_MS).toISOString().slice(0, 10);
  const thirtyDaysAgo = new Date(today - 30 * DAY_MS).toISOString().slice(0, 10);
  // Whichever is later. Reaching further back would publish a figure with the
  // automated client pool still in it, which is the whole defect this separates.
  const periodStartedOn =
    thirtyDaysAgo > SEPARATION_POSSIBLE_FROM
      ? thirtyDaysAgo
      : SEPARATION_POSSIBLE_FROM;
  if (periodStartedOn > periodEndedOn) {
    sendJson(
      response,
      503,
      { error: "Page speed data is temporarily unavailable." },
      "no-store",
    );
    return;
  }
  try {
    let result: Response;
    try {
      result = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: QUERY,
          variables: {
            accountTag: accountId,
            host: "www.alethical.com",
            start: periodStartedOn,
            end: periodEndedOn,
          },
        }),
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      throw new PerformanceUnavailable("Cloudflare could not be reached");
    }
    if (!result.ok) {
      throw new PerformanceUnavailable(`Cloudflare returned ${result.status}`);
    }
    const payload = (await result.json()) as {
      data?: {
        viewer?: {
          accounts?: Array<{
            vitals?: VitalsGroup[];
            everyClient?: VitalsGroup[];
          }>;
        };
      };
      errors?: unknown;
    };
    if (
      payload.errors &&
      (!Array.isArray(payload.errors) || payload.errors.length > 0)
    )
      throw new PerformanceUnavailable("Cloudflare returned errors");
    const account = payload.data?.viewer?.accounts?.[0];
    const group = account?.vitals?.[0];
    const everyClient = account?.everyClient?.[0];
    const lcpSamples = sampleCount(
      group?.confidence?.sum?.lcpTotal?.sampleSize,
    );
    const inpSamples = sampleCount(
      group?.confidence?.sum?.inpTotal?.sampleSize,
    );
    const clsSamples = sampleCount(
      group?.confidence?.sum?.clsTotal?.sampleSize,
    );
    const everyClientSamples = sampleCount(
      everyClient?.confidence?.sum?.lcpTotal?.sampleSize,
    );
    if (everyClientSamples < lcpSamples) {
      throw new PerformanceUnavailable("Cloudflare returned inconsistent counts");
    }
    // The interval describes the sampling, not the population, and the wider group
    // always has rows to report it from.
    const sampleInterval = everyClient?.avg?.sampleInterval;
    if (!finiteNonNegative(sampleInterval) || sampleInterval < 1) {
      throw new PerformanceUnavailable("Cloudflare returned incomplete data");
    }

    sendJson(
      response,
      200,
      {
        lcpP75Ms: enough(
          group?.quantiles?.largestContentfulPaintP75,
          lcpSamples,
          (value) => Math.round(value / 1000),
        ),
        lcpSamples,
        inpP75Ms: enough(
          group?.quantiles?.interactionToNextPaintP75,
          inpSamples,
          (value) => Math.round(value / 1000),
        ),
        inpSamples,
        clsP75: enough(
          group?.quantiles?.cumulativeLayoutShiftP75,
          clsSamples,
          (value) => Math.round(value * 1000) / 1000,
        ),
        clsSamples,
        sampleInterval,
        automatedSamples: everyClientSamples - lcpSamples,
        automatedClientsSeparated: true,
        measurementScope: "document-loads",
        navigationTypes: DOCUMENT_NAVIGATION_TYPES,
        knownBotsExcluded: true,
        // Named so this can never be read as the same population as api/traffic.ts,
        // which counts page views at Vercel with no bot filter asked for.
        measurementSource: "cloudflare-web-analytics",
        sampleCountSource: "cloudflare-confidence",
        minimumSamples: MIN_SAMPLES,
        periodStartedOn,
        periodEndedOn,
        fetchedAt: fetchedAt.toISOString(),
      },
      OK_CACHE,
    );
  } catch {
    sendJson(
      response,
      503,
      { error: "Page speed data is temporarily unavailable." },
      "no-store",
    );
  }
}
