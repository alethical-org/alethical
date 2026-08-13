import { plainBillSummary } from './billDetail';
import { directoryPagePath } from './directoryPagination';

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

// X counts every HTTPS link as 23 characters after shortening it. Leave 1 more
// character for the space X adds between the prepared text and URL.
export const X_SHORT_LINK_LENGTH = 23;
const X_TEXT_LENGTH = 280 - X_SHORT_LINK_LENGTH - 1;

export type ShareSubject = 'bill' | 'legislator' | 'answer';

export interface ShareContent {
  subject: ShareSubject;
  title: string;
  description: string;
  url: string;
}

export interface ShareIntents {
  linkedin: string;
  x: string;
  facebook: string;
  email: string;
}

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function truncateAtWord(value: string, maxLength: number): string {
  const normalized = clean(value);
  if (normalized.length <= maxLength) return normalized;

  const shortened = normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd();
  const lastSpace = shortened.lastIndexOf(' ');
  const wordSafe =
    lastSpace >= Math.floor(maxLength * 0.65) ? shortened.slice(0, lastSpace) : shortened;
  return `${wordSafe.trimEnd()}…`;
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
  summary,
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
  summary?: string | null;
  url: string;
}): ShareContent {
  const cleanIdentifier = clean(identifier);
  const year = billSessionYear(billId);
  const numberAndYear = year ? `${cleanIdentifier} (${year})` : cleanIdentifier;
  const cleanTitle = clean(shortTitle ?? '');
  const description = plainBillSummary(summary ?? null, { firstSentenceOnly: true });

  return {
    subject: 'bill',
    title: cleanTitle ? `${numberAndYear}: ${cleanTitle}` : numberAndYear,
    description:
      description ||
      `See what ${cleanIdentifier} would do and where it stands in the Minnesota Legislature.`,
    url,
  };
}

