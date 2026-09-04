import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  legislatorDisplayName,
  legislatorDistrictLine,
} from "../apps/frontend/src/lib/legislatorProfile";
import {
  billDirectoryPageSnapshot,
  billPageSnapshot,
  committeeDirectoryPageSnapshot,
  committeePageSnapshot,
  committeePaymentsPageSnapshot,
  committeeSnapshotName,
  committeeSnapshotPath,
  findMyLegislatorPageSnapshot,
  injectPageSnapshot,
  legislatorDirectoryPageSnapshot,
  legislatorPageSnapshot,
  moneyByRacePageSnapshot,
  moneyLandingPageSnapshot,
  researchPageSnapshot,
  readPageSnapshot,
  renderPageSnapshot,
  type BillDirectorySnapshotSource,
  type BillSnapshotSource,
  type CommitteeDirectorySnapshotSource,
  type CommitteeMoneySnapshotSource,
  type LegislatorDirectorySnapshotSource,
  type LegislatorSnapshotSource,
} from "../apps/frontend/src/lib/pageSnapshot";
import { COMMITTEE_PAGE_SIZE } from "../apps/frontend/src/lib/committeeList";
import {
  PAGE_CAP as COMMITTEE_PAYMENTS_PAGE_SIZE,
  receivedPaymentRow,
  registrationNumberFromSlug,
} from "../apps/frontend/src/lib/committeeMoney";
import { campaignMoneyYear } from "../apps/frontend/src/lib/legislatorCampaignMoney";
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
  moneyByRacePageMetadata,
  researchPageMetadata,
  moneySearchPageMetadata,
  outsideSpendingPageMetadata,
  paymentsUnderNamePageMetadata,
  NOT_FOUND_DESCRIPTION,
  NOT_FOUND_HEADING,
  notFoundPageMetadata,
  STATIC_PAGE_METADATA,
  type PageMetadata,
} from "../apps/frontend/src/lib/share";
import {
  publishedResearch,
  researchBySlug,
} from "../apps/frontend/src/lib/research";
import {
  getCampaignFinanceRacesFromApiPayload,
  type ApiMoneyByRacePayload,
} from "../apps/frontend/src/data/api";
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

// --- The campaign money section (#1812) ---

/** The 3 money payloads this file reads, each only as far as it prints. */
type MoneySummaryPayload = {
  register?: { state?: string | null; filer_count?: number | null } | null;
  freshness?: { downloads_fetched_at?: string | null } | null;
};

type CommitteeRegisterPayload = {
  state?: string | null;
  committees?: CommitteeDirectorySnapshotSource[] | null;
  page?: { total?: number | null } | null;
  register_total?: number | null;
  as_of?: string | null;
};

type CommitteePaymentsPayload = {
  state?: string | null;
  payments?:
    | {
        contributor?: string | null;
        contributor_registration_number?: string | null;
        contributor_type?: string | null;
        amount?: string | null;
        received_on?: string | null;
        receipt_type?: string | null;
        in_kind?: string | null;
      }[]
    | null;
  page?: { total_payments?: number | null } | null;
  linkable_registration_numbers?: string[] | null;
};

//
// The landing, the register, one committee's record and its full payments list
// all sent a title and an empty body until now, so 1,603 committee records had
// no sentence and no link anything could read before a script ran. §22 of
// docs/architecture/page-metadata-for-search-and-sharing-decisions.md records
// which of these addresses are records and which are filtered views.

/** The filing year both the app and this function default to, so the served
 *  figures are the ones the loaded page then draws. */
function defaultMoneyYear(): number {
  return campaignMoneyYear(undefined);
}

