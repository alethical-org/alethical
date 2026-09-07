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
  environment?: unknown;
  pageviews?: unknown;
  visitors?: unknown;
};

type HourlyTraffic = { pageViews: number[] };
type PageViewCount = { pageviews: number };
type VisitorCount = { visitors: number };
type ProfileTotals = {
  pageViews: number;
  differentProfilesViewed: { count: number; capped: boolean; cap: number };
};

const AGGREGATE_ENDPOINT =
  "https://api.vercel.com/v1/query/web-analytics/visits/aggregate";
const HOUR_MS = 60 * 60 * 1000;
const MAX_HOURS_PER_QUERY = 168;
const THIRTY_DAYS_IN_HOURS = 30 * 24;
const PATH_LIMIT = 100;
const RANGE_TOLERANCE_MS = 60 * 1000;
const OK_CACHE =
  "public, max-age=0, s-maxage=300, stale-while-revalidate=60, stale-if-error=86400";
const HOME_FILTER = "requestPath eq '/'";
const BILLS_FILTER =
  "requestPath eq '/bills' or startswith(requestPath, '/bills/')";
const LEGISLATORS_FILTER =
  "requestPath eq '/legislators' or startswith(requestPath, '/legislators/')";
const FIND_MY_LEGISLATOR_FILTER = "requestPath eq '/find-my-legislator'";
const MONEY_FILTER =
  "requestPath eq '/money' or startswith(requestPath, '/money/')";
const READ_FILTER =
  "requestPath eq '/read' or startswith(requestPath, '/read/')";
const ASK_FILTER = "requestPath eq '/ask' or startswith(requestPath, '/ask/')";
const BILL_PROFILE_FILTER = "startswith(requestPath, '/bills/')";
const LEGISLATOR_PROFILE_FILTER = "startswith(requestPath, '/legislators/')";
const PRODUCTION_FILTER = "environment eq 'production'";
const MONEY_PAGES = {
  money: "/money",
  moneySearch: "/money/search",
  moneyByRace: "/money/races",
  moneyCommitteeList: "/money/committees",
  moneyPayments: "/money/payments",
  moneyOutsideSpending: "/money/outside-spending",
} as const;
type MoneyDetails = {
  destinations: Record<keyof typeof MONEY_PAGES, number>;
  committeeProfiles: ProfileTotals;
};

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
  url.searchParams.set("filter", PRODUCTION_FILTER);
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

async function atStage<T>(stage: string, request: Promise<T>): Promise<T> {
  try {
    return await request;
  } catch (error) {
    const reason =
      error instanceof TrafficUnavailable
        ? error.message
        : "Unexpected failure";
    throw new TrafficUnavailable(`${stage}: ${reason}`);
  }
}

async function aggregatePageViewHours(
  since: number,
  untilExclusive: number,
  token: string,
  projectId: string,
  teamId: string,
): Promise<HourlyTraffic> {
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
    !queryMatches(payload, since, untilExclusive, PRODUCTION_FILTER)
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

  return { pageViews };
}

async function aggregatePeriodVisitors(
  since: number,
  untilExclusive: number,
  token: string,
  projectId: string,
  teamId: string,
): Promise<VisitorCount> {
  const url = analyticsUrl(
    AGGREGATE_ENDPOINT,
    since,
    untilExclusive,
    projectId,
    teamId,
  );
  url.searchParams.set("by", "environment");
  url.searchParams.set("limit", "1");
  url.searchParams.set("filter", PRODUCTION_FILTER);

  const payload = await fetchVercel(url, token);
  if (
    !Array.isArray(payload.data) ||
    payload.data.length > 1 ||
    !queryMatches(payload, since, untilExclusive, PRODUCTION_FILTER) ||
    !Array.isArray(payload.query?.groupBy) ||
    !payload.query.groupBy.includes("environment") ||
    payload.query?.limit !== 1
  ) {
    throw new TrafficUnavailable("Vercel returned incomplete traffic data");
  }

  if (payload.data.length === 0) return { visitors: 0 };

  const row = payload.data[0] as AggregateRow;
  if (
    row.environment !== "production" ||
    !nonNegativeInteger(row.pageviews) ||
    !nonNegativeInteger(row.visitors) ||
    row.visitors > row.pageviews
  ) {
    throw new TrafficUnavailable("Vercel returned incomplete traffic data");
  }

  return { visitors: row.visitors };
}

