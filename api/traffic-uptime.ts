type RequestLike = { method?: string };
type ResponseLike = {
  status: (code: number) => ResponseLike;
  setHeader: (name: string, value: string) => void;
  send: (body: string) => void;
};

const OK_CACHE = "public, max-age=0, s-maxage=300, stale-while-revalidate=60";
const PUBLIC_ENDPOINT = "https://api.checklyhq.com/v1/status-page";
const MAX_MONITOR_AGE_MS = 15 * 60 * 1000;
type Measurement = {
  value: number;
  measuredAt: string;
  monitoringStartedAt: string;
};

class UptimeUnavailable extends Error {}

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

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function publicJson(url: URL): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) {
    throw new UptimeUnavailable("Checkly status source is unavailable");
  }
  const result = object(await response.json());
  if (!result) {
    throw new UptimeUnavailable(
      "Checkly status source returned unreadable data",
    );
  }
  return result;
}

// The public dashboard supplies its own 30-day success ratio, measurement time,
// and monitor creation time. A new monitor has less than 30 days of history.
// Never infer uptime from its present passing status or average bucket ratios.
async function publicMeasurements(
  ids: string[],
  accountId: string,
): Promise<Map<string, Measurement>> {
  const configured = new URL(process.env.EXPO_PUBLIC_CHECKLY_STATUS_URL ?? "");
  const match = /^([a-z0-9-]+)\.checkly-dashboards\.com$/.exec(
    configured.hostname,
  );
  if (
    !match ||
    configured.protocol !== "https:" ||
    configured.username ||
    configured.password ||
    configured.port
  ) {
    throw new UptimeUnavailable("Invalid public Checkly status configuration");
  }
  const metadataUrl = new URL(`${PUBLIC_ENDPOINT}/${match[1]}/metadata`);
  metadataUrl.searchParams.set("type", "customUrl");
  const metadata = await publicJson(metadataUrl);
  if (
    !Number.isSafeInteger(metadata.id) ||
    Number(metadata.id) <= 0 ||
    metadata.isPrivate !== false ||
    metadata.accountId !== accountId
  ) {
    throw new UptimeUnavailable("Checkly status identity did not match");
  }

  const found = new Map<string, Measurement>();
  const seen = new Set<string>();
  // Bound provider pagination. Never treat an incomplete dashboard as complete.
  for (let page = 1; page <= 20; page++) {
    const url = new URL(`${PUBLIC_ENDPOINT}/${metadata.id}/statuses`);
    url.searchParams.set("page", String(page));
    url.searchParams.set("limit", "15");
    const payload = await publicJson(url);
    if (!Array.isArray(payload.results)) {
      throw new UptimeUnavailable("Checkly status monitors missing");
    }
    for (const row of payload.results) {
      const monitor = object(row);
      if (
        !monitor ||
        typeof monitor.id !== "string" ||
        !ids.includes(monitor.id)
      )
        continue;
      if (seen.has(monitor.id)) {
        found.delete(monitor.id);
        continue;
      }
      seen.add(monitor.id);
      const status = object(monitor.status);
      const metrics = object(status?.metrics);
      const value = metrics?.["30dSuccessRatio"];
      const updated =
        typeof status?.updated_at === "string"
          ? Date.parse(status.updated_at)
          : NaN;
      const created =
        typeof monitor.created_at === "string"
          ? Date.parse(monitor.created_at)
          : NaN;
      const now = Date.now();
      const age = now - updated;
      if (
        monitor.activated !== true ||
        monitor.checkType !== "URL" ||
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < 0 ||
        value > 100 ||
        !Number.isFinite(age) ||
        age < -60000 ||
        age > MAX_MONITOR_AGE_MS ||
        !Number.isFinite(created) ||
        created > updated ||
        created > now
      )
        continue;
      found.set(monitor.id, {
        value: Math.round(value * 1000) / 1000,
        measuredAt: new Date(updated).toISOString(),
        monitoringStartedAt: new Date(created).toISOString(),
      });
    }
    const total = object(payload.summary)?.total;
    if (!Number.isSafeInteger(total) || Number(total) < 0) {
      throw new UptimeUnavailable("Checkly status pagination missing");
    }
    if (page * 15 >= Number(total)) break;
    if (page === 20) {
      throw new UptimeUnavailable("Checkly status monitor list truncated");
    }
  }
  return found;
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
  const accountId = process.env.CHECKLY_ACCOUNT_ID?.trim();
  const webId = process.env.CHECKLY_WEB_CHECK_ID?.trim();
  const apiId = process.env.CHECKLY_API_READY_CHECK_ID?.trim();
  if (!accountId || !webId || !apiId || webId === apiId) {
    sendJson(
      response,
      503,
      { error: "Availability data is temporarily unavailable." },
      "no-store",
    );
    return;
  }

  try {
    const measurements = await publicMeasurements([webId, apiId], accountId);
    const website = measurements.get(webId);
    const api = measurements.get(apiId);
    if (!website && !api) {
      throw new UptimeUnavailable("No current Checkly measurements");
    }
    sendJson(
      response,
      200,
      {
        websiteAvailability30d: website?.value ?? null,
        // Retain the unused legacy field without depending on that monitor.
        trafficPageAvailability30d: null,
        apiAvailability30d: api?.value ?? null,
        measuredAt: {
          website: website?.measuredAt ?? null,
          api: api?.measuredAt ?? null,
        },
        monitoringStartedAt: {
          website: website?.monitoringStartedAt ?? null,
          api: api?.monitoringStartedAt ?? null,
        },
        measurementSource: {
          website: website ? "status-page" : null,
          api: api ? "status-page" : null,
        },
        fetchedAt: new Date().toISOString(),
      },
      OK_CACHE,
    );
  } catch {
    sendJson(
      response,
      503,
      { error: "Availability data is temporarily unavailable." },
      "no-store",
    );
  }
}
