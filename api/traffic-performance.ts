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
const QUERY = `query TrafficVitals($accountTag: string!, $host: string!, $start: Date!, $end: Date!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      vitals: rumWebVitalsEventsAdaptiveGroups(
        limit: 1
        filter: {
          requestHost: $host, date_geq: $start, date_leq: $end, bot: 0,
          navigationType_in: ${JSON.stringify(DOCUMENT_NAVIGATION_TYPES)}
        }
      ) {
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
      }
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
  const periodStartedOn = new Date(today - 30 * DAY_MS)
    .toISOString()
    .slice(0, 10);
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
      data?: { viewer?: { accounts?: Array<{ vitals?: VitalsGroup[] }> } };
      errors?: unknown;
    };
    if (
      payload.errors &&
      (!Array.isArray(payload.errors) || payload.errors.length > 0)
    )
      throw new PerformanceUnavailable("Cloudflare returned errors");
    const group = payload.data?.viewer?.accounts?.[0]?.vitals?.[0];
    const lcpSamples = sampleCount(
      group?.confidence?.sum?.lcpTotal?.sampleSize,
    );
    const inpSamples = sampleCount(
      group?.confidence?.sum?.inpTotal?.sampleSize,
    );
    const clsSamples = sampleCount(
      group?.confidence?.sum?.clsTotal?.sampleSize,
    );
    const sampleInterval = group?.avg?.sampleInterval;
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
        measurementScope: "document-loads",
        navigationTypes: DOCUMENT_NAVIGATION_TYPES,
        knownBotsExcluded: true,
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