export function buildLegislatorShareContent({
  displayName,
  districtLine,
  url,
}: {
  displayName: string;
  /** Chamber and district as the profile shows it, e.g. `House District 62A`. */
  districtLine: string;
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
    description: `See ${name}’s committee assignments, chief-authored bills, and contact information in the Minnesota Legislature.`,
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

export function buildShareIntents(content: ShareContent): ShareIntents {
  const enc = encodeURIComponent;
  const xText = truncateAtWord(`${content.title}\n\n${content.description}`, X_TEXT_LENGTH);
  const emailBody = `${content.title}\n\n${content.description}\n\n${content.url}\n\nShared from Alethical`;

  return {
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${enc(content.url)}`,
    x: `https://twitter.com/intent/tweet?text=${enc(xText)}&url=${enc(content.url)}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${enc(content.url)}`,
    email: `mailto:?subject=${enc(content.title)}&body=${enc(emailBody)}`,
  };
}

export function nativeShareText(content: ShareContent, includeUrl: boolean): string {
  return [content.title, content.description, includeUrl ? content.url : null]
    .filter((part): part is string => Boolean(part))
    .join('\n\n');
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
    description: `Search bills in the Minnesota Legislature by topic, chamber, and status.${page > 1 ? ` Page ${page}.` : ''}`,
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
  summary?: string | null;
}): PageMetadata {
  const canonicalPath = `/bills/${encodeURIComponent(input.billId)}`;
  const content = buildBillShareContent({
    identifier: billNumberFromId(input.billId),
    billId: input.billId,
    shortTitle: input.shortTitle,
    summary: input.summary,
    url: publicPageUrl(canonicalPath),
  });
  return pageMetadata({
    title: titleFor(content.title),
    socialTitle: content.title,
    description: content.description,
    canonicalPath,
  });
}

export function legislatorPageMetadata(input: {
  slug: string;
  displayName: string;
  districtLine: string;
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

/** Pages whose wording never varies. */
export const STATIC_PAGE_METADATA: Record<string, PageMetadata> = {
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
  '/terms': pageMetadata({
    title: titleFor('Terms of Service'),
    socialTitle: 'Terms of Service',
    description: 'The terms that govern use of this website and application.',
    canonicalPath: '/terms',
  }),
  // Signed-in surface: a search engine would only ever see the signed-out card,
  // so it is left out of the sitemap and unlisted.
  '/tracked': pageMetadata({
    title: titleFor('Tracked bills'),
    socialTitle: 'Tracked bills',
    description: 'The Minnesota bills you have chosen to follow.',
    canonicalPath: '/tracked',
    noindex: true,
  }),
};

/**
 * The machine-readable description of a page. Deliberately small: only the types
 * a search engine demonstrably does something with (decisions doc §6). No
 * `Person`, no `ProfilePage`, no `Legislation` — all three are tidy labelling
 * that no shipped search feature consumes.
 *
 * No `BreadcrumbList` either, and that one shipped before it was removed. Google
 * asks for it where the page *shows* a breadcrumb trail. What a bill or a
 * legislator page shows is one control labelled "Go back" — and on the web it is
 * an anchor that goes back through browser history when this tab has an in-app
 * entry, and follows its own address to the list otherwise (`backLinkProps` in
 * `apps/frontend/src/navigation/links.ts`). So where it leads depends on how the
 * reader arrived, often the search results they came from. A `BreadcrumbList`
 * asserts a fixed position in a hierarchy; a control with no fixed destination
 * does not have one. Relabelling the link "Bills" to justify the markup would
 * change visible copy on every detail page to serve a minor search feature, and
 * would read as wrong whenever the button genuinely goes back — the trade
 * `docs/philosophy.md` principle 10 rejects. If a real breadcrumb trail is ever
 * designed, the markup comes back with it (decisions doc §6 and §12).
 */
export function pageJsonLd(meta: PageMetadata): object[] {
  if (meta.canonicalPath === '/') {
    return [
      {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: SITE_NAME,
        url: `${PUBLIC_SITE_ORIGIN}/`,
      },
      {
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: SITE_NAME,
        url: `${PUBLIC_SITE_ORIGIN}/`,
        logo: `${PUBLIC_SITE_ORIGIN}/icon-512.png`,
      },
    ];
  }
  return [];
}

/**
 * The head tags for one page, as HTML. `api/page.ts` drops this into the same
 * `index.html` the site already serves, so a search engine and a person receive
 * byte-identical HTML for the same address.
 *
 * Every value is escaped: 10,471 AI-written titles and summaries are 10,471
 * chances for one odd character to break the markup.
 */
export function renderPageHead(meta: PageMetadata): string {
  const title = escapeHtml(meta.title);
  const socialTitle = escapeHtml(meta.socialTitle);
  const description = escapeHtml(clean(meta.description));
  // Empty on a "not found" page: it is not a copy of any real address, so it
  // declares none rather than pointing a search engine at an unrelated page.
  const url = meta.canonicalPath ? escapeHtml(publicPageUrl(meta.canonicalPath)) : '';
  const image = escapeHtml(SOCIAL_PREVIEW_IMAGE_URL);
  const imageAlt = escapeHtml(SOCIAL_PREVIEW_IMAGE_ALT);
  const jsonLd = pageJsonLd(meta)
    // `<` is escaped so a stored string can never close the script element early.
    .map(
      (block) =>
        `    <script type="application/ld+json">${JSON.stringify(block).replace(/</g, '\\u003c')}</script>`,
    )
    .join('\n');

  return [
    `    <title>${title}</title>`,
    `    <meta name="description" content="${description}" />`,
    ...(url ? [`    <link rel="canonical" href="${url}" />`] : []),
    ...(meta.noindex ? [`    <meta name="robots" content="noindex" />`] : []),
    `    <meta property="og:type" content="website" />`,
    `    <meta property="og:site_name" content="${SITE_NAME}" />`,
    `    <meta property="og:title" content="${socialTitle}" />`,
    `    <meta property="og:description" content="${description}" />`,
    ...(url ? [`    <meta property="og:url" content="${url}" />`] : []),
    `    <meta property="og:image" content="${image}" />`,
    `    <meta property="og:image:width" content="1200" />`,
    `    <meta property="og:image:height" content="630" />`,
    `    <meta property="og:image:alt" content="${imageAlt}" />`,
    `    <meta name="twitter:card" content="summary_large_image" />`,
    `    <meta name="twitter:title" content="${socialTitle}" />`,
    `    <meta name="twitter:description" content="${description}" />`,
    `    <meta name="twitter:image" content="${image}" />`,
    `    <meta name="twitter:image:alt" content="${imageAlt}" />`,
    ...(jsonLd ? [jsonLd] : []),
  ].join('\n');
}

/**
 * The markers in `apps/frontend/public/index.html` that bound the replaceable
 * head. Everything between them is regenerated per address; everything outside
 * (fonts, the reset, the recovery script) is left exactly as the build wrote it.
 */
export const HEAD_MARKER_START = '<!--alethical:page-head-->';
export const HEAD_MARKER_END = '<!--/alethical:page-head-->';

export function injectPageHead(shellHtml: string, meta: PageMetadata): string {
  const start = shellHtml.indexOf(HEAD_MARKER_START);
  const end = shellHtml.indexOf(HEAD_MARKER_END);
  if (start < 0 || end < 0 || end < start) {
    throw new Error('page shell is missing its head markers');
  }
  return (
    shellHtml.slice(0, start + HEAD_MARKER_START.length) +
    '\n' +
    renderPageHead(meta) +
    '\n    ' +
    shellHtml.slice(end)
  );
}
