import { requireSiteMetricsAdmin } from "./_lib/requireSiteMetricsAdmin";

type RequestLike = {
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
};
type ResponseLike = {
  status: (code: number) => ResponseLike;
  setHeader: (name: string, value: string) => void;
  send: (body: string) => void;
};

const PROVIDER_HOSTS = [
  "chatgpt.com",
  "chat.openai.com",
  "perplexity.ai",
  "www.perplexity.ai",
  "claude.ai",
  "gemini.google.com",
  "copilot.microsoft.com",
] as const;
const HOST_SET = new Set<string>(PROVIDER_HOSTS);
const DAY_MS = 86_400_000;
const MAX_RESPONSE_BYTES = 65_536;
// Verified against this account's GraphQL schema and a successful 30-day read.
// count is page views; sum.visits is page views initiated from another website.
// Neither counts people or sessions. No referring path is requested.
// https://developers.cloudflare.com/web-analytics/data-metrics/high-level-metrics/
const QUERY = `query TrafficReferrals($accountTag: string!, $start: Time!, $end: Time!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      rumPageloadEventsAdaptiveGroups(
        limit: 7
        filter: {
          datetime_geq: $start, datetime_lt: $end,
          requestHost: "www.alethical.com", bot: 0,
          refererHost_in: ${JSON.stringify(PROVIDER_HOSTS)}
        }
        orderBy: [refererHost_ASC]
      ) {
        count
        sum { visits }
        avg { sampleInterval }
        dimensions { refererHost }
      }
    }
  }
}`;

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Incomplete source response");
  }
  return value as Record<string, unknown>;
}

function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error("Invalid source count");
  }
  return value;
}

async function boundedJson(response: Response): Promise<unknown> {
  const length = response.headers.get("content-length");
  if (length && Number(length) > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new Error("Source response too large");
  }
  if (!response.body) throw new Error("Missing source response");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("Source response too large");
      }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    reader.releaseLock();
  }
}

function parseGroups(payload: unknown) {
  const root = object(payload);
  if (
    root.errors != null &&
    (!Array.isArray(root.errors) || root.errors.length !== 0)
  ) {
    throw new Error("Source query failed");
  }
  const accounts = object(object(root.data).viewer).accounts;
  if (!Array.isArray(accounts) || accounts.length !== 1) {
    throw new Error("Missing source account");
  }
  const groups = object(accounts[0]).rumPageloadEventsAdaptiveGroups;
  if (!Array.isArray(groups) || groups.length > PROVIDER_HOSTS.length) {
    throw new Error("Invalid source groups");
  }
  const byHost = new Map<
    string,
    {
      estimatedPageViews: number;
      estimatedExternalEntries: number;
      averageSampleInterval: number;
    }
  >();
  for (const entry of groups) {
    const group = object(entry);
    const rawHost = object(group.dimensions).refererHost;
    if (typeof rawHost !== "string") throw new Error("Missing source host");
    // DNS host case has no meaning; paths, ports and suffix matches stay invalid.
    const host = rawHost.toLowerCase();
    if (!HOST_SET.has(host) || byHost.has(host)) {
      throw new Error("Unexpected source host");
    }
    const averageSampleInterval = object(group.avg).sampleInterval;
    if (
      typeof averageSampleInterval !== "number" ||
      !Number.isFinite(averageSampleInterval) ||
      averageSampleInterval < 1
    ) {
      throw new Error("Invalid source sampling interval");
    }
    byHost.set(host, {
      estimatedPageViews: count(group.count),
      estimatedExternalEntries: count(object(group.sum).visits),
      averageSampleInterval,
    });
  }
  return PROVIDER_HOSTS.map((host) => {
    const metrics = byHost.get(host);
    return {
      host,
      status: metrics ? "returned" : "no-observations-returned",
      estimatedPageViews: metrics?.estimatedPageViews ?? null,
      estimatedExternalEntries: metrics?.estimatedExternalEntries ?? null,
      averageSampleInterval: metrics?.averageSampleInterval ?? null,
    };
  });
}

function send(response: ResponseLike, status: number, body: object) {
  response.status(status).send(JSON.stringify(body));
}

export default async function handler(
  request: RequestLike,
  response: ResponseLike,
) {
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "private, no-store");
  response.setHeader("Vary", "Authorization");
  if (request.method && request.method !== "GET") {
    response.setHeader("Allow", "GET");
    send(response, 405, { error: "Method not allowed." });
    return;
  }
  if (!(await requireSiteMetricsAdmin(request, response))) return;
  const token = process.env.CLOUDFLARE_ANALYTICS_API_TOKEN?.trim();
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const fetchedAt = new Date();
  const today = Date.parse(`${fetchedAt.toISOString().slice(0, 10)}T00:00:00Z`);
  const start = new Date(today - 30 * DAY_MS).toISOString();
  const end = new Date(today).toISOString();
  try {
    if (!token || !accountId) throw new Error("Source access unavailable");
    const result = await fetch("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: QUERY,
        variables: { accountTag: accountId, start, end },
      }),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    if (!result.ok) throw new Error("Source read failed");
    const providers = parseGroups(await boundedJson(result));
    send(response, 200, {
      measurementSource: "cloudflare-web-analytics",
      measurementScope: "allowlisted-referrer-host-page-views",
      requestHost: "www.alethical.com",
      periodStartedOn: start.slice(0, 10),
      periodEndedOn: new Date(today - DAY_MS).toISOString().slice(0, 10),
      fetchedAt: fetchedAt.toISOString(),
      likelyBotsExcluded: true,
      sampling: "adaptive-estimates",
      coverage: "partial-browser-beacon",
      siteWideCoverage: "not-measured",
      unassignedReferrals: null,
      limitations:
        "Only observed referrals from these hosts are included. Missing or blocked beacons and missing referrers are unmeasured. An absent group does not establish zero AI visits. Counts are estimates of page views, not people, sessions or crawler requests.",
      providers,
    });
  } catch {
    send(response, 503, { error: "Referral data is temporarily unavailable." });
  }
}
