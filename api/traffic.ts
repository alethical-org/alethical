type RequestLike = { method?: string };
type ResponseLike = {
  status: (code: number) => ResponseLike;
  setHeader: (name: string, value: string) => void;
  send: (body: string) => void;
};

type AggregatePayload = {
  query?: { since?: unknown; until?: unknown };
  data?: unknown;
};

type AggregateRow = { timestamp?: unknown; pageviews?: unknown };

const AGGREGATE_ENDPOINT =
  "https://api.vercel.com/v1/query/web-analytics/visits/aggregate";
const HOUR_MS = 60 * 60 * 1000;
const MAX_HOURS_PER_QUERY = 168;
const THIRTY_DAYS_IN_HOURS = 30 * 24;
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
  payload: AggregatePayload,
  requestedSince: number,
  requestedUntilExclusive: number,
) {
  const actualSince = parsedDate(payload.query?.since);
  const actualUntil = parsedDate(payload.query?.until);
  if (actualSince === null || actualUntil === null) return false;

  return (
    Math.abs(actualSince - requestedSince) <= RANGE_TOLERANCE_MS &&
    Math.abs(actualUntil - requestedUntilExclusive) <= RANGE_TOLERANCE_MS
  );
}

async function aggregatePageViewHours(
  since: number,
  untilExclusive: number,
  token: string,
  projectId: string,
  teamId: string,
): Promise<number[]> {
  const expectedRows = (untilExclusive - since) / HOUR_MS;
  if (
    !Number.isInteger(expectedRows) ||
    expectedRows < 1 ||
    expectedRows > MAX_HOURS_PER_QUERY
  ) {
    throw new TrafficUnavailable("Invalid traffic time range");
  }

  const url = new URL(AGGREGATE_ENDPOINT);
  url.searchParams.set("projectId", projectId);
  url.searchParams.set("teamId", teamId);
  url.searchParams.set("since", String(since));
  // Vercel treats `until` as inclusive. One millisecond before the boundary
  // keeps the response to completed hours and makes its echoed end exclusive.
  url.searchParams.set("until", String(untilExclusive - 1));
  url.searchParams.set("by", "hour");
  url.searchParams.set("limit", "100");

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

  let payload: AggregatePayload;
  try {
    payload = (await result.json()) as AggregatePayload;
  } catch {
    throw new TrafficUnavailable("Vercel returned unreadable data");
  }

  if (
    !Array.isArray(payload.data) ||
    !rangeMatches(payload, since, untilExclusive)
  ) {
    throw new TrafficUnavailable("Vercel returned incomplete traffic data");
  }

  const pageViews = Array<number>(expectedRows).fill(0);
  const seenHours = new Set<number>();
  for (const row of payload.data as AggregateRow[]) {
    const timestamp = parsedDate(row.timestamp);
    const index = timestamp === null ? -1 : (timestamp - since) / HOUR_MS;
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= expectedRows ||
      seenHours.has(index) ||
      !nonNegativeInteger(row.pageviews)
    ) {
      throw new TrafficUnavailable("Vercel returned incomplete traffic data");
    }
    seenHours.add(index);
    pageViews[index] = row.pageviews;
  }

  return pageViews;
}

function chunkedHourRanges(since: number, untilExclusive: number) {
  const ranges: Array<{ since: number; untilExclusive: number }> = [];
  for (
    let start = since;
    start < untilExclusive;
    start += MAX_HOURS_PER_QUERY * HOUR_MS
  ) {
    ranges.push({
      since: start,
      untilExclusive: Math.min(
        start + MAX_HOURS_PER_QUERY * HOUR_MS,
        untilExclusive,
      ),
    });
  }
  return ranges;
}

function sumLast(values: number[], hours: number) {
  return values.slice(-hours).reduce((total, value) => total + value, 0);
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
    const windowEndedAt = Math.floor(fetchedAt / HOUR_MS) * HOUR_MS;
    const windowStartedAt = windowEndedAt - THIRTY_DAYS_IN_HOURS * HOUR_MS;
    const ranges = chunkedHourRanges(windowStartedAt, windowEndedAt);
    const pageViewsByHour = (
      await Promise.all(
        ranges.map((range) =>
          aggregatePageViewHours(
            range.since,
            range.untilExclusive,
            token,
            projectId,
            teamId,
          ),
        ),
      )
    ).flat();

    if (pageViewsByHour.length !== THIRTY_DAYS_IN_HOURS) {
      throw new TrafficUnavailable("Vercel returned incomplete traffic data");
    }

    sendJson(
      response,
      200,
      {
        pageViews24h: sumLast(pageViewsByHour, 24),
        pageViews7d: sumLast(pageViewsByHour, 7 * 24),
        pageViews30d: sumLast(pageViewsByHour, THIRTY_DAYS_IN_HOURS),
        fetchedAt: new Date(fetchedAt).toISOString(),
        windowEndedAt: new Date(windowEndedAt).toISOString(),
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
