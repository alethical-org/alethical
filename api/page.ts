import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  legislatorDisplayName,
  legislatorDistrictLine,
} from "../apps/frontend/src/lib/legislatorProfile";
import {
  billDirectoryPageSnapshot,
  billPageSnapshot,
  findMyLegislatorPageSnapshot,
  injectPageSnapshot,
  legislatorDirectoryPageSnapshot,
  legislatorPageSnapshot,
  moneyReportPageSnapshot,
  moneyReportsShelfPageSnapshot,
  renderPageSnapshot,
  type BillDirectorySnapshotSource,
  type BillSnapshotSource,
  type LegislatorDirectorySnapshotSource,
  type LegislatorSnapshotSource,
} from "../apps/frontend/src/lib/pageSnapshot";
import {
  BILL_DIRECTORY_PAGE_SIZE,
  compareLegislatorNames,
  directoryPageNumber,
  directoryTotalPages,
  isDefaultBillDirectoryParams,
  LEGISLATOR_DIRECTORY_PAGE_SIZE,
  LEGISLATOR_ROSTER_LIMIT,
} from "../apps/frontend/src/lib/directoryPagination";
import {
  askPageMetadata,
  billListPageMetadata,
  billPageMetadata,
  homePageMetadata,
  injectPageHead,
  legislatorListPageMetadata,
  legislatorPageMetadata,
  committeeListPageMetadata,
  committeeMoneyPageMetadata,
  moneyReportPageMetadata,
  moneySearchPageMetadata,
  NOT_FOUND_DESCRIPTION,
  NOT_FOUND_HEADING,
  notFoundPageMetadata,
  STATIC_PAGE_METADATA,
  type PageMetadata,
} from "../apps/frontend/src/lib/share";
import {
  publishedReports,
  reportBySlug,
} from "../apps/frontend/src/lib/moneyReports";
import { targetFromPathname } from "../apps/frontend/src/navigation/webRoutes";

/**
 * Puts each address's own title, description, canonical URL, preview tags and
 * machine-readable block into the FIRST server response. Bill and legislator
 * records carry a factual snapshot (#1325); Home and the unfiltered public
 * directories carry a crawlable path through those records (#1396).
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

const OK_CACHE =
  "public, max-age=0, s-maxage=600, stale-while-revalidate=86400";
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

async function getApiResponse<T>(path: string): Promise<T> {
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
  if (!response.ok)
    throw new DataUnavailable(`API returned ${response.status}`);
  try {
    return (await response.json()) as T;
  } catch {
    throw new DataUnavailable(`unreadable response for ${path}`);
  }
}

async function getApiData<T>(path: string): Promise<T> {
  return (await getApiResponse<{ data: T }>(path)).data;
}

/** A list endpoint's 404 means its current-data selection failed, not that the public page is gone. */
async function getDirectoryApiResponse<T>(path: string): Promise<T> {
  try {
    return await getApiResponse<T>(path);
  } catch (error) {
    if (error instanceof RecordNotFound) {
      throw new DataUnavailable(`directory data not found for ${path}`);
    }
    throw error;
  }
}

type BillPayload = BillSnapshotSource & { id?: string };

type LegislatorPayload = LegislatorSnapshotSource & { slug?: string };

type CollectionPayload<T> = {
  data: T[];
  page?: {
    limit?: number | null;
    offset?: number | null;
    has_more?: boolean | null;
    total?: number | null;
  } | null;
};

