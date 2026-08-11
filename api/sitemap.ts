import { publicPageUrl } from "../apps/frontend/src/lib/share";

type QueryValue = string | string[] | undefined;
type RequestLike = { query?: Record<string, QueryValue> };
type ResponseLike = {
  status: (code: number) => ResponseLike;
  setHeader: (name: string, value: string) => void;
  send: (body: string) => void;
};

type SitemapPayload = {
  bills: Array<{ id: string; lastmod?: string }>;
  legislators: Array<{ slug: string; lastmod?: string }>;
};

const API_ORIGIN = (
  process.env.EXPO_PUBLIC_API_URL || "https://api.alethical.com"
).replace(/\/$/, "");

// The bill list, legislator list, and every other public page take filter
// query params that combine into effectively unlimited addresses. Only the
// bare, unfiltered paths belong in the sitemap.
const FIXED_PAGES = [
  "/",
  "/bills",
  "/legislators",
  "/find-my-legislator",
  "/about",
  "/about/contact",
  "/privacy",
  "/terms",
];

function one(value: QueryValue): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function urlEntry(loc: string, lastmod?: string): string {
  const lastmodTag = lastmod ? `<lastmod>${escapeXml(lastmod)}</lastmod>` : "";
  return `  <url><loc>${escapeXml(loc)}</loc>${lastmodTag}</url>`;
}

function urlset(entries: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join("\n")}\n</urlset>`;
}

function sitemapIndex(): string {
  const children = ["pages", "bills", "legislators"].map(
    (name) =>
      `  <sitemap><loc>${escapeXml(publicPageUrl(`/sitemaps/${name}.xml`))}</loc></sitemap>`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${children.join("\n")}\n</sitemapindex>`;
}

function pagesUrlset(): string {
  return urlset(FIXED_PAGES.map((path) => urlEntry(publicPageUrl(path))));
}

function billsUrlset(bills: SitemapPayload["bills"]): string {
  return urlset(
    bills.map((bill) =>
      urlEntry(
        publicPageUrl(`/bills/${encodeURIComponent(bill.id)}`),
        bill.lastmod,
      ),
    ),
  );
}

function legislatorsUrlset(legislators: SitemapPayload["legislators"]): string {
  return urlset(
    legislators.map((legislator) =>
      urlEntry(
        publicPageUrl(`/legislators/${encodeURIComponent(legislator.slug)}`),
        legislator.lastmod,
      ),
    ),
  );
}

async function fetchSitemapData(): Promise<SitemapPayload> {
  const response = await fetch(`${API_ORIGIN}/api/v1/sitemap`, {
    headers: { Accept: "application/json" },
    // A hung read becomes a 503 rather than holding the function to its own limit.
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`API returned ${response.status}`);
  const payload = (await response.json()) as { data: SitemapPayload };
  return payload.data;
}

function sendXml(response: ResponseLike, body: string): void {
  response.setHeader("Content-Type", "application/xml; charset=utf-8");
  response.setHeader(
    "Cache-Control",
    "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
  );
  response.status(200).send(body);
}

function sendUnavailable(response: ResponseLike): void {
  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  response.setHeader("Retry-After", "120");
  response.setHeader("Cache-Control", "no-store");
  response
    .status(503)
    .send("Sitemap data is temporarily unavailable. Try again shortly.");
}

function sendNotFound(response: ResponseLike): void {
  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.status(404).send("Unknown sitemap section.");
}

export default async function handler(
  request: RequestLike,
  response: ResponseLike,
) {
  const section = one(request.query?.section);

  if (!section) {
    sendXml(response, sitemapIndex());
    return;
  }

  if (section === "pages") {
    sendXml(response, pagesUrlset());
    return;
  }

  if (section === "bills" || section === "legislators") {
    let data: SitemapPayload;
    try {
      data = await fetchSitemapData();
    } catch {
      sendUnavailable(response);
      return;
    }
    sendXml(
      response,
      section === "bills"
        ? billsUrlset(data.bills)
        : legislatorsUrlset(data.legislators),
    );
    return;
  }

  sendNotFound(response);
}
