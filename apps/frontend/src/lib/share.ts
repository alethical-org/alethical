import { registrationNumberFromSlug } from './committeeRoute';
import { directoryPagePath } from './directoryPagination';
import { MONEY_SECTION_NAME } from './moneySectionName';
import { paymentNameRole, paymentsUnderNameHeading } from './paymentNameRoute';
import {
  READ_PAGE_HEADING,
  READ_PAGE_INTRO,
  READ_PAGE_NAME,
  pieceShareDescription,
  piecePath,
  type PieceIndexEntry,
} from './researchIndex';

export const PUBLIC_SITE_ORIGIN = 'https://www.alethical.com';
export const SOCIAL_PREVIEW_IMAGE_URL = `${PUBLIC_SITE_ORIGIN}/social-preview.png`;
export const SOCIAL_PREVIEW_IMAGE_ALT =
  'Alethical: Minnesota’s legislative record in plain language, with links to official sources.';
export const SITE_NAME = 'Alethical';

// Every page's own wording lives in this file — issue #1325. Three surfaces read
// it and they must not drift: the browser tab title, the tags in the FIRST server
// response (api/page.ts, so a search engine and a person receive the same HTML),
// and the share sheet. The rules these strings obey are argued in
// docs/architecture/page-metadata-for-search-and-sharing-decisions.md §3 (What
// each page should say) — be as specific as the URL is, promise only what the
// page shows, never a bill's statutory title, and the description never says
// "Alethical" because the title already ends with it.
const TITLE_SUFFIX = ` | ${SITE_NAME}`;

export const HOME_PAGE_TITLE = 'Alethical: Minnesota’s legislative record in plain language';
export const HOME_PAGE_DESCRIPTION =
  'Minnesota’s legislative record, in plain language, with links to official sources.';
const BILL_LIST_SUBJECT = 'Search Minnesota bills';
const LEGISLATOR_LIST_SUBJECT = 'Minnesota House and Senate members';

export type ShareSubject =
  | 'bill'
  | 'legislator'
  | 'answer'
  | 'research'
  | 'guide'
  | 'committee'
  | 'principal'
  | 'lobbyist'
  | 'results';

export type ShareResultsKind = 'search' | 'payments' | 'race' | 'outside-spending';

export function shareDialogLabel(subject: ShareSubject, resultsKind?: ShareResultsKind): string {
  if (subject !== 'results') return `Share this ${subject}`;
  switch (resultsKind) {
    case 'search':
      return 'Share these search results';
    case 'payments':
      return 'Share these payment records';
    case 'race':
      return 'Share this race comparison';
    case 'outside-spending':
      return 'Share these outside-spending results';
    default:
      return 'Share these results';
  }
}

