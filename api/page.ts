import {
  askPageMetadata,
  billListPageMetadata,
  billPageMetadata,
  injectPageHead,
  legislatorListPageMetadata,
  legislatorPageMetadata,
  STATIC_PAGE_METADATA,
  type PageMetadata,
} from "../apps/frontend/src/lib/share";

/**
 * Puts each address's own title, description, canonical URL, preview tags and
 * machine-readable block into the FIRST server response (issue #1325).
 *
 * Before this, every one of ~10,700 addresses returned the same nameless page,
 * so search engines saw one page repeated and folded them together. The fix is
 * deliberately not a robot-only page: this takes the same built `index.html` the
 * site already serves, rewrites the marked block in its head, and returns it with
 * the app body untouched — so a crawler and a person receive identical HTML and
 * the app still loads and behaves exactly as it did.
 *
 * Decisions, with the alternatives that lost:
 * docs/architecture/page-metadata-for-search-and-sharing-decisions.md §8.
 */

type QueryValue = string | string[] | undefined;
type RequestLike = {
  query?: Record<string, QueryValue>;
  headers?: Record<string, string | string[] | undefined>;
};
type ResponseLike = {
  status: (code: number) => ResponseLike;
  setHeader: (name: string, value: string) => void;
  send: (body: string) => void;
};

const API_ORIGIN = (
  process.env.EXPO_PUBLIC_API_URL || "https://api.alethical.com"
).replace(/\/$/, "");

// Long enough for a cold backend, short enough that a hung API can never hold the
// function open to its own timeout. A slow read becomes a 503, not a stall.
const API_TIMEOUT_MS = 5000;

const OK_CACHE = "public, max-age=0, s-maxage=600, stale-while-revalidate=86400";
// A record that does not exist today may exist after the next ingestion run, so a
// 404 is cached briefly rather than for the whole day.
const NOT_FOUND_CACHE = "public, max-age=0, s-maxage=300";

/** The record is genuinely absent — safe to tell a search engine the page is gone. */
class RecordNotFound extends Error {}
/** We could not tell. Never a 404: a hiccup must not unlist a real page. */
class DataUnavailable extends Error {}

function one(value: QueryValue): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function titleCase(value: string): string {
  const normalized = value.trim().toLowerCase();
  return normalized
    ? normalized.charAt(0).toUpperCase() + normalized.slice(1)
    : "";
}

function officialName(name: string, chamber: string): string {
  const bare = name
    .replace(/^(sen\.|senator|rep\.|representative)\s+/i, "")
    .trim();
  if (chamber === "Senate") return `Sen. ${bare}`;
  if (chamber === "House") return `Rep. ${bare}`;
  return bare;
}

async function getApiData<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_ORIGIN}/api/v1${path}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
  } catch {
    throw new DataUnavailable(`could not reach ${path}`);
  }
  if (response.status === 404) throw new RecordNotFound(path);
  if (!response.ok) throw new DataUnavailable(`API returned ${response.status}`);
  try {
    const payload = (await response.json()) as { data: T };
    return payload.data;
  } catch {
    throw new DataUnavailable(`unreadable response for ${path}`);
  }
}

type BillPayload = {
  id?: string;
  ai_analysis?: { short_title?: string | null; summary?: string | null } | null;
};

type LegislatorPayload = {
  slug?: string;
  full_name?: string;
  current_service?: {
    chamber?: string;
    district?: { code?: string } | null;
  } | null;
};

async function billMetadata(id: string): Promise<PageMetadata> {
  const bill = await getApiData<BillPayload>(
    `/bills/${encodeURIComponent(id)}?include=ai_analysis`,
  );
  const billId = bill.id || id;
  return billPageMetadata({
    billId,
    // Only the plain-language short title. A bill with none is titled by its
    // number and year — never by its statutory title, which is a paragraph of
    // legal cross-references (.claude/rules/grounded-answers.md rule 10).
    shortTitle: bill.ai_analysis?.short_title,
    summary: bill.ai_analysis?.summary,
  });
}