async function moneyLandingContent(): Promise<PageContent> {
  // The register's size and the copy date are read live, never pasted — a pasted
  // count is how this page once said 1,336 on a day the register held 1,603
  // (.claude/rules/grounded-answers.md rule 12). A count that cannot be read is
  // left out; the landing is still a real page without it, so this never 503s.
  let summary: MoneySummaryPayload | null = null;
  try {
    summary = await getApiData<MoneySummaryPayload>(
      "/campaign-finance/summary",
    );
  } catch {
    summary = null;
  }
  return {
    metadata: STATIC_PAGE_METADATA["/money"],
    snapshot: renderPageSnapshot(
      moneyLandingPageSnapshot({
        registerFilerCount:
          summary?.register?.state === "reported"
            ? (summary.register.filer_count ?? null)
            : null,
        filesLastCopiedAt: summary?.freshness?.downloads_fetched_at ?? null,
      }),
    ),
  };
}

async function moneyByRaceContent(): Promise<PageContent> {
  // The same shaping the app applies to the same read, so the first response
  // carries the page a reader gets: counts, never sums; the served order; every
  // figure with its own dates (issue #1954).
  const payload = await getApiResponse<{ data: unknown }>(
    `/campaign-finance/races?year=${defaultMoneyYear()}`,
  );
  const page = getCampaignFinanceRacesFromApiPayload(
    payload.data as ApiMoneyByRacePayload,
    defaultMoneyYear(),
  );
  if (page.state !== "reported") {
    throw new DataUnavailable("races response has no contests to serve");
  }
  return {
    metadata: moneyByRacePageMetadata(),
    snapshot: renderPageSnapshot(moneyByRacePageSnapshot(page)),
  };
}

async function committeeListContent(page: number): Promise<PageContent> {
  const offset = (page - 1) * COMMITTEE_PAGE_SIZE;
  const params = new URLSearchParams({
    limit: String(COMMITTEE_PAGE_SIZE),
    offset: String(offset),
  });
  const payload = await getDirectoryApiResponse<{
    data: CommitteeRegisterPayload;
  }>(`/campaign-finance/committees?${params.toString()}`);
  const register = payload.data;
  const total = register.page?.total;
  if (register.state !== "reported" || typeof total !== "number") {
    throw new DataUnavailable(
      "committee register response has no rows to serve",
    );
  }
  if (page > directoryTotalPages(total, COMMITTEE_PAGE_SIZE)) {
    throw new UnknownAddress(`committee register page ${page} does not exist`);
  }
  const expectedRecords = Math.min(
    COMMITTEE_PAGE_SIZE,
    Math.max(0, total - offset),
  );
  if ((register.committees ?? []).length !== expectedRecords) {
    throw new DataUnavailable("committee register response is incomplete");
  }
  return {
    metadata: committeeListPageMetadata(page),
    snapshot: renderPageSnapshot(
      committeeDirectoryPageSnapshot(
        register.committees ?? [],
        {
          listTotal: total,
          registerTotal: register.register_total ?? null,
          asOf: register.as_of ?? null,
        },
        page,
        COMMITTEE_PAGE_SIZE,
      ),
    ),
  };
}

async function committeeFinance(slug: string): Promise<{
  money: CommitteeMoneySnapshotSource;
  registrationNumber: string;
}> {
  const registrationNumber = registrationNumberFromSlug(slug);
  // The route reader already refuses an address with no number, so this is the
  // belt-and-braces case rather than the ordinary one.
  if (!registrationNumber) throw new UnknownAddress(`no committee in ${slug}`);
  const money = await getApiData<CommitteeMoneySnapshotSource>(
    `/committees/${encodeURIComponent(registrationNumber)}/finance?year=${defaultMoneyYear()}`,
  );
  return { money, registrationNumber };
}

async function committeeContent(slug: string): Promise<PageContent> {
  const { money, registrationNumber } = await committeeFinance(slug);
  return {
    metadata: committeeMoneyPageMetadata(slug, "page", {
      name: committeeSnapshotName(money, registrationNumber),
      canonicalSlug:
        committeeSnapshotPath(money, registrationNumber).split("/").pop() ??
        slug,
    }),
    snapshot: renderPageSnapshot(
      committeePageSnapshot(money, registrationNumber),
    ),
  };
}

