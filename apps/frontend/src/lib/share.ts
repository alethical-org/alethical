import { registrationNumberFromSlug } from './committeeRoute';
import { directoryPagePath } from './directoryPagination';
import { paymentNameRole, paymentsUnderNameHeading } from './paymentNameRoute';

export const PUBLIC_SITE_ORIGIN = 'https://www.alethical.com';
export const SOCIAL_PREVIEW_IMAGE_URL = `${PUBLIC_SITE_ORIGIN}/social-preview.png`;
export const SOCIAL_PREVIEW_IMAGE_ALT =
  'Alethical: Minnesota’s legislative record in plain language, with links to official sources.';
export const SITE_NAME = 'Alethical';

// Page wording starts here — issue #1325. Three surfaces read
// it and they must not drift: the browser tab title, the tags in the FIRST server
// response (api/page.ts, so a search engine and a person receive the same HTML),
// and the share sheet. The rules these strings obey are argued in
// docs/architecture/page-metadata-for-search-and-sharing-decisions.md §3 (What
// each page should say) — be as specific as the URL is, promise only what the
// page shows, never a bill's statutory title, and the description never says
// "Alethical" because the title already ends with it.
const TITLE_SUFFIX = ` | ${SITE_NAME}`;

export const HOME_PAGE_TITLE = 'Alethical: Minnesota political intelligence & campaign strategy';
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

export function clean(value: string): string {
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

export function pageMetadata(
  input: Partial<PageMetadata> & { title: string; description: string },
) {
  return {
    socialTitle: input.title,
    canonicalPath: '/',
    noindex: false,
    ...input,
  } satisfies PageMetadata;
}

/** A subject line plus the site suffix — the shape every page title but Home uses. */
export function titleFor(subject: string): string {
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
    /** The one contest this address opens on, e.g. "House District 12A". */
    selectedLabel?: string | null;
    /** A seat's served identifier, e.g. "house-34a", when the address is its own. */
    group?: string | null;
    /** This seat's search-result sentence, from `raceGroupSearchDescription`. */
    searchDescription?: string;
  } = {},
): PageMetadata {
  // "Race" alone reads 2 ways in a search result; the subject says which one.
  const subject = 'Money by race: Minnesota candidates by office and district';
  const selected = clean(options.selectedLabel ?? '');
  const group = clean(options.group ?? '');
  return pageMetadata({
    title: titleFor(selected ? `${selected} — ${subject}` : subject),
    socialTitle: selected ? `${selected} — Money by race` : 'Money by race',
    description:
      clean(options.searchDescription ?? '') ||
      'Every Minnesota candidate committee grouped by the office and district it is registered for, each with its own reported money in — ordered by district, then name, never by amount.',
    canonicalPath: group
      ? `/money/races/${encodeURIComponent(group)}`
      : options.noindex
        ? ''
        : '/money/races',
    noindex: options.noindex,
  });
}