async function legislatorMetadata(id: string): Promise<PageMetadata> {
  const legislator = await getApiData<LegislatorPayload>(
    `/legislators/${encodeURIComponent(id)}?include=current_service`,
  );
  const chamber = titleCase(legislator.current_service?.chamber || "");
  const district = legislator.current_service?.district?.code;
  // A UUID address canonicalises to the readable slug the profile links use.
  const slug = legislator.slug || id;
  return legislatorPageMetadata({
    slug,
    displayName: officialName(
      legislator.full_name || "Minnesota legislator",
      chamber,
    ),
    districtLine: district
      ? `${chamber} District ${district}`.trim()
      : chamber || "",
  });
}

async function metadataFor(
  query: Record<string, QueryValue>,
): Promise<PageMetadata> {
  const route = one(query.route);
  switch (route) {
    case "bill":
      return billMetadata(one(query.id));
    case "legislator":
      return legislatorMetadata(one(query.id));
    case "bills":
      return billListPageMetadata();
    case "legislators":
      return legislatorListPageMetadata();
    case "ask":
      return askPageMetadata(one(query.q));
    default: {
      const staticPage = STATIC_PAGE_METADATA[one(query.path)];
      if (!staticPage) throw new RecordNotFound(`unknown route ${route}`);
      return staticPage;
    }
  }
}

/**
 * The built `index.html`, fetched from this same deployment over its public
 * address. The static output is not on the function's filesystem, and the shell
 * changes only at deploy time, so it is fetched once per warm instance and held.
 */
let cachedShell: string | null = null;

async function pageShell(host: string): Promise<string> {
  if (cachedShell) return cachedShell;
  let response: Response;
  try {
    response = await fetch(`https://${host}/index.html`, {
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
  } catch {
    throw new DataUnavailable("could not read the page shell");
  }
  if (!response.ok) throw new DataUnavailable("could not read the page shell");
  const html = await response.text();
  // Proves we fetched the real shell and not a rewritten copy of ourselves.
  if (!html.includes("alethical:page-head")) {
    throw new DataUnavailable("page shell is missing its head markers");
  }
  cachedShell = html;
  return html;
}

function notFoundMetadata(route: string): PageMetadata {
  const subject = route === "legislator" ? "Legislator" : "Page";
  return {
    title: `${subject} not found | Alethical`,
    socialTitle: `${subject} not found`,
    description:
      "This address does not match a record in the Minnesota Legislature.",
    // No canonical: a missing page is not a copy of a real one.
    canonicalPath: "",
    noindex: true,
    breadcrumb: [],
  };
}

export default async function handler(
  request: RequestLike,
  response: ResponseLike,
) {
  const query = request.query ?? {};
  const hostHeader = request.headers?.host;
  const host = (Array.isArray(hostHeader) ? hostHeader[0] : hostHeader) || "";

  let metadata: PageMetadata;
  let status = 200;
  try {
    metadata = await metadataFor(query);
  } catch (error) {
    if (error instanceof RecordNotFound) {
      metadata = notFoundMetadata(one(query.route));
      status = 404;
    } else {
      // A brief outage must never tell a search engine our pages are gone.
      response.setHeader("Content-Type", "text/plain; charset=utf-8");
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("Retry-After", "120");
      response.status(503).send("This page is temporarily unavailable.");
      return;
    }
  }

  let html: string;
  try {
    html = injectPageHead(await pageShell(host), metadata);
  } catch {
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Retry-After", "120");
    response.status(503).send("This page is temporarily unavailable.");
    return;
  }

  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.setHeader(
    "Cache-Control",
    status === 404 ? NOT_FOUND_CACHE : OK_CACHE,
  );
  if (metadata.noindex) response.setHeader("X-Robots-Tag", "noindex");
  response.status(status).send(html);
}
