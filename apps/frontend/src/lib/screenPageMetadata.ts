/**
 * The page wording a loaded screen or the first server response builds, and the
 * browser's tab-title path never does.
 *
 * `lib/share.ts` is in the program every page downloads before anything draws,
 * because `navigation/documentTitle.ts` reads 7 of its title builders there. A
 * builder only a lazy screen and `api/page.ts` call does not have to ride along,
 * and these 6 are that: a committee's page, a member's page, the payments filed
 * under 1 printed name, the outside-spending record and the name search. Same
 * move as `lib/pageHead.ts`, for the same measured reason (decisions doc §28.4b
 * and §28.8), and the same rule decides membership: does the tab-title path need
 * it before a screen has loaded?
 *
 * Every screen that needs a title still reads it from the builder the server
 * reads, so a tab, a first response and a share preview cannot say 3 different
 * things (§28.3).
 */

import { registrationNumberFromSlug } from './committeeRoute';
import { MONEY_SECTION_NAME } from './moneySectionName';
import { paymentNameRole, paymentsUnderNameHeading } from './paymentNameRoute';
import {
  clean,
  pageMetadata,
  publicPageUrl,
  titleFor,
  type PageMetadata,
  type ShareContent,
} from './share';

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

export function legislatorPageMetadata(input: {
  slug: string;
  displayName: string;
  districtLine: string;
  /** The portrait the profile draws in its first frame, so the head can ask for it early. */
  photoUrl?: string | null;
  /** This member's own search-result sentence, from `legislatorSearchDescription`. */
  searchDescription?: string;
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
    // A search result names the member; a share card does not, because its own
    // title sits directly above the line and §26 keeps a record's name out of
    // the line under it. All 200 profiles sent one identical sentence until
    // this split, which is the state Google reads as pages repeating each other
    // (decisions doc §3's table holds the wording). The caller builds the
    // sentence, because this file loads with every page in the browser and only
    // the server function ever renders a description
    // (`legislatorSearchDescription`, `apps/frontend/src/lib/legislatorProfile.ts`).
    description: clean(input.searchDescription ?? '') || content.description,
    socialDescription: content.description,
    canonicalPath,
    ...(input.photoUrl ? { preloadImages: [input.photoUrl] } : {}),
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
      title: titleFor(`${label} — named payment records`),
      socialTitle: label,
      description:
        'Named payment records for one committee and filing year, from Minnesota’s campaign-finance filings. These records may not capture every payment.',
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
      'Search Minnesota state campaign filings by the name each record was filed under: legislators, committees, contributor names, and payment-recipient names. A name match alone does not establish identity.',
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
      'Payment records from Minnesota’s campaign filings under one printed name, exactly as it ' +
      'was spelled. A name match alone does not establish identity or a complete payment history.',
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
