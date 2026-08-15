type RequestLike = { method?: string };
type ResponseLike = {
  status: (code: number) => ResponseLike;
  setHeader: (name: string, value: string) => void;
  send: (body: string) => void;
};

type CountPayload = {
  query?: { since?: unknown; until?: unknown };
  data?: { pageviews?: unknown; visitors?: unknown };
};

type CountResult = { pageviews: number; visitors: number };

const COUNT_ENDPOINT =
  "https://api.vercel.com/v1/query/web-analytics/visits/count";
const DAY_MS = 24 * 60 * 60 * 1000;
const RANGE_TOLERANCE_MS = 60 * 1000;
const OK_CACHE = "public, max-age=0, s-maxage=300, stale-while-revalidate=60";

class TrafficUnavailable extends Error {}

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

function nonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function parsedDate(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function rangeMatches(
  payload: CountPayload,
  requestedSince: number,
  requestedUntil: number,
  countingStartedAt: number,
) {
  const actualSince = parsedDate(payload.query?.since);
  const actualUntil = parsedDate(payload.query?.until);
  if (actualSince === null || actualUntil === null) return false;

  // Vercel may echo the requested start or clamp it to the date collection
  // began. Both are honest during the first 30 days; anything outside that
  // known interval means the totals do not describe the period on the page.
  const latestHonestSince = Math.max(requestedSince, countingStartedAt);
  return (
    actualSince >= requestedSince - RANGE_TOLERANCE_MS &&
    actualSince <= latestHonestSince + RANGE_TOLERANCE_MS &&
    Math.abs(actualUntil - requestedUntil) <= RANGE_TOLERANCE_MS
  );
}

async function countWindow(
  days: number,
  fetchedAt: number,
  countingStartedAt: number,
  token: string,
  projectId: string,
  teamId: string,
): Promise<CountResult> {
  const since = fetchedAt - days * DAY_MS;
  const url = new URL(COUNT_ENDPOINT);
  url.searchParams.set("projectId", projectId);
  url.searchParams.set("teamId", teamId);
  url.searchParams.set("since", String(since));
  url.searchParams.set("until", String(fetchedAt));

  let result: Response;
  try {
    result = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw new TrafficUnavailable("Vercel could not be reached");
  }
  if (!result.ok) {
    throw new TrafficUnavailable(`Vercel returned ${result.status}`);
  }

  let payload: CountPayload;
  try {
    payload = (await result.json()) as CountPayload;
  } catch {
    throw new TrafficUnavailable("Vercel returned unreadable data");
  }
  if (
    !nonNegativeInteger(payload.data?.pageviews) ||
    !nonNegativeInteger(payload.data?.visitors) ||
    !rangeMatches(payload, since, fetchedAt, countingStartedAt)
  ) {
    throw new TrafficUnavailable("Vercel returned incomplete traffic data");
  }

  return {
    pageviews: payload.data.pageviews,
    visitors: payload.data.visitors,
  };
}

function hasTeamExclusion() {
  return Boolean(
    process.env.TRAFFIC_EXCLUDED_ACCOUNT_IDS?.split(",").some(
      (accountId: string) => accountId.trim().length > 0,
    ),
  );
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

  const token = process.env.VERCEL_ANALYTICS_ACCESS_TOKEN?.trim();
  const projectId = process.env.VERCEL_ANALYTICS_PROJECT_ID?.trim();
  const teamId = process.env.VERCEL_ANALYTICS_TEAM_ID?.trim();
  const countingStartText = process.env.TRAFFIC_COUNTING_STARTED_AT?.trim();
  const countingStartedAt = countingStartText
    ? Date.parse(countingStartText)
    : Number.NaN;
  const fetchedAt = Date.now();

  if (
    !token ||
    !projectId ||
    !teamId ||
    !Number.isFinite(countingStartedAt) ||
    countingStartedAt > fetchedAt
  ) {
    sendJson(
      response,
      503,
      { error: "Traffic data is temporarily unavailable." },
      "no-store",
    );
    return;
  }

  try {
    const [last24Hours, last7Days, last30Days] = await Promise.all([
      countWindow(1, fetchedAt, countingStartedAt, token, projectId, teamId),
      countWindow(7, fetchedAt, countingStartedAt, token, projectId, teamId),
      countWindow(30, fetchedAt, countingStartedAt, token, projectId, teamId),
    ]);

    sendJson(
      response,
      200,
      {
        visitors24h: last24Hours.visitors,
        pageViews24h: last24Hours.pageviews,
        pageViews7d: last7Days.pageviews,
        pageViews30d: last30Days.pageviews,
        fetchedAt: new Date(fetchedAt).toISOString(),
        countingStartedAt: new Date(countingStartedAt).toISOString(),
        teamExclusionConfigured: hasTeamExclusion(),
      },
      OK_CACHE,
    );
  } catch {
    sendJson(
      response,
      503,
      { error: "Traffic data is temporarily unavailable." },
      "no-store",
    );
  }
}
