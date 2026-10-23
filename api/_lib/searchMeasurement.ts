/** Private provider exports. Never log these rows or attach them to CI artifacts. */
export type SearchView = "queries" | "pages" | "query-pages";
export type SearchExportRequest = { view: SearchView; days: number };
export const SEARCH_ROW_LIMIT = 1000;
export const SEARCH_MAX_PAGES = 4;
const DAY_MS = 86_400_000;
const MAX_PROVIDER_BYTES = 2_000_000;

async function privateJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Provider response unavailable");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_PROVIDER_BYTES) {
        await reader.cancel();
        throw new Error("Provider response exceeded private export limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function boundedExport<T extends object>(value: T): T {
  if (Buffer.byteLength(JSON.stringify(value)) > MAX_PROVIDER_BYTES) {
    throw new Error("Private export exceeded storage limit");
  }
  return value;
}

export function searchExportRequest(url?: string): SearchExportRequest | null {
  const params = new URL(url || "/", "https://alethical.invalid").searchParams;
  const view = params.get("view");
  if (view === null) return null;
  if (!["queries", "pages", "query-pages"].includes(view)) {
    throw new Error("Invalid search export view");
  }
  const rawDays = params.get("days") || "7";
  if (!/^\d+$/.test(rawDays) || Number(rawDays) < 1 || Number(rawDays) > 90) {
    throw new Error("Invalid search export window");
  }
  return { view: view as SearchView, days: Number(rawDays) };
}

function moveDate(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

function validDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  );
}

function nonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 8192;
}

function pacificDate(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "America/Los_Angeles",
  }).formatToParts(now);
  return ["year", "month", "day"]
    .map((kind) => parts.find((part) => part.type === kind)?.value)
    .join("-");
}

