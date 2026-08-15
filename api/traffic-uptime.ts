type RequestLike = { method?: string };
type ResponseLike = {
  status: (code: number) => ResponseLike;
  setHeader: (name: string, value: string) => void;
  send: (body: string) => void;
};

const ENDPOINT = "https://api.checklyhq.com/v1/analytics/url-monitors";
const OK_CACHE = "public, max-age=0, s-maxage=300, stale-while-revalidate=60";

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

function availabilityValues(value: unknown, available = false): number[] {
  if (typeof value === "number") {
    return available && Number.isFinite(value) && value >= 0 && value <= 100
      ? [value]
      : [];
  }
  if (typeof value === "string") {
    if (/^\s*[\[{]/.test(value)) {
      try {
        return availabilityValues(JSON.parse(value), available);
      } catch {
        return [];
      }
    }
    return [];
  }
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => availabilityValues(item, available));
  }
  const object = value as Record<string, unknown>;
  const identifiesAvailability = Object.entries(object).some(
    ([key, entry]) =>
      /^(metric|name|label|series)$/i.test(key) &&
      typeof entry === "string" &&
      entry.toLowerCase().includes("availability"),
  );
  return Object.entries(object).flatMap(([key, entry]) =>
    availabilityValues(
      entry,
      available ||
        identifiesAvailability ||
        key.toLowerCase().includes("availability"),
    ),
  );
}

async function getAvailability(id: string, apiKey: string, accountId: string) {
  const url = new URL(`${ENDPOINT}/${encodeURIComponent(id)}`);
  url.searchParams.set("quickRange", "last30Days");
  url.searchParams.set("metrics", "availability");
  url.searchParams.set("aggregationInterval", "43200");
  let result: Response;
  try {
    result = await fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
        "X-Checkly-Account": accountId,
      },
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw new UptimeUnavailable("Checkly could not be reached");
  }
  if (!result.ok)
    throw new UptimeUnavailable(`Checkly returned ${result.status}`);
  const values = availabilityValues(await result.json());
  if (values.length !== 1) {
    throw new UptimeUnavailable("Checkly returned incomplete data");
  }
  return Math.round(values[0] * 1000) / 1000;
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
  const apiKey = process.env.CHECKLY_API_KEY?.trim();
  const accountId = process.env.CHECKLY_ACCOUNT_ID?.trim();
  const webId = process.env.CHECKLY_WEB_CHECK_ID?.trim();
  const trafficId = process.env.CHECKLY_TRAFFIC_CHECK_ID?.trim();
  const apiId = process.env.CHECKLY_API_READY_CHECK_ID?.trim();
  if (!apiKey || !accountId || !webId || !trafficId || !apiId) {
    sendJson(
      response,
      503,
      { error: "Availability data is temporarily unavailable." },
      "no-store",
    );
    return;
  }

  try {
    const [
      websiteAvailability30d,
      trafficPageAvailability30d,
      apiAvailability30d,
    ] = await Promise.all([
      getAvailability(webId, apiKey, accountId),
      getAvailability(trafficId, apiKey, accountId),
      getAvailability(apiId, apiKey, accountId),
    ]);
    sendJson(
      response,
      200,
      {
        websiteAvailability30d,
        trafficPageAvailability30d,
        apiAvailability30d,
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
