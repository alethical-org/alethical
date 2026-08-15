type RequestLike = { method?: string };
type ResponseLike = {
  status: (code: number) => ResponseLike;
  setHeader: (name: string, value: string) => void;
  send: (body: string) => void;
};

type AggregatePayload = {
  query?: {
    since?: unknown;
    until?: unknown;
    groupBy?: unknown;
    filter?: unknown;
    limit?: unknown;
  };
  data?: unknown;
};

type AggregateRow = {
  timestamp?: unknown;
  requestPath?: unknown;
  pageviews?: unknown;
};

type VisitCount = { pageviews: number; visitors: number };
type ProfileTotals = {
  pageViews: number;
  differentProfilesViewed: { count: number; capped: boolean; cap: number };
};

const AGGREGATE_ENDPOINT =
  "https://api.vercel.com/v1/query/web-analytics/visits/aggregate";
const COUNT_ENDPOINT =
  "https://api.vercel.com/v1/query/web-analytics/visits/count";
const HOUR_MS = 60 * 60 * 1000;
const MAX_HOURS_PER_QUERY = 168;
const THIRTY_DAYS_IN_HOURS = 30 * 24;
const PATH_LIMIT = 100;
const RANGE_TOLERANCE_MS = 60 * 1000;
const OK_CACHE = "public, max-age=0, s-maxage=300, stale-while-revalidate=60";
const HOME_FILTER = "requestPath eq '/'";
const BILLS_FILTER =
  "requestPath eq '/bills' or startswith(requestPath, '/bills/')";
const LEGISLATORS_FILTER =
  "requestPath eq '/legislators' or startswith(requestPath, '/legislators/')";
const BILL_PROFILE_FILTER = "startswith(requestPath, '/bills/')";
const LEGISLATOR_PROFILE_FILTER = "startswith(requestPath, '/legislators/')";

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

function queryMatches(
  payload: AggregatePayload,
  requestedSince: number,
  requestedUntilExclusive: number,
  filter?: string,
) {
  if (!rangeMatches(payload, requestedSince, requestedUntilExclusive)) {
    return false;
  }
  return filter === undefined
    ? payload.query?.filter === undefined
    : payload.query?.filter === filter;
}

function analyticsUrl(
  endpoint: string,
  since: number,
  untilExclusive: number,
  projectId: string,
  teamId: string,
) {
  const url = new URL(endpoint);
  url.searchParams.set("projectId", projectId);
  url.searchParams.set("teamId", teamId);
  url.searchParams.set("since", String(since));
  // Vercel treats `until` as inclusive. One millisecond before the boundary
  // keeps every query to completed hours while allowing the echoed end to round.
  url.searchParams.set("until", String(untilExclusive - 1));
  return url;
}

async function fetchVercel(url: URL, token: string): Promise<AggregatePayload> {
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

  try {
    const payload = (await result.json()) as unknown;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new TrafficUnavailable("Vercel returned unreadable data");
    }
    return payload as AggregatePayload;
  } catch (error) {
    if (error instanceof TrafficUnavailable) throw error;
    throw new TrafficUnavailable("Vercel returned unreadable data");
  }
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

  const url = analyticsUrl(
    AGGREGATE_ENDPOINT,
    since,
    untilExclusive,
    projectId,
    teamId,
  );
  url.searchParams.set("by", "hour");
  url.searchParams.set("limit", "100");

  const payload = await fetchVercel(url, token);

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

async function countVisits(
  since: number,
  untilExclusive: number,
  token: string,
  projectId: string,
  teamId: string,
  filter?: string,
): Promise<VisitCount> {
  const url = analyticsUrl(
    COUNT_ENDPOINT,
    since,
    untilExclusive,
    projectId,
    teamId,
  );
  if (filter) url.searchParams.set("filter", filter);

  const payload = await fetchVercel(url, token);
  if (
    !queryMatches(payload, since, untilExclusive, filter) ||
    !payload.data ||
    typeof payload.data !== "object" ||
    Array.isArray(payload.data)
  ) {
    throw new TrafficUnavailable("Vercel returned incomplete traffic data");
  }

  const data = payload.data as { pageviews?: unknown; visitors?: unknown };
  if (
    !nonNegativeInteger(data.pageviews) ||
    !nonNegativeInteger(data.visitors) ||
    data.visitors > data.pageviews
  ) {
    throw new TrafficUnavailable("Vercel returned incomplete traffic data");
  }
  return { pageviews: data.pageviews, visitors: data.visitors };
}

