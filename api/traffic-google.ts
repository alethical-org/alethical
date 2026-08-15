import { getVercelOidcToken } from "@vercel/oidc";
import { ExternalAccountClient } from "google-auth-library";

type RequestLike = { method?: string };
type ResponseLike = {
  status: (code: number) => ResponseLike;
  setHeader: (name: string, value: string) => void;
  send: (body: string) => void;
};

type SearchRow = { keys?: unknown; clicks?: unknown; impressions?: unknown };
type SearchPayload = {
  rows?: unknown;
  metadata?: { first_incomplete_date?: unknown };
};

const READ_ONLY_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const OK_CACHE =
  "public, max-age=0, s-maxage=21600, stale-while-revalidate=86400";
const DAY_MS = 86_400_000;

class SearchUnavailable extends Error {}

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

function isoDateParts(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).formatToParts(now);
  const value = (type: string) =>
    parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function moveDate(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

function validDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00.000Z`))
  );
}

function nonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
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

  const projectNumber =
    process.env.GOOGLE_SEARCH_CONSOLE_GCP_PROJECT_NUMBER?.trim();
  const serviceAccount =
    process.env.GOOGLE_SEARCH_CONSOLE_SERVICE_ACCOUNT_EMAIL?.trim();
  const poolId =
    process.env.GOOGLE_SEARCH_CONSOLE_WORKLOAD_IDENTITY_POOL_ID?.trim();
  const providerId =
    process.env.GOOGLE_SEARCH_CONSOLE_WORKLOAD_IDENTITY_PROVIDER_ID?.trim();
  const siteUrl = process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL?.trim();

  if (!projectNumber || !serviceAccount || !poolId || !providerId || !siteUrl) {
    sendJson(
      response,
      503,
      { error: "Google search data is temporarily unavailable." },
      "no-store",
    );
    return;
  }

  try {
    const client = ExternalAccountClient.fromJSON({
      type: "external_account",
      audience: `//iam.googleapis.com/projects/${projectNumber}/locations/global/workloadIdentityPools/${poolId}/providers/${providerId}`,
      subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
      token_url: "https://sts.googleapis.com/v1/token",
      service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${serviceAccount}:generateAccessToken`,
      subject_token_supplier: { getSubjectToken: getVercelOidcToken },
    });
    if (!client) throw new SearchUnavailable("Google identity was unavailable");
    client.scopes = [READ_ONLY_SCOPE];
    const access = await client.getAccessToken();
    if (!access.token)
      throw new SearchUnavailable("Google token was unavailable");

    const pacificToday = isoDateParts(new Date(), "America/Los_Angeles");
    const requestedEnd = moveDate(pacificToday, -1);
    const requestedStart = moveDate(requestedEnd, -69);
    const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
    let result: Response;
    try {
      result = await fetch(url, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${access.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          startDate: requestedStart,
          endDate: requestedEnd,
          dimensions: ["date"],
          type: "web",
          aggregationType: "byProperty",
          dataState: "all",
          rowLimit: 100,
        }),
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      throw new SearchUnavailable("Google could not be reached");
    }
    if (!result.ok)
      throw new SearchUnavailable(`Google returned ${result.status}`);
    const payload = (await result.json()) as SearchPayload;
    if (payload.rows !== undefined && !Array.isArray(payload.rows)) {
      throw new SearchUnavailable("Google returned incomplete data");
    }

    const firstIncomplete = payload.metadata?.first_incomplete_date;
    const safeDelayEnd = moveDate(pacificToday, -3);
    const periodEndedOn = validDate(firstIncomplete)
      ? [safeDelayEnd, moveDate(firstIncomplete, -1)].sort()[0]
      : safeDelayEnd;
    const periodStartedOn = moveDate(periodEndedOn, -27);
    const previousPeriodEndedOn = moveDate(periodStartedOn, -1);
    const previousPeriodStartedOn = moveDate(previousPeriodEndedOn, -27);
    const totals = new Map<string, { clicks: number; impressions: number }>();

    for (const rawRow of (payload.rows ?? []) as SearchRow[]) {
      const date = Array.isArray(rawRow.keys) ? rawRow.keys[0] : null;
      if (
        !validDate(date) ||
        !nonNegativeNumber(rawRow.clicks) ||
        !nonNegativeNumber(rawRow.impressions)
      ) {
        throw new SearchUnavailable("Google returned invalid data");
      }
      totals.set(date, {
        clicks: rawRow.clicks,
        impressions: rawRow.impressions,
      });
    }

    const sum = (
      start: string,
      end: string,
      field: "clicks" | "impressions",
    ) => {
      let total = 0;
      for (let date = start; date <= end; date = moveDate(date, 1)) {
        total += totals.get(date)?.[field] ?? 0;
      }
      return total;
    };

    sendJson(
      response,
      200,
      {
        clicks28d: sum(periodStartedOn, periodEndedOn, "clicks"),
        impressions28d: sum(periodStartedOn, periodEndedOn, "impressions"),
        previousClicks28d: sum(
          previousPeriodStartedOn,
          previousPeriodEndedOn,
          "clicks",
        ),
        previousImpressions28d: sum(
          previousPeriodStartedOn,
          previousPeriodEndedOn,
          "impressions",
        ),
        periodStartedOn,
        periodEndedOn,
        previousPeriodStartedOn,
        previousPeriodEndedOn,
        fetchedAt: new Date().toISOString(),
      },
      OK_CACHE,
    );
  } catch {
    sendJson(
      response,
      503,
      { error: "Google search data is temporarily unavailable." },
      "no-store",
    );
  }
}
