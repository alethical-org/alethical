import { legislatorDisplayName, legislatorDistrictLine } from "../apps/frontend/src/lib/legislatorProfile";
import {
  billPageSnapshot,
  injectPageSnapshot,
  legislatorPageSnapshot,
  renderPageSnapshot,
  type BillSnapshotSource,
  type LegislatorSnapshotSource,
} from "../apps/frontend/src/lib/pageSnapshot";
import {
  askPageMetadata,
  billListPageMetadata,
  billPageMetadata,
  homePageMetadata,
  injectPageHead,
  legislatorListPageMetadata,
  legislatorPageMetadata,
  NOT_FOUND_DESCRIPTION,
  NOT_FOUND_HEADING,
  notFoundPageMetadata,
  STATIC_PAGE_METADATA,
  type PageMetadata,
} from "../apps/frontend/src/lib/share";
import { targetFromPathname } from "../apps/frontend/src/navigation/webRoutes";

/**
 * Puts each address's own title, description, canonical URL, preview tags and
 * machine-readable block into the FIRST server response — and, for a bill or a
 * legislator, a short factual snapshot in its body too (issue #1325).
 *
 * Before this, every one of ~10,700 addresses returned the same nameless page,
 * so search engines saw one page repeated and folded them together. The fix is
 * deliberately not a robot-only page: this takes the same built `index.html` the
 * site already serves, rewrites the marked block in its head, and returns it with
 * the app body untouched — so a crawler and a person receive identical HTML and
 * the app still loads and behaves exactly as it did.
 *
 * Release 2 adds the body text, because correct tags alone are not the win: a
 * search engine often ignores a supplied description and writes its result text
 * from what is visible on the page. Every word of that snapshot is a word the app
 * itself then draws — see apps/frontend/src/lib/pageSnapshot.ts.
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
/** The address itself has no page, so the generic useful screen is the right body. */
class UnknownAddress extends RecordNotFound {}
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

type BillPayload = BillSnapshotSource & { id?: string };

type LegislatorPayload = LegislatorSnapshotSource & { slug?: string };

/**
 * What one address contributes to the response: its head tags, and — for a bill
 * or a legislator — the factual snapshot that goes in the body (issue #1325
 * release 2). List, answer and static pages send no snapshot: they are lists of
 * records the app fetches, not a record of their own.
 */
type PageContent = { metadata: PageMetadata; snapshot: string };

function headOnly(metadata: PageMetadata): PageContent {
  return { metadata, snapshot: "" };
}

async function billContent(id: string): Promise<PageContent> {
  const bill = await getApiData<BillPayload>(
    `/bills/${encodeURIComponent(id)}?include=ai_analysis`,
  );
  const billId = bill.id || id;
  return {
    metadata: billPageMetadata({
      billId,
      // Only the plain-language short title. A bill with none is titled by its
      // number and year — never by its statutory title, which is a paragraph of
      // legal cross-references (.claude/rules/grounded-answers.md rule 10).
      shortTitle: bill.ai_analysis?.short_title,
      summary: bill.ai_analysis?.summary,
    }),
    snapshot: renderPageSnapshot(billPageSnapshot({ ...bill, id: billId })),
  };
}

async function legislatorContent(id: string): Promise<PageContent> {
  const legislator = await getApiData<LegislatorPayload>(
    `/legislators/${encodeURIComponent(id)}?include=current_service,committees`,
  );
  const chamber = titleCase(legislator.current_service?.chamber || "");
  // A UUID address canonicalises to the readable slug the profile links use.
  const slug = legislator.slug || id;
  return {
    metadata: legislatorPageMetadata({
      slug,
      displayName: legislatorDisplayName(
        legislator.full_name || "Minnesota legislator",
        chamber,
      ),
      districtLine: legislatorDistrictLine(
        chamber,
        legislator.current_service?.district?.code,
      ),
    }),
    snapshot: renderPageSnapshot(legislatorPageSnapshot(legislator)),
  };
}

async function contentFor(
  query: Record<string, QueryValue>,
): Promise<PageContent> {
  const path = one(query.path) || "/";
  const target = targetFromPathname(
    one(query.q) ? `${path}?q=${encodeURIComponent(one(query.q))}` : path,
  );

  switch (target.kind) {
    case "bill":
      return billContent(target.billId);
    case "legislator":
      return legislatorContent(target.legislatorId);
    case "bills":
      return headOnly(billListPageMetadata());
    case "legislators":
      return headOnly(legislatorListPageMetadata());
    case "ask":
      return headOnly(askPageMetadata(target.params.q));
    case "tab":
      return target.screen === "Tracked"
        ? headOnly(STATIC_PAGE_METADATA["/tracked"])
        : headOnly(homePageMetadata());
    case "findMyLegislator":
      return headOnly(STATIC_PAGE_METADATA["/find-my-legislator"]);
    case "privacy":
      return headOnly(STATIC_PAGE_METADATA["/privacy"]);
    case "terms":
      return headOnly(STATIC_PAGE_METADATA["/terms"]);
    case "aboutUs":
      return headOnly(STATIC_PAGE_METADATA["/about"]);
    case "contactUs":
      return headOnly(STATIC_PAGE_METADATA["/about/contact"]);
    case "chatSession":
      return headOnly(homePageMetadata());
    case "notFound":
      throw new UnknownAddress(`unknown address ${path}`);
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

const NOT_FOUND_SNAPSHOT = renderPageSnapshot({
  heading: NOT_FOUND_HEADING,
  subheading: "",
  bodyHeading: "What happened",
  body: [NOT_FOUND_DESCRIPTION],
  facts: [],
  bodyIsList: false,
  links: [
    { label: "Home", href: "/" },
    { label: "Browse bills", href: "/bills" },
    { label: "Find legislators", href: "/legislators" },
  ],
});

export default async function handler(
  request: RequestLike,
  response: ResponseLike,
) {
  const query = request.query ?? {};
  const hostHeader = request.headers?.host;
  const host = (Array.isArray(hostHeader) ? hostHeader[0] : hostHeader) || "";

  let content: PageContent;
  let status = 200;
  try {
    content = await contentFor(query);
  } catch (error) {
    if (error instanceof RecordNotFound) {
      content = {
        metadata: notFoundPageMetadata(),
        snapshot: error instanceof UnknownAddress ? NOT_FOUND_SNAPSHOT : "",
      };
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
    html = injectPageHead(await pageShell(host), content.metadata);
  } catch {
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Retry-After", "120");
    response.status(503).send("This page is temporarily unavailable.");
    return;
  }

  // The body text is an improvement to a page that already works, so losing its
  // slot in the shell must not take the page down with it. A missing head marker
  // is the opposite — the page would be nameless — and is still a 503 above. If
  // the slot ever does go missing, `pageSnapshot.test.tsx` fails on the shipped
  // `public/index.html` before a release reaches anyone.
  if (content.snapshot) {
    try {
      html = injectPageSnapshot(html, content.snapshot);
    } catch {
      // Serve the page as release 1 did: correct tags, empty body.
    }
  }

  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.setHeader(
    "Cache-Control",
    status === 404 ? NOT_FOUND_CACHE : OK_CACHE,
  );
  if (content.metadata.noindex) response.setHeader("X-Robots-Tag", "noindex");
  response.status(status).send(html);
}
