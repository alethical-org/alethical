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
  sum?: { lcpTotal?: unknown; inpTotal?: unknown; clsTotal?: unknown };
  avg?: { sampleInterval?: unknown };
};

const ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";
const OK_CACHE = "public, max-age=0, s-maxage=300, stale-while-revalidate=60";
const DAY_MS = 86_400_000;
const MIN_SAMPLES = 50;
const QUERY = `query TrafficVitals($accountTag: string!, $host: string!, $start: Date!, $end: Date!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      vitals: rumWebVitalsEventsAdaptiveGroups(
        limit: 1
        filter: { requestHost: $host, date_geq: $start, date_leq: $end }
      ) {
        quantiles {
          largestContentfulPaintP75
          interactionToNextPaintP75
          cumulativeLayoutShiftP75
        }
        sum { lcpTotal inpTotal clsTotal }
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

function enough(value: unknown, count: number, transform: (value: number) => number) {
  return count >= MIN_SAMPLES && finiteNonNegative(value) ? transform(value) : null;
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
  const periodEndedOn = fetchedAt.toISOString().slice(0, 10);
  const periodStartedOn = new Date(
    Date.parse(`${periodEndedOn}T00:00:00.000Z`) - 27 * DAY_MS,
  )
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
    if (payload.errors) throw new PerformanceUnavailable("Cloudflare returned errors");
    const group = payload.data?.viewer?.accounts?.[0]?.vitals?.[0];
    const lcpSamples = Number(group?.sum?.lcpTotal);
    const inpSamples = Number(group?.sum?.inpTotal);
    const clsSamples = Number(group?.sum?.clsTotal);
    const sampleInterval = Number(group?.avg?.sampleInterval);
    if (
      !finiteNonNegative(lcpSamples) ||
      !finiteNonNegative(inpSamples) ||
      !finiteNonNegative(clsSamples) ||
      !finiteNonNegative(sampleInterval)
    ) {
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