async function committeePaymentsContent(slug: string): Promise<PageContent> {
  const { money, registrationNumber } = await committeeFinance(slug);
  const params = new URLSearchParams({
    direction: "received",
    year: String(defaultMoneyYear()),
    sort: "amount",
    limit: String(COMMITTEE_PAYMENTS_PAGE_SIZE),
    offset: "0",
  });
  // The list is an addition to a page that already reads correctly, so losing it
  // serves the committee's identity and period with the list's own absent state
  // rather than taking the address down.
  let payments: CommitteePaymentsPayload | null = null;
  try {
    payments = await getApiData<CommitteePaymentsPayload>(
      `/committees/${encodeURIComponent(registrationNumber)}/payments?${params.toString()}`,
    );
  } catch {
    payments = null;
  }
  const linkable = new Set<string>(
    payments?.linkable_registration_numbers ?? [],
  );
  return {
    metadata: committeeMoneyPageMetadata(slug, "payments", {
      name: committeeSnapshotName(money, registrationNumber),
      canonicalSlug:
        committeeSnapshotPath(money, registrationNumber).split("/").pop() ??
        slug,
    }),
    snapshot: renderPageSnapshot(
      committeePaymentsPageSnapshot(money, registrationNumber, {
        state: payments?.state ?? null,
        rows:
          payments?.state === "reported"
            ? (payments.payments ?? []).map((row) =>
                receivedPaymentRow(
                  {
                    contributor: row.contributor ?? null,
                    contributorRegistrationNumber:
                      row.contributor_registration_number ?? null,
                    contributorType: row.contributor_type ?? null,
                    amount: row.amount ?? null,
                    receivedOn: row.received_on ?? null,
                    receiptType: row.receipt_type ?? null,
                    inKind: row.in_kind ?? null,
                  },
                  linkable,
                ),
              )
            : [],
        totalPayments: payments?.page?.total_payments ?? null,
      }),
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
      return moneyLandingContent();
    case "read":
      // The /read page's own list, so the route to every posted piece exists before
      // any program runs (#1760). The registry is on the server already, so
      // this asks the data service for nothing.
      return {
        metadata: STATIC_PAGE_METADATA["/read"],
        snapshot: renderPageSnapshot(readPageSnapshot(publishedResearch())),
      };
    case "guide":
    case "research": {
      // Title and dates only in a piece's tags (grounded-answers.md rule 13);
      // an unpublished or unknown slug, or a known piece asked for under the
      // wrong folder, is a genuinely absent page. The piece's own writing goes in
      // the body instead, where the loaded page puts it (#1760) — the `indexed`
      // flag still decides listing on its own. A guide and a research piece are
      // the same document shape, so one branch serves both.
      const piece = researchBySlug(target.slug);
      if (!piece) throw new UnknownAddress(`no piece ${target.slug}`);
      return {
        metadata: researchPageMetadata(piece),
        snapshot: renderPageSnapshot(researchPageSnapshot(piece)),
      };
    }
    case "moneyCommitteeList":
      // Only the plain register is a page worth listing, one numbered page at a
      // time; a typed name or a kind chip is one of effectively unlimited
      // query-string combinations and gets no body and no canonical address.
      return isUnfilteredDirectory(target.params)
        ? committeeListContent(directoryPageNumber(target.params.page))
        : headOnly(committeeListPageMetadata(1, { noindex: true }));
    case "moneyByRace":
      // The bare list is the page worth listing; an office chip is a filtered
      // view and gets no body and no canonical address.
      return Object.keys(target.params).length === 0
        ? moneyByRaceContent()
        : headOnly(moneyByRacePageMetadata({ noindex: true }));
    case "moneySearch":
      return headOnly(moneySearchPageMetadata(target.params.q));
    // A filtered view of one free-text spelling, not a record, so head only with
    // noindex — see §22's table of which money addresses are which.
    case "paymentsUnderName":
      return headOnly(paymentsUnderNamePageMetadata(target.name, target.role));
    // The whole record is indexable on its bare address; a subject's or a
    // filtered view is head only with noindex (#1945).
    case "outsideSpending":
      return headOnly(outsideSpendingPageMetadata(target.params));
    case "moneyCommittee":
      return committeeContent(target.slug);
    case "moneyCommitteePayments":
      return committeePaymentsContent(target.slug);
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