export interface ShareContent {
  subject: ShareSubject;
  /** Window/accessible heading context only, never included in outgoing messages. */
  resultsKind?: ShareResultsKind;
  title: string;
  description: string;
  /** Optional shorter line shown in the Share panel without changing prepared post text. */
  previewDescription?: string;
  url: string;
}

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function publicPageUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${PUBLIC_SITE_ORIGIN}${normalizedPath}`;
}

/**
 * The session year printed in a bill's title, read out of the bill id
 * (`94-2025-HF719` → `2025`). Bill numbers repeat every biennium, so `HF 719`
 * alone is ambiguous forever; the id already carries the year, so no extra
 * request is needed to disambiguate.
 */
export function billSessionYear(billId: string | null | undefined): string | null {
  const match = (billId ?? '').match(/^\d+-(\d{4})-/);
  return match ? match[1] : null;
}

/** `94-2025-HF719` → `HF 719`. Falls back to the id when it is not that shape. */
export function billNumberFromId(billId: string): string {
  const match = billId.match(/-(SF|HF)(\d+)$/i);
  return match ? `${match[1].toUpperCase()} ${match[2]}` : billId;
}

export function buildBillShareContent({
  identifier,
  billId,
  shortTitle,
  cardLine,
  url,
}: {
  identifier: string;
  billId?: string | null;
  /**
   * The plain-language short title ONLY. Never the bill's official statutory
   * title, which is a paragraph of legal cross-references
   * (`.claude/rules/grounded-answers.md` rule 10). A bill with no short title
   * yet is titled by its number and year alone.
   */
  shortTitle?: string | null;
  /**
   * What the card's second line should say, or empty for the fixed label below.
   * `billDescriptionLines` in `apps/frontend/src/lib/billSummaryText.ts` decides
   * it, and the caller runs that rather than this file, because this file loads
   * with every page and neither the summary cleaner's regexes nor the
   * title-repetition test belongs in a first download (that file holds the
   * measurement that made this a rule).
   */
  cardLine?: string | null;
  url: string;
}): ShareContent {
  const cleanIdentifier = clean(identifier);
  const year = billSessionYear(billId);
  const numberAndYear = year ? `${cleanIdentifier} (${year})` : cleanIdentifier;
  const cleanTitle = clean(shortTitle ?? '');

  return {
    subject: 'bill',
    title: cleanTitle ? `${numberAndYear}: ${cleanTitle}` : numberAndYear,
    description: clean(cardLine ?? '') || BILL_SHARE_LABEL,
    url,
  };
}

/** The line a bill's card falls back to when its summary would only say the title again. */
export const BILL_SHARE_LABEL = 'Bill text, legislative progress, and official sources';

export function buildLegislatorShareContent({
  displayName,
  districtLine,
  moneyYear,
  url,
}: {
  displayName: string;
  /** Chamber and district as the profile shows it, e.g. `House District 62A`. */
  districtLine: string;
  /** Selected filing year when the shared link opens Campaign money. */
  moneyYear?: number;
  url: string;
}): ShareContent {
  const name = clean(displayName);
  const place = clean(districtLine);
  return {
    subject: 'legislator',
    // Party is deliberately absent. District plus chamber identify a person just
    // as well, never go stale mid-term, and keep a partisan label out of a search
    // result read in isolation (decisions doc §3).
    title: place ? `${name}, Minnesota ${place}` : name,
    // Lists only sections the profile actually renders, and this is checked
    // rather than assumed. It said "recent votes" until #1325 measured the page:
    // votes appear solely inside the unfinished "On the roadmap" area, so the
    // sentence promised a section that is not there (grounded-answers.md rule 6
    // — copy claims match shipped capability). When a section is added to or
    // removed from the profile, this sentence changes with it.
    description:
      moneyYear === undefined
        ? 'Committee assignments, chief-authored bills, and contact information'
        : `Campaign money for filing year ${moneyYear}, from Minnesota’s official filings`,
    url,
  };
}

export function buildAnswerShareContent({
  question,
  url,
}: {
  question: string;
  url: string;
}): ShareContent {
  return {
    subject: 'answer',
    title: clean(question),
    description:
      'Read Alethical’s cited answer, with links to the Minnesota Legislature’s official record.',
    url,
  };
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// --- What every page tells a browser tab, a search engine and a share preview ---

export interface PageMetadata {
  /** The whole `<title>`, and the whole browser tab title. */
  title: string;
  /** `og:title` / `twitter:title`. No site suffix — `og:site_name` carries it. */
  socialTitle: string;
  description: string;
  /** Site-relative address this page declares as its real one. */
  canonicalPath: string;
  /** True when a search engine must not list the page. */
  noindex: boolean;
  /**
   * Images the page draws in its first frame, asked for in the head so they
   * arrive with the HTML rather than after the app has mounted and asked. A
   * legislator's portrait, on their profile: measured live 17 Sep 2026, the
   * request left 1.4 s into the load and the photo landed 250 ms after the page
   * had otherwise finished drawing.
   */
  preloadImages?: string[];
  /**
   * Set on a published piece: the preview type becomes `article` and the
   * publication date travels as `article:published_time`. A date is the one
   * thing rule 13 lets a piece's metadata carry beside its title.
   */
  article?: { publishedOn: string };
  /**
   * What a share card and an outgoing message say, when it differs from what a
   * search result says. A bill's search text is the first sentence of its
   * plain-language summary, so 10,517 pages do not hand Google one identical
   * line; its share text stays the fixed line §26 rules, which never repeats a
   * title through a summary that paraphrases it. Absent = the 2 are the same.
   */
  socialDescription?: string;
}

function pageMetadata(input: Partial<PageMetadata> & { title: string; description: string }) {
  return {
    socialTitle: input.title,
    canonicalPath: '/',
    noindex: false,
    ...input,
  } satisfies PageMetadata;
}

/** A subject line plus the site suffix — the shape every page title but Home uses. */
function titleFor(subject: string): string {
  return `${subject}${TITLE_SUFFIX}`;
}

export function homePageMetadata(): PageMetadata {
  return pageMetadata({
    title: HOME_PAGE_TITLE,
    description: HOME_PAGE_DESCRIPTION,
    canonicalPath: '/',
  });
}

export const NOT_FOUND_HEADING = 'We couldn’t find that page';
export const NOT_FOUND_DESCRIPTION = 'The address may be mistyped, or the page may have moved.';

export function notFoundPageMetadata(): PageMetadata {
  return pageMetadata({
    title: titleFor('Page not found'),
    socialTitle: 'Page not found',
    description: NOT_FOUND_DESCRIPTION,
    // A missing page is not a copy of a real page.
    canonicalPath: '',
    noindex: true,
  });
}

export function billListPageMetadata(page = 1, options: { noindex?: boolean } = {}): PageMetadata {
  const subject = page > 1 ? `${BILL_LIST_SUBJECT}, page ${page}` : BILL_LIST_SUBJECT;
  return pageMetadata({
    title: titleFor(subject),
    socialTitle: subject,
    description: `Search bills in the Minnesota Legislature by issue, chamber, and status.${page > 1 ? ` Page ${page}.` : ''}`,
    // Filtered addresses carry no canonical while they are noindex. Combining
    // both signals can make the intended indexable directory ambiguous.
    canonicalPath: options.noindex ? '' : directoryPagePath('/bills', page),
    noindex: options.noindex,
  });
}

export function legislatorListPageMetadata(
  page = 1,
  options: { noindex?: boolean } = {},
): PageMetadata {
  const subject = page > 1 ? `${LEGISLATOR_LIST_SUBJECT}, page ${page}` : LEGISLATOR_LIST_SUBJECT;
  return pageMetadata({
    title: titleFor(subject),
    socialTitle: subject,
    description: `Find a Minnesota legislator by name, chamber, or party.${page > 1 ? ` Page ${page}.` : ''}`,
    canonicalPath: options.noindex ? '' : directoryPagePath('/legislators', page),
    noindex: options.noindex,
  });
}

export function billPageMetadata(input: {
  billId: string;
  shortTitle?: string | null;
  /** What a search result and a share card each say, from `billDescriptionLines`. */
  lines?: { search: string; card: string };
}): PageMetadata {
  const canonicalPath = `/bills/${encodeURIComponent(input.billId)}`;
  const content = buildBillShareContent({
    identifier: billNumberFromId(input.billId),
    billId: input.billId,
    shortTitle: input.shortTitle,
    cardLine: input.lines?.card,
    url: publicPageUrl(canonicalPath),
  });
  // The search result always gets this bill's own first sentence; the share card
  // gets it only when it adds to the title, and the fixed label when it restates
  // it (Eugene, 17 and 18 Sep 2026, decisions doc §26).
  const searchDescription = clean(input.lines?.search ?? '');
  return pageMetadata({
    title: titleFor(content.title),
    socialTitle: content.title,
    description: searchDescription || content.description,
    socialDescription: content.description,
    canonicalPath,
  });
}

export function legislatorPageMetadata(input: {
  slug: string;
  displayName: string;
  districtLine: string;
  /** The portrait the profile draws in its first frame, so the head can ask for it early. */
  photoUrl?: string | null;
}): PageMetadata {
  const canonicalPath = `/legislators/${encodeURIComponent(input.slug)}`;
  const content = buildLegislatorShareContent({
    displayName: input.displayName,
    districtLine: input.districtLine,
    url: publicPageUrl(canonicalPath),
  });
  return pageMetadata({
    title: titleFor(content.title),
    socialTitle: content.title,
    description: content.description,
    canonicalPath,
    ...(input.photoUrl ? { preloadImages: [input.photoUrl] } : {}),
  });
}

/**
 * Answer pages are left crawlable on purpose and carry noindex instead. A page a
 * crawler is blocked from fetching cannot be read, so a robots.txt block would
 * stop the very instruction that unlists it from ever arriving (decisions doc §7).
 */
export function askPageMetadata(question?: string | null): PageMetadata {
  const asked = clean(question ?? '');
  const content = buildAnswerShareContent({ question: asked, url: publicPageUrl('/ask') });
  const subject = asked ? content.title : 'Ask about Minnesota legislation';
  return pageMetadata({
    title: titleFor(subject),
    socialTitle: subject,
    description: content.description,
    canonicalPath: '/ask',
    noindex: true,
  });
}

/**
 * One posted research piece's page metadata. Title and dates ONLY: piece
 * claims and derived labels appear in no social-share preview or metadata
 * (.claude/rules/grounded-answers.md rule 13), so the dek and every figure stay
 * out of these tags.
 *
 * An indexed piece carries no `nosnippet`: an ordinary search snippet always
 * links to the page holding the method, and suppressing body text on a
 * transparency product reads as hiding the thing it publishes. Since 25 Aug
 * 2026 rule 13 publishes every piece `indexed: true` on the day it posts, so
 * the `noindex` branch below is now the hold-back for a piece Eugene names
 * rather than the default; a held piece carries no canonical while it is held.
 * It stays fully readable on the site either way; only search engines are held
 * off (rule 13's publishing order).
 */
export function researchPageMetadata(piece: PieceIndexEntry): PageMetadata {
  return pageMetadata({
    title: titleFor(piece.title),
    socialTitle: piece.title,
    // What a search result says: a guide describes what it covers, in its own
    // words, and a piece with no such line falls back to its dates (Eugene,
    // 18 Sep 2026). A date alone tells a searcher nothing about whether the page
    // answers their question, and 5 guides were telling them nothing else.
    description: piece.searchDescription || pieceShareDescription(piece),
    // A share preview still carries title and dates only, which is rule 13's own
    // wording and is unchanged.
    socialDescription: pieceShareDescription(piece),
    // The canonical address comes from the piece's traits, so it can only ever be
    // the 1 address the router accepts for it.
    canonicalPath: piece.indexed ? piecePath(piece) : '',
    noindex: !piece.indexed,
    article: { publishedOn: piece.publishedOn },
  });
}

/**
 * A committee money page's metadata, from its address alone. The name part of the
 * slug is whatever the link's author typed — canonical links carry the register's
 * current name, but a misspelled one still resolves — so the tags name the
 * committee by its registration number, the only part that is always right. The
 * client puts the register's own name in the tab once the record loads.
 */
export function committeeMoneyPageMetadata(
  slug: string,
  view: 'page' | 'payments' = 'page',
  // The register's own spelling of the name, and the address built from it, once
  // the record has been read. Committee names collide and a name part in an
  // address may be old or misspelled, so the page a reader shares has to be the
  // one address we call canonical, not whichever spelling they arrived on
  // (#1812). Absent = the record could not be read, and the number stands in.
  record?: {
    name: string;
    canonicalSlug: string;
    /** The register's kind, in the Board's words ("Candidate committee", "Political fund"). */
    kind?: string | null;
    /** "Registered for House District 12A", or "Registered as: political fund". */
    registeredFor?: string | null;
  },
): PageMetadata {
  const number = registrationNumberFromSlug(slug);
  const label = record?.name || (number ? `Committee ${number}` : 'Committee');
  const base = `/money/committees/${encodeURIComponent(record?.canonicalSlug ?? slug)}`;
  if (view === 'payments') {
    return pageMetadata({
      title: titleFor(`${label} — every payment named`),
      socialTitle: label,
      description:
        'Every named payment behind one committee’s figures, largest first, from Minnesota’s own campaign-finance filings.',
      canonicalPath: `${base}/payments`,
    });
  }
  return pageMetadata({
    title: titleFor(`${label} — Minnesota campaign money`),
    socialTitle: label,
    description: committeeDescription(record),
    canonicalPath: base,
  });
}

/**
 * One committee's description, from its register facts and nothing else: the
 * Board's kind for it and what it registered for. Never the name, which the
 * title already carries (§26: a description does not repeat the record name),
 * and never a figure (§3 rule 4: a description states no number the page cannot
 * back, and a search result shows no freshness date beside one). A record whose
 * register row says neither falls back to the one sentence true of every
 * committee page, which §3 rule 5 prefers over a varied guess.
 */
function committeeDescription(record?: {
  kind?: string | null;
  registeredFor?: string | null;
}): string {
  const registeredFor = clean(record?.registeredFor ?? '');
  const seat = registeredFor.match(/^Registered for (.+)$/)?.[1];
  const kind = clean(record?.kind ?? '').toLowerCase();
  if (seat) {
    return `Money in and money out for the ${kind || 'committee'} registered for ${seat}, from Minnesota’s own campaign-finance filings.`;
  }
  if (kind) {
    return `Money in and money out for a Minnesota ${kind}, from the state’s own campaign-finance filings.`;
  }
  return 'One committee’s money in and money out, from Minnesota’s own campaign-finance filings.';
}

/**
 * The committees list's metadata. A filtered or scrolled address carries no
 * canonical and is noindex: the name box, the kind filter and the row count
 * combine into effectively unlimited addresses, and only the bare list is a page
 * worth listing — the same rule the bill and legislator directories follow.
 */
export function committeeListPageMetadata(
  page = 1,
  options: { noindex?: boolean } = {},
): PageMetadata {
  const subject =
    page > 1
      ? `Committees, page ${page} — Minnesota campaign money`
      : 'Committees — Minnesota campaign money';
  return pageMetadata({
    title: titleFor(subject),
    socialTitle: subject,
    description:
      'Everyone registered to raise or spend money in Minnesota state politics: candidate committees, party units, and the committees and funds that give to them.' +
      (page > 1 ? ` Page ${page}.` : ''),
    canonicalPath: options.noindex ? '' : directoryPagePath('/money/committees', page),
    noindex: options.noindex,
  });
}

/**
 * The Money by race page's metadata (issue #1954). Only the bare list is a page
 * worth listing: an office chip is one of a handful of query strings, but the
 * same rule the other directories follow keeps every filtered view noindex with
 * no canonical, so 1 address stands for the page.
 */
export function moneyByRacePageMetadata(
  options: {
    noindex?: boolean;
    /** The one contest a `?group=` address opens on, e.g. "House District 12A". */
    selectedLabel?: string | null;
  } = {},
): PageMetadata {
  // "Race" alone reads 2 ways in a search result; the subject says which one.
  const subject = 'Money by race: Minnesota candidates by office and district';
  const selected = clean(options.selectedLabel ?? '');
  return pageMetadata({
    title: titleFor(selected ? `${selected} — ${subject}` : subject),
    socialTitle: selected ? `${selected} — Money by race` : 'Money by race',
    description:
      'Every Minnesota candidate committee grouped by the office and district it is registered for, each with its own reported money in — ordered by district, then name, never by amount.',
    canonicalPath: options.noindex ? '' : '/money/races',
    noindex: options.noindex,
  });
}

/**
 * A name-search results page. Always noindex, for the same reason an Ask answer
 * page is: the address is whatever somebody typed, so listing it would put an
 * unbounded set of query strings into a search index. The page stays crawlable so
 * the committee pages it links to are still reachable.
 */
export function moneySearchPageMetadata(query?: string | null): PageMetadata {
  const trimmed = (query ?? '').trim();
  const label = trimmed ? `Campaign money search: ${trimmed}` : 'Search campaign money by name';
  return pageMetadata({
    title: titleFor(label),
    socialTitle: label,
    description:
      'Search Minnesota state campaign filings by the name each record was filed under: legislators, committees, donors, and the businesses that got paid.',
    canonicalPath: '',
    noindex: true,
  });
}

/**
 * The payments filed under one printed name. Always noindex, and for a reason
 * stronger than the search page's: the address is one free-text spelling out of
 * hundreds of thousands, so listing it would put an unbounded set of thin pages
 * in front of search engines
 * (`docs/architecture/page-metadata-for-search-and-sharing-decisions.md` §20.5
 * rule 4), and a page indexed under a name reads as a profile of whoever carries
 * it — which is the one thing this page may never be
 * (`.claude/rules/grounded-answers.md` rule 3, and the endpoint's own contract:
 * the printed string is the whole of the key and never an identity).
 *
 * The page stays crawlable, so the committee pages its rows link to are still
 * reachable.
 */
export function paymentsUnderNamePageMetadata(name: string, role: string): PageMetadata {
  const validRole = paymentNameRole(role);
  const label = validRole
    ? paymentsUnderNameHeading(name, validRole)
    : 'Payments filed under one name';
  return pageMetadata({
    title: titleFor(label),
    socialTitle: label,
    description:
      'Every payment Minnesota’s campaign filings record under one printed name, exactly as it ' +
      'was spelled, each row opening the committee that filed it.',
    canonicalPath: '',
    noindex: true,
  });
}

/**
 * The outside-spending record (#1945). The bare address is one record — the whole
 * independent-expenditure file as one subject — so it is indexable with its own
 * canonical. A subject's view (`spender`, `about`) and any year, sort or page is a
 * filtered view of the same rows: head only, `noindex`, no canonical, because each
 * committee already has its own record page and an address per filter combination
 * is an unbounded set (`docs/architecture/page-metadata-for-search-and-sharing-decisions.md`
 * §22).
 */
export function outsideSpendingPageMetadata(params: Record<string, string> = {}): PageMetadata {
  const filtered = Object.values(params).some(Boolean);
  const label = 'Outside spending';
  return pageMetadata({
    title: titleFor('Outside spending in Minnesota campaigns'),
    socialTitle: label,
    description:
      'Independent-expenditure filings showing support for or opposition to Minnesota campaign committees.',
    canonicalPath: filtered ? '' : '/money/outside-spending',
    noindex: filtered,
  });
}

/** Pages whose wording never varies. */
export const STATIC_PAGE_METADATA: Record<string, PageMetadata> = {
  // The campaign money landing (public, no sign-in gate). The description may
  // say these records are searchable now that the field on it works and the
  // committees list exists (issue #1696) — until they shipped it deliberately
  // promised only the record (grounded-answers.md rule 2).
  '/money': pageMetadata({
    title: titleFor(`${MONEY_SECTION_NAME} in Minnesota`),
    socialTitle: MONEY_SECTION_NAME,
    description:
      'Contributions and spending for Minnesota state campaigns, as the state publishes them, searchable by the name each record was filed under.',
    canonicalPath: '/money',
  }),
  '/money/committees': committeeListPageMetadata(),
  '/money/races': moneyByRacePageMetadata(),
  // The tab carries the page's own name, because the page itself shows no title:
  // the bar and the address already say the word, so a third visible instance is
  // what the naming rule forbids, and the tab is where the name still has to
  // exist (Design's /read handoff, 27 Aug 2026). The share card keeps the
  // descriptive title instead, because a card has no bar or address beside it to
  // say what "Read" would mean.
  '/read': pageMetadata({
    title: titleFor(READ_PAGE_NAME),
    socialTitle: READ_PAGE_HEADING,
    description: READ_PAGE_INTRO,
    canonicalPath: '/read',
  }),
  '/confirm': pageMetadata({
    title: titleFor('Confirm email'),
    socialTitle: 'Confirm email',
    description: 'Confirm the email address from this message.',
    canonicalPath: '/confirm',
    noindex: true,
  }),
  '/reset': pageMetadata({
    title: titleFor('Reset password'),
    socialTitle: 'Reset password',
    description: 'Check this reset link and choose a new password.',
    canonicalPath: '/reset',
    noindex: true,
  }),
  '/find-my-legislator': pageMetadata({
    title: titleFor('Find my legislator'),
    socialTitle: 'Find my legislator',
    description:
      'Enter a Minnesota address to see which state House and Senate members represent it.',
    canonicalPath: '/find-my-legislator',
  }),
  '/about': pageMetadata({
    title: titleFor('About us'),
    socialTitle: 'About us',
    description:
      'Why this site exists, and how Minnesota’s official legislative record is turned into plain language.',
    canonicalPath: '/about',
  }),
  '/about/contact': pageMetadata({
    title: titleFor('Contact us'),
    socialTitle: 'Contact us',
    description: 'Send a question, a correction, or feedback about Minnesota legislative records.',
    canonicalPath: '/about/contact',
  }),
  '/privacy': pageMetadata({
    title: titleFor('Privacy Policy'),
    socialTitle: 'Privacy Policy',
    description: 'How information is collected, used, and protected on this site.',
    canonicalPath: '/privacy',
  }),
  '/site-metrics': pageMetadata({
    title: titleFor('Site Metrics'),
    socialTitle: 'Site Metrics',
    description: 'Public totals about traffic, search discovery, availability, and speed.',
    canonicalPath: '/site-metrics',
  }),
  '/terms': pageMetadata({
    title: titleFor('Terms of Service'),
    socialTitle: 'Terms of Service',
    description: 'The terms that govern use of this website and application.',
    canonicalPath: '/terms',
  }),
  // Signed-in surface: a search engine would only ever see the signed-out card,
  // so it is left out of the sitemap and unlisted.
  '/admin/metrics': pageMetadata({
    title: titleFor('Admin metrics'),
    socialTitle: 'Admin metrics',
    description: 'Private aggregate measurements for approved administrators.',
    canonicalPath: '/admin/metrics',
    noindex: true,
  }),
  '/admin/users': pageMetadata({
    title: titleFor('Users'),
    socialTitle: 'Users',
    description: 'Private account information for approved administrators.',
    canonicalPath: '/admin/users',
    noindex: true,
  }),
  '/tracked': pageMetadata({
    title: titleFor('Tracked'),
    socialTitle: 'Tracked',
    description: 'The Minnesota bills and campaign committees you have chosen to follow.',
    canonicalPath: '/tracked',
    noindex: true,
  }),
};