async function aggregateFilteredPageViews(
  since: number,
  untilExclusive: number,
  token: string,
  projectId: string,
  teamId: string,
  filter: string,
  pathMatchesFilter: (path: string) => boolean,
): Promise<PageViewCount> {
  const url = analyticsUrl(
    AGGREGATE_ENDPOINT,
    since,
    untilExclusive,
    projectId,
    teamId,
  );
  url.searchParams.set("by", "requestPath");
  url.searchParams.set("limit", "1");
  const productionFilter = `${PRODUCTION_FILTER} and (${filter})`;
  url.searchParams.set("filter", productionFilter);

  const payload = await fetchVercel(url, token);
  if (
    !Array.isArray(payload.data) ||
    !queryMatches(payload, since, untilExclusive, productionFilter) ||
    !Array.isArray(payload.query?.groupBy) ||
    !payload.query.groupBy.includes("requestPath") ||
    payload.query?.limit !== 1
  ) {
    throw new TrafficUnavailable("Vercel returned incomplete traffic data");
  }

  const seenPaths = new Set<string>();
  let pageviews = 0;
  for (const row of payload.data as AggregateRow[]) {
    if (
      typeof row.requestPath !== "string" ||
      seenPaths.has(row.requestPath) ||
      !nonNegativeInteger(row.pageviews) ||
      (row.requestPath !== "Others" && !pathMatchesFilter(row.requestPath))
    ) {
      throw new TrafficUnavailable("Vercel returned incomplete traffic data");
    }
    seenPaths.add(row.requestPath);
    pageviews += row.pageviews;
    if (!Number.isSafeInteger(pageviews)) {
      throw new TrafficUnavailable("Vercel returned incomplete traffic data");
    }
  }

  return { pageviews };
}