/**
 * What one address contributes to the response: its head tags and the factual
 * snapshot that goes in the body. Detail records use the release-2 snapshot;
 * Home and unfiltered public directories use the crawlable paths in issue #1396.
 * Filtered, answer, and static pages send no snapshot.
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
    `/legislators/${encodeURIComponent(id)}?include=current_service,committees,service_history`,
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

async function billListContent(page: number): Promise<PageContent> {
  const offset = (page - 1) * BILL_DIRECTORY_PAGE_SIZE;
  const params = new URLSearchParams({
    scope: "legislature",
    sort: "progress",
    view: "directory",
    limit: String(BILL_DIRECTORY_PAGE_SIZE),
    offset: String(offset),
  });
  const collection = await getDirectoryApiResponse<
    CollectionPayload<BillDirectorySnapshotSource>
  >(`/bills?${params.toString()}`);
  const total = collection.page?.total;
  if (typeof total !== "number") {
    throw new DataUnavailable("bill directory response has no total");
  }
  if (page > directoryTotalPages(total, BILL_DIRECTORY_PAGE_SIZE)) {
    throw new UnknownAddress(`bill directory page ${page} does not exist`);
  }
  const expectedRecords = Math.min(
    BILL_DIRECTORY_PAGE_SIZE,
    Math.max(0, total - offset),
  );
  if (collection.data.length !== expectedRecords) {
    throw new DataUnavailable("bill directory response is incomplete");
  }
  return {
    metadata: billListPageMetadata(page),
    snapshot: renderPageSnapshot(
      billDirectoryPageSnapshot(
        collection.data,
        total,
        page,
        BILL_DIRECTORY_PAGE_SIZE,
      ),
    ),
  };
}

async function legislatorListContent(page: number): Promise<PageContent> {
  const collection = await getDirectoryApiResponse<
    CollectionPayload<LegislatorDirectorySnapshotSource>
  >(`/legislators?limit=${LEGISLATOR_ROSTER_LIMIT}&offset=0`);
  const total = collection.page?.total;
  if (
    typeof total !== "number" ||
    collection.page?.has_more ||
    total !== collection.data.length
  ) {
    throw new DataUnavailable("legislator directory response is incomplete");
  }
  const totalPages = directoryTotalPages(total, LEGISLATOR_DIRECTORY_PAGE_SIZE);
  if (page > totalPages) {
    throw new UnknownAddress(
      `legislator directory page ${page} does not exist`,
    );
  }
  const start = (page - 1) * LEGISLATOR_DIRECTORY_PAGE_SIZE;
  const legislators = collection.data
    .slice()
    .sort(compareLegislatorNames)
    .slice(start, start + LEGISLATOR_DIRECTORY_PAGE_SIZE);
  return {
    metadata: legislatorListPageMetadata(page),
    snapshot: renderPageSnapshot(
      legislatorDirectoryPageSnapshot(
        legislators,
        total,
        page,
        LEGISLATOR_DIRECTORY_PAGE_SIZE,
      ),
    ),
  };
}

function pathWithQuery(query: Record<string, QueryValue>): string {
  const path = one(query.path) || "/";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (key === "path" || value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      params.append(key, item);
    }
  }
  const suffix = params.toString();
  return suffix ? `${path}?${suffix}` : path;
}

function isUnfilteredDirectory(params: Record<string, string>): boolean {
  return Object.keys(params).every((key) => key === "page");
}

async function contentFor(
  query: Record<string, QueryValue>,
): Promise<PageContent> {
  const path = one(query.path) || "/";
  const target = targetFromPathname(pathWithQuery(query));

  switch (target.kind) {
    case "bill":
      return billContent(target.billId);
    case "legislator":
      return legislatorContent(target.legislatorId);
    case "bills":
      return isDefaultBillDirectoryParams(target.params)
        ? billListContent(directoryPageNumber(target.params.page))
        : headOnly(billListPageMetadata(1, { noindex: true }));
    case "legislators":
      return isUnfilteredDirectory(target.params)
        ? legislatorListContent(directoryPageNumber(target.params.page))
        : headOnly(legislatorListPageMetadata(1, { noindex: true }));
    case "ask":
      return headOnly(askPageMetadata(target.params.q));
    case "tab":
      return target.screen === "Tracked"
        ? headOnly(STATIC_PAGE_METADATA["/tracked"])
        : headOnly(homePageMetadata());
    case "findMyLegislator":
      return {
        metadata: STATIC_PAGE_METADATA["/find-my-legislator"],
        snapshot: renderPageSnapshot(findMyLegislatorPageSnapshot()),
      };
    case "moneyLanding":
      return headOnly(STATIC_PAGE_METADATA["/money"]);
    case "moneyReports":
      // The shelf's own list, so the route to every posted piece exists before
      // any program runs (#1760). The registry is on the server already, so
      // this asks the data service for nothing.
      return {
        metadata: STATIC_PAGE_METADATA["/reports"],
        snapshot: renderPageSnapshot(
          moneyReportsShelfPageSnapshot(publishedReports()),
        ),
      };
    case "moneyReport": {
      // Title and dates only in a report's tags (grounded-answers.md rule 13);
      // an unpublished or unknown slug is a genuinely absent page. The report's
      // own writing goes in the body instead, where the loaded page puts it
      // (#1760) — the `indexed` flag still decides listing on its own.
      const report = reportBySlug(target.slug);
      if (!report) throw new UnknownAddress(`no report ${target.slug}`);
      return {
        metadata: moneyReportPageMetadata(report),
        snapshot: renderPageSnapshot(moneyReportPageSnapshot(report)),
      };
    }
    case "moneyCommitteeList":
      // Only the bare list is a page worth listing; a filtered or scrolled
      // address is one of effectively unlimited query-string combinations.
      return headOnly(
        Object.keys(target.params).length === 0
          ? STATIC_PAGE_METADATA["/money/committees"]
          : committeeListPageMetadata({ noindex: true }),
      );
    case "moneySearch":
      return headOnly(moneySearchPageMetadata(target.params.q));
    case "moneyCommittee":
      return headOnly(committeeMoneyPageMetadata(target.slug, "page"));
    case "moneyCommitteePayments":
      return headOnly(committeeMoneyPageMetadata(target.slug, "payments"));
    case "privacy":
      return headOnly(STATIC_PAGE_METADATA["/privacy"]);
    case "siteMetrics":
      return headOnly(STATIC_PAGE_METADATA["/site-metrics"]);
    case "terms":
      return headOnly(STATIC_PAGE_METADATA["/terms"]);
    case "aboutUs":
      return headOnly(STATIC_PAGE_METADATA["/about"]);
    case "contactUs":
      return headOnly(STATIC_PAGE_METADATA["/about/contact"]);
    case "confirmEmail":
      return headOnly(STATIC_PAGE_METADATA["/confirm"]);
    case "resetPassword":
      return headOnly(STATIC_PAGE_METADATA["/reset"]);
    case "chatSession":
      return headOnly(homePageMetadata());
    case "notFound":
      throw new UnknownAddress(`unknown address ${path}`);
  }
}

/**
 * The built `index.html`, bundled into this function by the root `vercel.json`.
 * Reading the deployed file avoids a request through the preview login gate. The
 * shell changes only at deploy time, so it is read once per warm instance and held.
 */