async function aggregateProfilePaths(
  since: number,
  untilExclusive: number,
  token: string,
  projectId: string,
  teamId: string,
  filter: string,
  prefix: string,
): Promise<ProfileTotals> {
  const url = analyticsUrl(
    AGGREGATE_ENDPOINT,
    since,
    untilExclusive,
    projectId,
    teamId,
  );
  url.searchParams.set("by", "requestPath");
  url.searchParams.set("limit", String(PATH_LIMIT));
  url.searchParams.set("filter", filter);

  const payload = await fetchVercel(url, token);
  if (
    !Array.isArray(payload.data) ||
    !queryMatches(payload, since, untilExclusive, filter) ||
    !Array.isArray(payload.query?.groupBy) ||
    !payload.query.groupBy.includes("requestPath") ||
    payload.query?.limit !== PATH_LIMIT
  ) {
    throw new TrafficUnavailable("Vercel returned incomplete traffic data");
  }

  const seenPaths = new Set<string>();
  const profileIds = new Set<string>();
  let pageViews = 0;
  let capped = false;
  for (const row of payload.data as AggregateRow[]) {
    if (
      typeof row.requestPath !== "string" ||
      seenPaths.has(row.requestPath) ||
      !nonNegativeInteger(row.pageviews)
    ) {
      throw new TrafficUnavailable("Vercel returned incomplete traffic data");
    }
    seenPaths.add(row.requestPath);
    pageViews += row.pageviews;
    if (!Number.isSafeInteger(pageViews)) {
      throw new TrafficUnavailable("Vercel returned incomplete traffic data");
    }

    if (row.requestPath === "Others") {
      if (capped) {
        throw new TrafficUnavailable("Vercel returned incomplete traffic data");
      }
      capped = true;
      continue;
    }
    if (!row.requestPath.startsWith(prefix)) {
      throw new TrafficUnavailable("Vercel returned incomplete traffic data");
    }
    const profileId = row.requestPath.slice(prefix.length).split("/", 1)[0];
    if (!profileId) {
      throw new TrafficUnavailable("Vercel returned incomplete traffic data");
    }
    profileIds.add(profileId);
  }

  return {
    pageViews,
    differentProfilesViewed: {
      count: profileIds.size,
      capped,
      cap: PATH_LIMIT,
    },
  };
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

function trafficBreakdown(
  totalPageViews: number,
  home: VisitCount,
  bills: VisitCount,
  legislators: VisitCount,
  billProfiles: ProfileTotals,
  legislatorProfiles: ProfileTotals,
) {
  const namedPageViews =
    home.pageviews + bills.pageviews + legislators.pageviews;
  if (
    !Number.isSafeInteger(namedPageViews) ||
    namedPageViews > totalPageViews ||
    billProfiles.pageViews > bills.pageviews ||
    legislatorProfiles.pageViews > legislators.pageviews
  ) {
    throw new TrafficUnavailable("Vercel returned inconsistent traffic data");
  }
  return {
    sectionPageViews: {
      home: home.pageviews,
      bills: bills.pageviews,
      legislators: legislators.pageviews,
      other: totalPageViews - namedPageViews,
    },
    billProfiles,
    legislatorProfiles,
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
    const windowEndedAt = Math.floor(fetchedAt / HOUR_MS) * HOUR_MS;
    const windowStartedAt = windowEndedAt - THIRTY_DAYS_IN_HOURS * HOUR_MS;
    const sevenDaysStartedAt = windowEndedAt - 7 * 24 * HOUR_MS;
    const oneDayStartedAt = windowEndedAt - 24 * HOUR_MS;
    const ranges = chunkedHourRanges(windowStartedAt, windowEndedAt);
    const [
      pageViewsByHourParts,
      visits24h,
      visits7d,
      visits30d,
      home7d,
      bills7d,
      legislators7d,
      billProfiles7d,
      legislatorProfiles7d,
      home30d,
      bills30d,
      legislators30d,
      billProfiles30d,
      legislatorProfiles30d,
    ] = await Promise.all([
      Promise.all(
        ranges.map((range) =>
          aggregatePageViewHours(
            range.since,
            range.untilExclusive,
            token,
            projectId,
            teamId,
          ),
        ),
      ),
      countVisits(oneDayStartedAt, windowEndedAt, token, projectId, teamId),
      countVisits(sevenDaysStartedAt, windowEndedAt, token, projectId, teamId),
      countVisits(windowStartedAt, windowEndedAt, token, projectId, teamId),
      countVisits(
        sevenDaysStartedAt,
        windowEndedAt,
        token,
        projectId,
        teamId,
        HOME_FILTER,
      ),
      countVisits(
        sevenDaysStartedAt,
        windowEndedAt,
        token,
        projectId,
        teamId,
        BILLS_FILTER,
      ),
      countVisits(
        sevenDaysStartedAt,
        windowEndedAt,
        token,
        projectId,
        teamId,
        LEGISLATORS_FILTER,
      ),
      aggregateProfilePaths(
        sevenDaysStartedAt,
        windowEndedAt,
        token,
        projectId,
        teamId,
        BILL_PROFILE_FILTER,
        "/bills/",
      ),
      aggregateProfilePaths(
        sevenDaysStartedAt,
        windowEndedAt,
        token,
        projectId,
        teamId,
        LEGISLATOR_PROFILE_FILTER,
        "/legislators/",
      ),
      countVisits(
        windowStartedAt,
        windowEndedAt,
        token,
        projectId,
        teamId,
        HOME_FILTER,
      ),
      countVisits(
        windowStartedAt,
        windowEndedAt,
        token,
        projectId,
        teamId,
        BILLS_FILTER,
      ),
      countVisits(
        windowStartedAt,
        windowEndedAt,
        token,
        projectId,
        teamId,
        LEGISLATORS_FILTER,
      ),
      aggregateProfilePaths(
        windowStartedAt,
        windowEndedAt,
        token,
        projectId,
        teamId,
        BILL_PROFILE_FILTER,
        "/bills/",
      ),
      aggregateProfilePaths(
        windowStartedAt,
        windowEndedAt,
        token,
        projectId,
        teamId,
        LEGISLATOR_PROFILE_FILTER,
        "/legislators/",
      ),
    ]);
    const pageViewsByHour = pageViewsByHourParts.flat();

    if (pageViewsByHour.length !== THIRTY_DAYS_IN_HOURS) {
      throw new TrafficUnavailable("Vercel returned incomplete traffic data");
    }
    const pageViews24h = sumLast(pageViewsByHour, 24);
    const pageViews7d = sumLast(pageViewsByHour, 7 * 24);
    const pageViews30d = sumLast(pageViewsByHour, THIRTY_DAYS_IN_HOURS);
    if (
      visits24h.pageviews !== pageViews24h ||
      visits7d.pageviews !== pageViews7d ||
      visits30d.pageviews !== pageViews30d
    ) {
      throw new TrafficUnavailable("Vercel returned inconsistent traffic data");
    }

    sendJson(
      response,
      200,
      {
        pageViews24h,
        pageViews7d,
        pageViews30d,
        estimatedVisitors24h: visits24h.visitors,
        estimatedVisitors7d: visits7d.visitors,
        estimatedVisitors30d: visits30d.visitors,
        trafficBreakdown7d: trafficBreakdown(
          pageViews7d,
          home7d,
          bills7d,
          legislators7d,
          billProfiles7d,
          legislatorProfiles7d,
        ),
        trafficBreakdown30d: trafficBreakdown(
          pageViews30d,
          home30d,
          bills30d,
          legislators30d,
          billProfiles30d,
          legislatorProfiles30d,
        ),
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
