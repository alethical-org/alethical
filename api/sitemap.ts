import { publicPageUrl } from "../apps/frontend/src/lib/share";
import { publishedReports } from "../apps/frontend/src/lib/moneyReports";
import {
  BILL_DIRECTORY_PAGE_SIZE,
  directoryPagePath,
  directoryTotalPages,
  LEGISLATOR_DIRECTORY_PAGE_SIZE,
} from "../apps/frontend/src/lib/directoryPagination";

type QueryValue = string | string[] | undefined;
type RequestLike = { query?: Record<string, QueryValue> };
type ResponseLike = {
  status: (code: number) => ResponseLike;
  setHeader: (name: string, value: string) => void;
  send: (body: string) => void;
};

type SitemapPayload = {
  bill_directory_total: number;
  legislator_directory_total: number;
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
  "/money",
  "/money/reports",
  "/about",
  "/about/contact",
  "/privacy",
  "/site-metrics",
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

function pagesUrlset(data?: SitemapPayload): string {
  const paths = [...FIXED_PAGES];
  // Published research reports list themselves (grounded-answers.md rule 13);
  // an unpublished report has no page and so no sitemap row.
  for (const report of publishedReports()) {
    paths.push(`/money/reports/${encodeURIComponent(report.slug)}`);
  }
  if (data) {
    for (
      let page = 2;
      page <=
      directoryTotalPages(data.bill_directory_total, BILL_DIRECTORY_PAGE_SIZE);
      page += 1
    ) {
      paths.push(directoryPagePath("/bills", page));
    }
    for (
      let page = 2;
      page <=
      directoryTotalPages(
        data.legislator_directory_total,
        LEGISLATOR_DIRECTORY_PAGE_SIZE,
      );
      page += 1
    ) {
      paths.push(directoryPagePath("/legislators", page));
    }
  }
  return urlset(paths.map((path) => urlEntry(publicPageUrl(path))));
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
    let data: SitemapPayload | undefined;
    try {
      data = await fetchSitemapData();
    } catch {
      // Fixed pages still help during a data outage. Numbered directory pages
      // return on the next hourly refresh once current counts are readable.
    }
    sendXml(response, pagesUrlset(data));
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
