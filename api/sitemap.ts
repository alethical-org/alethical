import { publicPageUrl } from "../apps/frontend/src/lib/share";
import { indexedResearch, piecePath } from "../apps/frontend/src/lib/research";
import { committeeSlug } from "../apps/frontend/src/lib/committeeMoney";
import { COMMITTEE_PAGE_SIZE } from "../apps/frontend/src/lib/committeeList";
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
  /** The whole register, so every numbered page of the list is named — not the
   *  shorter indexable set below. Null when the register cannot be counted. */
  committee_directory_total?: number | null;
  bills: Array<{ id: string; lastmod?: string }>;
  legislators: Array<{ slug: string; lastmod?: string }>;
  /** Only the filers whose own page holds a filed record — see the API's own
   *  docstring, and §20.5 rule 4 on a page being worth listing. */
  committees?: Array<{ registration_number: string; name: string }>;
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
  "/money/committees",
  "/money/races",
  "/read",
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
  const children = ["pages", "bills", "legislators", "committees"].map(
    (name) =>
      `  <sitemap><loc>${escapeXml(publicPageUrl(`/sitemaps/${name}.xml`))}</loc></sitemap>`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${children.join("\n")}\n</sitemapindex>`;
}

function pagesUrlset(data?: SitemapPayload): string {
  const paths = [...FIXED_PAGES];
  // A posted piece is in the sitemap from the day it posts (Eugene, 25 Aug 2026).
  // `indexed` is true on everything we publish; it stays as a way to hold one back
  // for a stated reason, not as a checking step every piece waits behind.
  for (const piece of indexedResearch()) {
    // Each piece's own address, from the one function that decides the folder, so
    // the site map can never advertise an address the router rejects.
    paths.push(piecePath(piece));
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
    // The register's own numbered pages. Page 1 is already in FIXED_PAGES, and
    // this counts the WHOLE register rather than the shorter indexable list
    // below: every page of the list exists and is walkable, including one whose
    // 50 rows happen to hold no filed record.
    const committeeTotal = data.committee_directory_total ?? 0;
    for (
      let page = 2;
      page <= directoryTotalPages(committeeTotal, COMMITTEE_PAGE_SIZE);
      page += 1
    ) {
      if (committeeTotal <= 0) break;
      paths.push(directoryPagePath("/money/committees", page));
    }
  }
  return urlset(paths.map((path) => urlEntry(publicPageUrl(path))));
}

/**
 * One entry per committee whose own page holds a filed record.
 *
 * No `lastmod`: we hold no date on which a committee's own record changed, and
 * Google trusts the field site-wide only when it is consistently accurate, so an
 * absent date is better than the register's one fetch date copied onto 1,603
 * entries (§20.4).
 *
 * The address is built by the same `committeeSlug` the app and the route reader
 * use, so the sitemap can never advertise an address the router rejects.
 */
function committeesUrlset(
  committees: NonNullable<SitemapPayload["committees"]>,
): string {
  return urlset(
    committees.map((committee) =>
      urlEntry(
        publicPageUrl(
          `/money/committees/${encodeURIComponent(
            committeeSlug(committee.name, committee.registration_number),
          )}`,
        ),
      ),
    ),
  );
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

  if (
    section === "bills" ||
    section === "legislators" ||
    section === "committees"
  ) {
    let data: SitemapPayload;
    try {
      data = await fetchSitemapData();
    } catch {
      sendUnavailable(response);
      return;
    }
    if (section === "committees") {
      sendXml(response, committeesUrlset(data.committees ?? []));
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