let cachedShell: string | null = null;
const PAGE_SHELL_PATH = resolve(process.cwd(), "apps/frontend/dist/index.html");

async function pageShell(): Promise<string> {
  if (cachedShell) return cachedShell;
  let html: string;
  try {
    html = await readFile(PAGE_SHELL_PATH, "utf8");
  } catch {
    throw new DataUnavailable("could not read the page shell");
  }
  // Proves the bundled file is the real shell rather than an unrelated build file.
  if (!html.includes("alethical:page-head")) {
    throw new DataUnavailable("page shell is missing its head markers");
  }
  cachedShell = html;
  return html;
}

const EMAIL_LINK_BOOTSTRAP = `<meta name="referrer" content="no-referrer" />
<meta name="robots" content="noindex,nofollow" />
<script id="alethical-email-link-bootstrap">(function(){var keys=['token_hash','token','type','code','code_verifier','access_token','refresh_token','provider_token','provider_refresh_token','error','error_code','error_description','error_uri','expires_in','expires_at','token_type','state','pending','redirect_to','auth_action'];var search=new URLSearchParams(window.location.search);var rawHash=window.location.hash.replace(/^#/,'');var hash=new URLSearchParams(rawHash);var question=rawHash.indexOf('?');var unusualHash=question===-1?null:new URLSearchParams(rawHash.slice(question+1));var read=function(name){return hash.get(name)};window.__alethicalEmailLink=Object.freeze({tokenHash:read('token_hash'),type:read('type'),pendingReference:read('pending')});var hashHasProtectedValue=keys.some(function(name){return hash.has(name)||(unusualHash&&unusualHash.has(name))});keys.forEach(function(name){search.delete(name);hash.delete(name)});var cleanHash=hashHasProtectedValue?(question!==-1?'':(hash.toString()?'#'+hash.toString():'')):window.location.hash;var clean=window.location.pathname+(search.toString()?'?'+search.toString():'')+cleanHash;window.history.replaceState(null,'',clean)})();</script>`;

const FORGOT_PASSWORD_BOOTSTRAP = `<meta name="robots" content="noindex,nofollow" />
<script id="alethical-forgot-password-bootstrap">(function(){try{window.sessionStorage.setItem('alethical.openSignIn','forgot')}catch(_error){}window.location.replace('/#auth_screen=forgot')})();</script>`;

/**
 * Email-link pages remove their one-use secrets before the app or an outside
 * resource can start. The link data lives only in this page's memory.
 */
function protectedEmailLinkShell(html: string): string {
  const withoutExternalResources = html
    .replace(/<link\b[^>]*\bhref=["']https:\/\/[^>]+>\s*/gi, "")
    .replace(/<script\b[^>]*\bsrc=["']https:\/\/[^>]*><\/script>\s*/gi, "");
  return withoutExternalResources.replace(
    "<head>",
    `<head>\n${EMAIL_LINK_BOOTSTRAP}`,
  );
}

function forgotPasswordBridgeShell(html: string): string {
  return html.replace("<head>", `<head>\n${FORGOT_PASSWORD_BOOTSTRAP}`);
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
  const requestedPath = one(query.path) || "/";
  const isEmailLinkPage =
    requestedPath === "/confirm" || requestedPath === "/reset";
  const isForgotPasswordBridge = requestedPath === "/forgot-password";

  let content: PageContent;
  let status = 200;
  try {
    content = isForgotPasswordBridge
      ? headOnly(STATIC_PAGE_METADATA["/reset"])
      : await contentFor(query);
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
    html = injectPageHead(await pageShell(), content.metadata);
    if (isEmailLinkPage) {
      html = protectedEmailLinkShell(html);
    } else if (isForgotPasswordBridge) {
      html = forgotPasswordBridgeShell(html);
    }
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
  try {
    // The shipped shell carries Home's snapshot because `/` is served directly
    // from the filesystem. Replacing the slot even with an empty string keeps
    // that Home text off static and filtered pages reached through this handler.
    html = injectPageSnapshot(html, content.snapshot);
  } catch {
    // Serve the page as release 1 did: correct tags, whatever body the shell has.
  }

  response.setHeader("Content-Type", "text/html; charset=utf-8");
  if (isEmailLinkPage || isForgotPasswordBridge) {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Robots-Tag", "noindex, nofollow");
    response.status(status).send(html);
    return;
  }
  response.setHeader(
    "Cache-Control",
    status === 404 ? NOT_FOUND_CACHE : OK_CACHE,
  );
  if (content.metadata.noindex) response.setHeader("X-Robots-Tag", "noindex");
  response.status(status).send(html);
}