type GoogleRow = {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

function googleRows(payload: unknown, keyCount: number): GoogleRow[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    throw new Error("Invalid provider data");
  const rows = (payload as { rows?: unknown }).rows;
  if (rows === undefined) return [];
  if (!Array.isArray(rows) || rows.length > SEARCH_ROW_LIMIT)
    throw new Error("Invalid provider rows");
  return rows.map((row) => {
    if (
      !row ||
      !Array.isArray(row.keys) ||
      row.keys.length !== keyCount ||
      !row.keys.every(text) ||
      !nonNegative(row.clicks) ||
      !nonNegative(row.impressions) ||
      !nonNegative(row.ctr) ||
      row.ctr > 1 ||
      !nonNegative(row.position)
    ) {
      throw new Error("Invalid provider row");
    }
    return {
      keys: row.keys,
      clicks: row.clicks,
      impressions: row.impressions,
      ctr: row.ctr,
      position: row.position,
    };
  });
}

export async function googleSearchExport(
  siteUrl: string,
  accessToken: string,
  request: SearchExportRequest,
  now = new Date(),
) {
  const endpoint = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  const deadline = AbortSignal.timeout(25_000);
  const query = async (body: object) => {
    const response = await fetch(endpoint, {
      method: "POST",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.any([deadline, AbortSignal.timeout(5000)]),
    });
    if (!response.ok) throw new Error("Search export unavailable");
    return (await privateJson(response)) as Record<string, unknown>;
  };
  const today = pacificDate(now);
  const requestedEnd = moveDate(today, -1);
  // Includes enough dates to retain the requested window when the latest days are incomplete.
  const requestedStart = moveDate(requestedEnd, -(request.days + 14));
  const datesPayload = await query({
    startDate: requestedStart,
    endDate: requestedEnd,
    dimensions: ["date"],
    type: "web",
    aggregationType: "byProperty",
    dataState: "all",
    rowLimit: 1000,
  });
  const dates = googleRows(datesPayload, 1);
  const metadata = datesPayload.metadata as
    { first_incomplete_date?: unknown } | undefined;
  const incomplete = metadata?.first_incomplete_date;
  if (
    incomplete !== undefined &&
    (!validDate(incomplete) ||
      incomplete < requestedStart ||
      incomplete > requestedEnd)
  ) {
    throw new Error("Invalid final-data cutoff");
  }
  const endDate = validDate(incomplete)
    ? moveDate(incomplete, -1)
    : moveDate(today, -3);
  const startDate = moveDate(endDate, 1 - request.days);
  if (startDate < requestedStart)
    throw new Error("Final data outside measured date window");
  const availableDates = new Set<string>();
  for (const row of dates) {
    const date = row.keys[0];
    if (
      !validDate(date) ||
      date < requestedStart ||
      date > requestedEnd ||
      availableDates.has(date)
    ) {
      throw new Error("Invalid provider date coverage");
    }
    availableDates.add(date);
  }
  const datesWithoutRows: string[] = [];
  for (let date = startDate; date <= endDate; date = moveDate(date, 1)) {
    if (!availableDates.has(date)) datesWithoutRows.push(date);
  }
  const dimensions =
    request.view === "query-pages"
      ? ["query", "page"]
      : [request.view === "queries" ? "query" : "page"];
  const rows: GoogleRow[] = [];
  const seen = new Set<string>();
  let rowLimitReached = false;
  let requests = 1;
  for (let page = 0; page < SEARCH_MAX_PAGES; page++) {
    const payload = await query({
      startDate,
      endDate,
      dimensions,
      type: "web",
      aggregationType: "auto",
      dataState: "final",
      rowLimit: SEARCH_ROW_LIMIT,
      startRow: page * SEARCH_ROW_LIMIT,
    });
    requests++;
    const batch = googleRows(payload, dimensions.length);
    for (const row of batch) {
      const key = JSON.stringify(row.keys);
      // A repeated page or shifting provider order cannot silently double a report.
      if (seen.has(key)) throw new Error("Duplicate provider export row");
      seen.add(key);
      rows.push(row);
    }
    if (batch.length < SEARCH_ROW_LIMIT) break;
    rowLimitReached = page === SEARCH_MAX_PAGES - 1;
  }
  return boundedExport({
    version: 1,
    provider: "google",
    property: siteUrl,
    view: request.view,
    fetchedAt: now.toISOString(),
    startDate,
    endDate,
    timeZone: "America/Los_Angeles",
    dataState: "final",
    finalDataCutoff: endDate,
    cutoffBasis: validDate(incomplete)
      ? "provider-first-incomplete-date"
      : "conservative-three-day-delay",
    dimensions,
    filters: { type: "web" },
    rows,
    coverage: {
      exhaustive: false,
      rowLimitReached,
      rowLimit: SEARCH_ROW_LIMIT * SEARCH_MAX_PAGES,
      requests,
      datesWithoutRows,
      missingDateMeaning: "No provider row; not proof of no searches.",
      limitation:
        "Search Console returns top rows and withholds some queries; detail totals can differ from property totals.",
    },
  });
}

function bingDate(value: unknown): { date: string; raw: string } {
  if (typeof value !== "string") throw new Error("Invalid Bing date");
  const dotNet = value.match(/^\/Date\((\d+)(?:[+-]\d{4})?\)\/$/);
  const timestamp = dotNet ? Number(dotNet[1]) : Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error("Invalid Bing date");
  return { date: new Date(timestamp).toISOString().slice(0, 10), raw: value };
}

export async function bingSearchExport(
  siteUrl: string,
  apiKey: string,
  request: SearchExportRequest,
  now = new Date(),
) {
  if (request.view === "query-pages")
    throw new Error(
      "Bing query-page export requires a separate bounded drill-down",
    );
  const method = request.view === "queries" ? "GetQueryStats" : "GetPageStats";
  const url = new URL(`https://ssl.bing.com/webmaster/api.svc/json/${method}`);
  url.searchParams.set("siteUrl", siteUrl);
  url.searchParams.set("apikey", apiKey);
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error("Search export unavailable");
  const payload = (await privateJson(response)) as { d?: unknown };
  if (!payload || !Array.isArray(payload.d))
    throw new Error("Invalid Bing export");
  const cap = SEARCH_ROW_LIMIT * SEARCH_MAX_PAGES;
  const seen = new Set<string>();
  const rows = payload.d.slice(0, cap).map((row) => {
    if (
      !row ||
      !text(row.Query) ||
      !Number.isSafeInteger(row.Clicks) ||
      row.Clicks < 0 ||
      !Number.isSafeInteger(row.Impressions) ||
      row.Impressions < 0 ||
      !nonNegative(row.AvgClickPosition) ||
      !nonNegative(row.AvgImpressionPosition)
    ) {
      throw new Error("Invalid Bing export row");
    }
    const { date, raw } = bingDate(row.Date);
    const identity = JSON.stringify([raw, row.Query]);
    if (seen.has(identity)) throw new Error("Duplicate Bing export row");
    seen.add(identity);
    return {
      key: row.Query as string,
      providerDate: raw,
      dateUtc: date,
      clicks: row.Clicks as number,
      impressions: row.Impressions as number,
      averageClickPosition: row.AvgClickPosition as number,
      averageImpressionPosition: row.AvgImpressionPosition as number,
    };
  });
  return boundedExport({
    version: 1,
    provider: "bing",
    property: siteUrl,
    view: request.view,
    fetchedAt: now.toISOString(),
    startDate: null,
    endDate: null,
    timeZone: null,
    finalDataCutoff: null,
    dataState: "unknown",
    dimensions: [request.view === "queries" ? "query" : "page"],
    filters: {},
    rows,
    coverage: {
      exhaustive: false,
      rowLimitReached: payload.d.length > cap,
      rowLimit: cap,
      requests: 1,
      requestedDays: request.days,
      appliedDateFilter: false,
      providerRows: payload.d.length,
      limitation:
        "Bing returns top rows, updated weekly, with no date-range or pagination parameter. Provider dates are retained; complete days and final-data cutoff are unknown.",
    },
  });
}