async function aggregateProfilePaths(
  since: number,
  untilExclusive: number,
  token: string,
  projectId: string,
  teamId: string,
  filter: string,
  prefix: string,
  identity: (slug: string) => string | null = (slug) => slug,
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
  const productionFilter = `${PRODUCTION_FILTER} and (${filter})`;
  url.searchParams.set("filter", productionFilter);

  const payload = await fetchVercel(url, token);
  if (
    !Array.isArray(payload.data) ||
    !queryMatches(payload, since, untilExclusive, productionFilter) ||
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
    const id = identity(profileId);
    if (id) profileIds.add(id);
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

async function aggregateMoneyDetails(
  since: number,
  until: number,
  token: string,
  projectId: string,
  teamId: string,
): Promise<MoneyDetails> {
  // Exact addresses fit in one grouped query. Committee pages get their own
  // capped query so thousands of committees cannot hide quiet navigation pages.
  const filter = `${PRODUCTION_FILTER} and (${Object.values(MONEY_PAGES)
    .map((path) => `requestPath eq '${path}'`)
    .join(" or ")})`;
  const url = analyticsUrl(AGGREGATE_ENDPOINT, since, until, projectId, teamId);
  url.searchParams.set("filter", filter);
  url.searchParams.set("by", "requestPath");
  url.searchParams.set("limit", String(PATH_LIMIT));
  const [payload, committeeProfiles] = await Promise.all([
    fetchVercel(url, token),
    aggregateProfilePaths(
      since,
      until,
      token,
      projectId,
      teamId,
      "startswith(requestPath, '/money/committees/')",
      "/money/committees/",
      (slug) => /(\d+)$/.exec(slug)?.[1] ?? null,
    ),
  ]);
  if (
    !Array.isArray(payload.data) ||
    !queryMatches(payload, since, until, filter) ||
    !Array.isArray(payload.query?.groupBy) ||
    !payload.query.groupBy.includes("requestPath") ||
    payload.query?.limit !== PATH_LIMIT
  )
    throw new TrafficUnavailable("Money page totals are incomplete");
  const destinations = Object.fromEntries(
    Object.keys(MONEY_PAGES).map((key) => [key, 0]),
  ) as MoneyDetails["destinations"];
  const seen = new Set<string>();
  for (const row of payload.data as AggregateRow[]) {
    const entry = Object.entries(MONEY_PAGES).find(
      ([, path]) => path === row.requestPath,
    );
    if (!entry || !nonNegativeInteger(row.pageviews) || seen.has(entry[0])) {
      throw new TrafficUnavailable("Money page totals are incomplete");
    }
    seen.add(entry[0]);
    destinations[entry[0] as keyof typeof MONEY_PAGES] = row.pageviews;
  }
  return { destinations, committeeProfiles };
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
  home: PageViewCount,
  bills: PageViewCount,
  legislators: PageViewCount,
  findMyLegislator: PageViewCount,
  money: PageViewCount,
  read: PageViewCount,
  legacyAsk: PageViewCount,
  billProfiles: ProfileTotals,
  legislatorProfiles: ProfileTotals,
  moneyDetails: MoneyDetails | null,
) {
  const namedPageViews =
    home.pageviews +
    bills.pageviews +
    legislators.pageviews +
    findMyLegislator.pageviews +
    money.pageviews +
    read.pageviews +
    legacyAsk.pageviews;
  if (
    !Number.isSafeInteger(namedPageViews) ||
    namedPageViews > totalPageViews ||
    billProfiles.pageViews > bills.pageviews ||
    legislatorProfiles.pageViews > legislators.pageviews
  ) {
    throw new TrafficUnavailable("Vercel returned inconsistent traffic data");
  }
  const detailedMoneyTotal = moneyDetails
    ? Object.values(moneyDetails.destinations).reduce(
        (sum, value) => sum + value,
        0,
      ) + moneyDetails.committeeProfiles.pageViews
    : 0;
  if (
    moneyDetails &&
    (!Number.isSafeInteger(detailedMoneyTotal) ||
      detailedMoneyTotal > money.pageviews)
  ) {
    throw new TrafficUnavailable(
      "Money page totals exceed the money section total",
    );
  }
  return {
    destinationPageViews: {
      home: home.pageviews,
      billSearch: bills.pageviews - billProfiles.pageViews,
      billProfiles: billProfiles.pageViews,
      legislatorSearch: legislators.pageviews - legislatorProfiles.pageViews,
      legislatorProfiles: legislatorProfiles.pageViews,
      findMyLegislator: findMyLegislator.pageviews,
      money: money.pageviews,
      ...(moneyDetails
        ? {
            ...moneyDetails.destinations,
            moneyCommitteeProfiles: moneyDetails.committeeProfiles.pageViews,
            moneyOther: money.pageviews - detailedMoneyTotal,
          }
        : {}),
      read: read.pageviews,
      legacyAsk: legacyAsk.pageviews,
      other: totalPageViews - namedPageViews,
    },
    billProfiles,
    legislatorProfiles,
    ...(moneyDetails
      ? { committeeProfiles: moneyDetails.committeeProfiles }
      : {}),
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
      trafficByHourParts,
      visitors24h,
      visitors7d,
      visitors30d,
      home7d,
      bills7d,
      legislators7d,
      findMyLegislator7d,
      money7d,
      read7d,
      ask7d,
      billProfiles7d,
      legislatorProfiles7d,
      home30d,
      bills30d,
      legislators30d,
      findMyLegislator30d,
      money30d,
      read30d,
      ask30d,
      billProfiles30d,
      legislatorProfiles30d,
      moneyDetails7d,
      moneyDetails30d,
    ] = await Promise.all([
      Promise.all(
        ranges.map((range, index) =>
          atStage(
            `hourly traffic ${index + 1}`,
            aggregatePageViewHours(
              range.since,
              range.untilExclusive,
              token,
              projectId,
              teamId,
            ),
          ),
        ),
      ),
      atStage(
        "24-hour visitor total",
        aggregatePeriodVisitors(
          oneDayStartedAt,
          windowEndedAt,
          token,
          projectId,
          teamId,
        ),
      ),
      atStage(
        "7-day visitor total",
        aggregatePeriodVisitors(
          sevenDaysStartedAt,
          windowEndedAt,
          token,
          projectId,
          teamId,
        ),
      ),
      atStage(
        "30-day visitor total",
        aggregatePeriodVisitors(
          windowStartedAt,
          windowEndedAt,
          token,
          projectId,
          teamId,
        ),
      ),
      atStage(
        "7-day home total",
        aggregateFilteredPageViews(
          sevenDaysStartedAt,
          windowEndedAt,
          token,
          projectId,
          teamId,
          HOME_FILTER,
          (path) => path === "/",
        ),
      ),
      atStage(
        "7-day bills total",
        aggregateFilteredPageViews(
          sevenDaysStartedAt,
          windowEndedAt,
          token,
          projectId,
          teamId,
          BILLS_FILTER,
          (path) => path === "/bills" || path.startsWith("/bills/"),
        ),
      ),
      atStage(
        "7-day legislators total",
        aggregateFilteredPageViews(
          sevenDaysStartedAt,
          windowEndedAt,
          token,
          projectId,
          teamId,
          LEGISLATORS_FILTER,
          (path) => path === "/legislators" || path.startsWith("/legislators/"),
        ),
      ),
      atStage(
        "7-day Find My Legislator total",
        aggregateFilteredPageViews(
          sevenDaysStartedAt,
          windowEndedAt,
          token,
          projectId,
          teamId,
          FIND_MY_LEGISLATOR_FILTER,
          (path) => path === "/find-my-legislator",
        ),
      ),
      atStage(
        "7-day money total",
        aggregateFilteredPageViews(
          sevenDaysStartedAt,
          windowEndedAt,
          token,
          projectId,
          teamId,
          MONEY_FILTER,
          (path) => path === "/money" || path.startsWith("/money/"),
        ),
      ),
      atStage(
        "7-day reading total",
        aggregateFilteredPageViews(
          sevenDaysStartedAt,
          windowEndedAt,
          token,
          projectId,
          teamId,
          READ_FILTER,
          (path) => path === "/read" || path.startsWith("/read/"),
        ),
      ),
      atStage(
        "7-day Ask total",
        aggregateFilteredPageViews(
          sevenDaysStartedAt,
          windowEndedAt,
          token,
          projectId,
          teamId,
          ASK_FILTER,
          (path) => path === "/ask" || path.startsWith("/ask/"),
        ),
      ),
      atStage(
        "7-day bill profiles",
        aggregateProfilePaths(
          sevenDaysStartedAt,
          windowEndedAt,
          token,
          projectId,
          teamId,
          BILL_PROFILE_FILTER,
          "/bills/",
        ),
      ),
      atStage(
        "7-day legislator profiles",
        aggregateProfilePaths(
          sevenDaysStartedAt,
          windowEndedAt,
          token,
          projectId,
          teamId,
          LEGISLATOR_PROFILE_FILTER,
          "/legislators/",
        ),
      ),
      atStage(
        "30-day home total",
        aggregateFilteredPageViews(
          windowStartedAt,
          windowEndedAt,
          token,
          projectId,
          teamId,
          HOME_FILTER,
          (path) => path === "/",
        ),
      ),
      atStage(
        "30-day bills total",
        aggregateFilteredPageViews(
          windowStartedAt,
          windowEndedAt,
          token,
          projectId,
          teamId,
          BILLS_FILTER,
          (path) => path === "/bills" || path.startsWith("/bills/"),
        ),
      ),
      atStage(
        "30-day legislators total",
        aggregateFilteredPageViews(
          windowStartedAt,
          windowEndedAt,
          token,
          projectId,
          teamId,
          LEGISLATORS_FILTER,
          (path) => path === "/legislators" || path.startsWith("/legislators/"),
        ),
      ),
      atStage(
        "30-day Find My Legislator total",
        aggregateFilteredPageViews(
          windowStartedAt,
          windowEndedAt,
          token,
          projectId,
          teamId,
          FIND_MY_LEGISLATOR_FILTER,
          (path) => path === "/find-my-legislator",
        ),
      ),
      atStage(
        "30-day money total",
        aggregateFilteredPageViews(
          windowStartedAt,
          windowEndedAt,
          token,
          projectId,
          teamId,
          MONEY_FILTER,
          (path) => path === "/money" || path.startsWith("/money/"),
        ),
      ),
      atStage(
        "30-day reading total",
        aggregateFilteredPageViews(
          windowStartedAt,
          windowEndedAt,
          token,
          projectId,
          teamId,
          READ_FILTER,
          (path) => path === "/read" || path.startsWith("/read/"),
        ),
      ),
      atStage(
        "30-day Ask total",
        aggregateFilteredPageViews(
          windowStartedAt,
          windowEndedAt,
          token,
          projectId,
          teamId,
          ASK_FILTER,
          (path) => path === "/ask" || path.startsWith("/ask/"),
        ),
      ),
      atStage(
        "30-day bill profiles",
        aggregateProfilePaths(
          windowStartedAt,
          windowEndedAt,
          token,
          projectId,
          teamId,
          BILL_PROFILE_FILTER,
          "/bills/",
        ),
      ),
      atStage(
        "30-day legislator profiles",
        aggregateProfilePaths(
          windowStartedAt,
          windowEndedAt,
          token,
          projectId,
          teamId,
          LEGISLATOR_PROFILE_FILTER,
          "/legislators/",
        ),
      ),
      // A missing new breakdown must not hide existing traffic totals.
      aggregateMoneyDetails(
        sevenDaysStartedAt,
        windowEndedAt,
        token,
        projectId,
        teamId,
      ).catch(() => null),
      aggregateMoneyDetails(
        windowStartedAt,
        windowEndedAt,
        token,
        projectId,
        teamId,
      ).catch(() => null),
    ]);
    const pageViewsByHour = trafficByHourParts.flatMap(
      (traffic) => traffic.pageViews,
    );

    if (pageViewsByHour.length !== THIRTY_DAYS_IN_HOURS) {
      throw new TrafficUnavailable("Vercel returned incomplete traffic data");
    }
    const pageViews24h = sumLast(pageViewsByHour, 24);
    const pageViews7d = sumLast(pageViewsByHour, 7 * 24);
    const pageViews30d = sumLast(pageViewsByHour, THIRTY_DAYS_IN_HOURS);
    const estimatedVisitors24h = visitors24h.visitors;
    const estimatedVisitors7d = visitors7d.visitors;
    const estimatedVisitors30d = visitors30d.visitors;

    sendJson(
      response,
      200,
      {
        pageViews24h,
        pageViews7d,
        pageViews30d,
        estimatedVisitors24h,
        estimatedVisitors7d,
        estimatedVisitors30d,
        trafficBreakdown7d: trafficBreakdown(
          pageViews7d,
          home7d,
          bills7d,
          legislators7d,
          findMyLegislator7d,
          money7d,
          read7d,
          ask7d,
          billProfiles7d,
          legislatorProfiles7d,
          moneyDetails7d,
        ),
        trafficBreakdown30d: trafficBreakdown(
          pageViews30d,
          home30d,
          bills30d,
          legislators30d,
          findMyLegislator30d,
          money30d,
          read30d,
          ask30d,
          billProfiles30d,
          legislatorProfiles30d,
          moneyDetails30d,
        ),
        fetchedAt: new Date(fetchedAt).toISOString(),
        windowEndedAt: new Date(windowEndedAt).toISOString(),
        countingStartedAt: new Date(countingStartedAt).toISOString(),
        teamExclusionConfigured: hasTeamExclusion(),
      },
      OK_CACHE,
    );
  } catch (error) {
    const diagnostic =
      error instanceof TrafficUnavailable
        ? error.message
        : "Unexpected traffic handler failure";
    console.error(diagnostic);
    sendJson(
      response,
      503,
      { error: "Traffic data is temporarily unavailable." },
      "no-store",
    );
  }
}
