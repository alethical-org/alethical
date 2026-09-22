import { SOCIAL_ACCOUNTS } from './socialLinks';
import {
  escapeHtml,
  PUBLIC_SITE_ORIGIN,
  publicPageUrl,
  SITE_NAME,
  SOCIAL_PREVIEW_IMAGE_ALT,
  SOCIAL_PREVIEW_IMAGE_URL,
  type PageMetadata,
} from './share';

/**
 * The head tags for one address, and the shell surgery that puts them there.
 *
 * Only `api/page.ts` runs this: it rewrites the marked block of the built
 * `index.html` before the response is sent. It lives apart from the page wording
 * in `share.ts` because that file loads with every page in the browser, while
 * none of this does anything there, which is why a per-address description
 * sentence belongs here too. Measured 18 Sep 2026: moving it out dropped
 * every reader's first download from 295,412 to 294,478 Brotli bytes, 934 bytes
 * a reader used to fetch to run nothing
 * (`apps/frontend/scripts/check-first-load-budget.mjs`).
 */

/**
 * What one member's search result says under their name.
 *
 * All 200 profiles sent Google one identical sentence until 22 Sep 2026, which is
 * the state it reads as pages repeating each other. This names the member, in the
 * wording `docs/architecture/page-metadata-for-search-and-sharing-decisions.md` §3
 * ruled, and it names only sections the profile really draws: an empty district
 * line is how every surface here knows the record holds no current seat, and such
 * a page shows no committee list and no contact block, so the sentence promises
 * neither (`.claude/rules/grounded-answers.md` rule 6). Party stays out, as it
 * does in the title and for the same reason.
 *
 * It lives in this file for the reason the file itself exists: every other home
 * for it, `share.ts` and `legislatorProfile.ts` alike, loads with every page in
 * the browser, while only the server function ever renders a description. In
 * `share.ts` it cost every reader 83 bytes of their first download
 * (`apps/frontend/scripts/check-first-load-budget.mjs`).
 */
export function legislatorSearchDescription(displayName: string, districtLine: string): string {
  const name = (displayName ?? '').replace(/\s+/g, ' ').trim();
  if (!name) return '';
  return (districtLine ?? '').trim()
    ? `See ${name}’s committee assignments, chief-authored bills, and contact information in the Minnesota Legislature.`
    : `See ${name}’s record of service in the Minnesota Legislature.`;
}

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

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
        // The accounts the footer already links, so a search engine can tie the
        // site and its profiles to one organisation. Google's Organization
        // guidance lists `sameAs` for exactly this; nothing else here is read.
        sameAs: SOCIAL_ACCOUNTS.map((account) => account.url),
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
  const socialDescription = escapeHtml(clean(meta.socialDescription ?? meta.description));
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
    // Only an absolute https address is preloaded: anything else is a record
    // field we do not control, and a bad hint costs a wasted request.
    ...(meta.preloadImages ?? [])
      .filter((href) => /^https:\/\/[^\s"'<>]+$/.test(href))
      .map((href) => `    <link rel="preload" as="image" href="${escapeHtml(href)}" />`),
    // A published piece is an article to the sites that read these tags; every
    // other page is the site itself.
    `    <meta property="og:type" content="${meta.article ? 'article' : 'website'}" />`,
    ...(meta.article
      ? [
          `    <meta property="article:published_time" content="${escapeHtml(meta.article.publishedOn)}" />`,
        ]
      : []),
    `    <meta property="og:site_name" content="${SITE_NAME}" />`,
    `    <meta property="og:title" content="${socialTitle}" />`,
    `    <meta property="og:description" content="${socialDescription}" />`,
    ...(url ? [`    <meta property="og:url" content="${url}" />`] : []),
    `    <meta property="og:image" content="${image}" />`,
    `    <meta property="og:image:width" content="1200" />`,
    `    <meta property="og:image:height" content="630" />`,
    `    <meta property="og:image:alt" content="${imageAlt}" />`,
    `    <meta name="twitter:card" content="summary_large_image" />`,
    `    <meta name="twitter:title" content="${socialTitle}" />`,
    `    <meta name="twitter:description" content="${socialDescription}" />`,
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
