type RequestLike = { method?: string };
type ResponseLike = {
  status: (code: number) => ResponseLike;
  setHeader: (name: string, value: string) => void;
  send: (body: string) => void;
};

type BingRow = { Clicks?: unknown; Date?: unknown; Impressions?: unknown };
type BingPayload = { d?: unknown };

const ENDPOINT =
  "https://ssl.bing.com/webmaster/api.svc/json/GetRankAndTrafficStats";
const DAY_MS = 86_400_000;
const OK_CACHE =
  "public, max-age=0, s-maxage=21600, stale-while-revalidate=86400";

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

function moveDate(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

function rowDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const dotNet = value.match(/^\/Date\((\d+)(?:[+-]\d+)?\)\/$/);
  const timestamp = dotNet ? Number(dotNet[1]) : Date.parse(value);
  return Number.isFinite(timestamp)
    ? new Date(timestamp).toISOString().slice(0, 10)
    : null;
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
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
  const apiKey = process.env.BING_WEBMASTER_API_KEY?.trim();
  const siteUrl = process.env.BING_WEBMASTER_SITE_URL?.trim();
  if (!apiKey || !siteUrl) {
    sendJson(
      response,
      503,
      { error: "Bing search data is temporarily unavailable." },
      "no-store",
    );
    return;
  }

  try {
    const url = new URL(ENDPOINT);
    url.searchParams.set("siteUrl", siteUrl);
    url.searchParams.set("apikey", apiKey);
    let result: Response;
    try {
      result = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      throw new SearchUnavailable("Bing could not be reached");
    }
    if (!result.ok)
      throw new SearchUnavailable(`Bing returned ${result.status}`);
    const payload = (await result.json()) as BingPayload;
    if (!Array.isArray(payload.d)) {
      throw new SearchUnavailable("Bing returned incomplete data");
    }

    const totals = new Map<string, { clicks: number; impressions: number }>();
    for (const rawRow of payload.d as BingRow[]) {
      const date = rowDate(rawRow.Date);
      if (
        !date ||
        !nonNegativeInteger(rawRow.Clicks) ||
        !nonNegativeInteger(rawRow.Impressions) ||
        totals.has(date)
      ) {
        throw new SearchUnavailable("Bing returned invalid data");
      }
      totals.set(date, {
        clicks: rawRow.Clicks,
        impressions: rawRow.Impressions,
      });
    }

    const today = new Date().toISOString().slice(0, 10);
    const periodEndedOn = moveDate(today, -3);
    const periodStartedOn = moveDate(periodEndedOn, -27);
    const previousPeriodEndedOn = moveDate(periodStartedOn, -1);
    const previousPeriodStartedOn = moveDate(previousPeriodEndedOn, -27);
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
      { error: "Bing search data is temporarily unavailable." },
      "no-store",
    );
  }
}
