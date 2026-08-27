import { registrationNumberFromSlug } from '../lib/committeeMoney';
import { pieceAddressFolder, researchBySlug } from '../lib/research';
import type { MainTabParamList, RootStackParamList } from './types';

type WebNavigationState = {
  readonly index?: number;
  readonly routes: Array<{
    readonly name: string;
    readonly params?: object;
    readonly state?: WebNavigationState;
  }>;
};

type WebRouteTarget =
  | { kind: 'tab'; screen: keyof MainTabParamList }
  | { kind: 'bill'; billId: string; tab?: string; track?: boolean }
  | { kind: 'legislator'; legislatorId: string; tab?: string; year?: string }
  | { kind: 'bills'; params: Record<string, string> }
  | { kind: 'legislators'; params: Record<string, string> }
  | { kind: 'findMyLegislator'; address?: string }
  | { kind: 'moneyLanding' }
  | { kind: 'read' }
  | { kind: 'research'; slug: string }
  | { kind: 'guide'; slug: string }
  | { kind: 'moneyCommittee'; slug: string; tab?: string; year?: string }
  | { kind: 'moneyCommitteePayments'; slug: string; tab?: string; year?: string }
  | { kind: 'moneyCommitteeList'; params: Record<string, string> }
  | { kind: 'moneySearch'; params: Record<string, string> }
  | { kind: 'privacy' }
  | { kind: 'siteMetrics' }
  | { kind: 'terms' }
  | { kind: 'aboutUs' }
  | { kind: 'contactUs' }
  | { kind: 'confirmEmail' }
  | { kind: 'resetPassword' }
  | { kind: 'chatSession'; params: RootStackParamList['ChatSession'] }
  | { kind: 'ask'; params: RootStackParamList['Ask'] }
  | { kind: 'notFound'; path: string };

/**
 * A piece asked for at one of the 2 retired RESEARCH-only addresses
 * (`/reports/{slug}` and `/money/reports/{slug}`). `vercel.json` forwards both
 * permanently and directly in production; this is what makes such a link land
 * anyway on a host without those forwards — the dev server, a local static
 * export, or a client-side link written before the move.
 *
 * A guide is deliberately not reachable here: only research ever answered on
 * these 2 addresses, so honouring a guide's slug would create a second address
 * for a page that has one. `/reading/guides/{slug}` is the third retired
 * address and it is NOT one of these — a guide did answer there, from the
 * evening of 27 Aug 2026, so it forwards to `/read/guides/{slug}` below.
 */
function retiredPieceAddress(slug: string, pathname: string): WebRouteTarget {
  const piece = researchBySlug(slug);
  return piece && pieceAddressFolder(piece) === 'research'
    ? { kind: 'research', slug }
    : { kind: 'notFound', path: pathname };
}

function normalizePathname(pathname: string) {
  const trimmed = pathname.split('?')[0].replace(/\/+$/, '');
  return trimmed.length > 0 ? trimmed : '/';
}

function searchParamsFromPathname(pathname: string) {
  const queryIndex = pathname.indexOf('?');
  return new URLSearchParams(queryIndex >= 0 ? pathname.slice(queryIndex + 1) : '');
}

// URL-addressable Search Bills filters (issue #135). One list drives both
// directions so the query string and the Bills route params stay in lockstep.
const BILLS_FILTER_PARAMS = [
  'q',
  'topic',
  'scope',
  'chamber',
  'status',
  'session',
  'issue',
  'omnibus',
  'sort',
  'page',
] as const;

function billsFilterParams(searchParams: URLSearchParams): Record<string, string> {
  const params: Record<string, string> = {};
  for (const key of BILLS_FILTER_PARAMS) {
    const value = searchParams.get(key);
    if (value) {
      params[key] = value;
    }
  }
  return params;
}

// URL-addressable Search Legislators filters — same shape as Bills so a filtered
// roster is shareable, reload-safe, and survives the browser Back button after
// visiting a legislator profile.
const LEGISLATORS_FILTER_PARAMS = ['q', 'chamber', 'party', 'session', 'page'] as const;

function legislatorsFilterParams(searchParams: URLSearchParams): Record<string, string> {
  const params: Record<string, string> = {};
  for (const key of LEGISLATORS_FILTER_PARAMS) {
    const value = searchParams.get(key);
    if (value) {
      params[key] = value;
    }
  }
  return params;
}

// URL-addressable committees-list state (campaign money phase 3): the name box,
// the register's own kind filter, and how many rows the reader asked to see. All
// 3 live in the address so a narrowed or scrolled list can be shared and survives
// the browser Back button after opening a committee.
const COMMITTEE_LIST_PARAMS = ['q', 'kind', 'show'] as const;

function committeeListParams(searchParams: URLSearchParams): Record<string, string> {
  const params: Record<string, string> = {};
  for (const key of COMMITTEE_LIST_PARAMS) {
    const value = searchParams.get(key);
    if (value) {
      params[key] = value;
    }
  }
  return params;
}

function moneySearchParams(searchParams: URLSearchParams): Record<string, string> {
  const query = searchParams.get('q');
  return query ? { q: query } : {};
}

export function targetFromPathname(pathname: string): WebRouteTarget {
  const normalized = normalizePathname(pathname);
  const searchParams = searchParamsFromPathname(pathname);
  const segments = normalized.split('/').filter(Boolean);

  if (segments.length === 0) {
    return { kind: 'tab', screen: 'Home' };
  }

  if (segments.length === 1) {
    if (segments[0] === 'bills') {
      return { kind: 'bills', params: billsFilterParams(searchParams) };
    }
    if (segments[0] === 'legislators') {
      return { kind: 'legislators', params: legislatorsFilterParams(searchParams) };
    }
    if (segments[0] === 'ask') {
      const rawSuggestion = searchParams.get('suggestion');
      const parsedSuggestion =
        rawSuggestion && /^\d+$/.test(rawSuggestion) ? Number(rawSuggestion) : undefined;
      const suggestionIndex = Number.isSafeInteger(parsedSuggestion) ? parsedSuggestion : undefined;
      return {
        kind: 'ask',
        params: {
          q: searchParams.get('q') ?? undefined,
          sort: searchParams.get('sort') ?? undefined,
          billId: searchParams.get('bill') ?? undefined,
          legislatorId: searchParams.get('legislator') ?? undefined,
          ...(suggestionIndex === undefined ? {} : { suggestionIndex }),
        },
      };
    }
    if (segments[0] === 'privacy') {
      return { kind: 'privacy' };
    }
    if (segments[0] === 'site-metrics') {
      return { kind: 'siteMetrics' };
    }
    if (segments[0] === 'terms') {
      return { kind: 'terms' };
    }
    if (segments[0] === 'about') {
      return { kind: 'aboutUs' };
    }
    if (segments[0] === 'confirm') {
      return { kind: 'confirmEmail' };
    }
    if (segments[0] === 'reset') {
      return { kind: 'resetPassword' };
    }
    // Find My Legislator resolves to its own screen: the home page's Find field
    // and the Search menu both send visitors there, so the address bar has to
    // read back what it writes (issue #764). ?address= carries what they typed,
    // making the results reload-safe and shareable (grounded-answers.md rule 5).
    if (segments[0] === 'find-my-legislator') {
      return { kind: 'findMyLegislator', address: searchParams.get('address') ?? undefined };
    }
    // '/search' is the retired old-design route — forward a stray bookmark/link to
    // the live bill list, carrying any query/filter params so a bookmarked search
    // (e.g. /search?q=education) still lands filtered (grounded-answers.md rule 5).
    if (segments[0] === 'search') {
      return { kind: 'bills', params: billsFilterParams(searchParams) };
    }
    // '/tracked' is the tracked-bills page (the account menu's Tracked Bills row
    // links here; it was the Yours dropdown's "Bills" row until #1698). Signed-out
    // visitors get a "sign in to track" card, not Home, so the link lands where it
    // says it will (grounded-answers.md rule 5).
    if (segments[0] === 'tracked') {
      return { kind: 'tab', screen: 'Tracked' };
    }
    // The campaign money landing — public, no sign-in gate (campaign money IA).
    if (segments[0] === 'money') {
      return { kind: 'moneyLanding' };
    }
    // The /read page, at the top level rather than inside the money section
    // (#1698): the bar's Read item points here, and what it holds is not
    // limited to money in the long run. '/reports' and '/reading' are the 2
    // addresses this page held before, and vercel.json forwards both
    // permanently and directly (docs/architecture/published-writing-decisions.md
    // §2.1).
    if (segments[0] === 'read' || segments[0] === 'reading' || segments[0] === 'reports') {
      return { kind: 'read' };
    }
    // '/chat' and '/account' are old-design or auth-gated surfaces with no shipped
    // page yet — redirect a stray bookmark/link to Home.
    if (segments[0] === 'chat' || segments[0] === 'account') {
      return { kind: 'tab', screen: 'Home' };
    }
  }

  if (segments.length === 2 && segments[0] === 'about' && segments[1] === 'contact') {
    return { kind: 'contactUs' };
  }

  // One piece of our own writing, at /read/research/{slug} or
  // /read/guides/{slug} (docs/architecture/published-writing-decisions.md
  // §2.1; grounded-answers.md rule 13). '/reading' is the folder these 2
  // addresses used on 27 Aug 2026 and is honoured here as well, so a link
  // shared that day still resolves on a host without vercel.json's forwards.
  //
  // The piece registry is static and synchronous, so the router resolves the
  // slug itself: an unpublished or unknown slug is a page that does not exist,
  // and lands on NotFound rather than an empty shell.
  //
  // The folder has to MATCH the piece, or a piece would answer on 2 addresses
  // and a reader could share the one we do not name as canonical. A piece
  // carrying both traits lives under 'research', because rule 13 binds it in
  // full, so `pieceAddressFolder` is the single decision and this is its guard.
  //
  // Nothing is built for /read/sets/{slug} yet, so that address falls through
  // to NotFound rather than promising a page.
  if (
    segments.length === 3 &&
    (segments[0] === 'read' || segments[0] === 'reading') &&
    (segments[1] === 'research' || segments[1] === 'guides')
  ) {
    const slug = decodeURIComponent(segments[2]);
    const piece = researchBySlug(slug);
    if (piece && pieceAddressFolder(piece) === segments[1]) {
      return segments[1] === 'guides' ? { kind: 'guide', slug } : { kind: 'research', slug };
    }
    return { kind: 'notFound', path: pathname };
  }

  // The 3 addresses this page and its pieces held before: /money/reports until
  // #1698 moved them to /reports, /reports until the morning of 27 Aug 2026 when
  // they moved to /reading, and /reading until that evening
  // (docs/architecture/published-writing-decisions.md §2.1). vercel.json
  // forwards every one of them permanently and DIRECTLY to its final /read
  // address, never through the address in between; these branches are what make
  // a stale link land anyway on any host without those forwards — the dev
  // server, a local static export, or a client-side link written before a move.
  if (segments.length === 2 && segments[0] === 'money' && segments[1] === 'reports') {
    return { kind: 'read' };
  }
  // Both old piece addresses only ever held research, so a guide does not answer
  // on them: it never had one, and honouring it would invent a second address.
  if (segments.length === 2 && segments[0] === 'reports') {
    return retiredPieceAddress(decodeURIComponent(segments[1]), pathname);
  }
  if (segments.length === 3 && segments[0] === 'money' && segments[1] === 'reports') {
    return retiredPieceAddress(decodeURIComponent(segments[2]), pathname);
  }

  // The name search's results page (campaign money phase 3, issue #1696). The
  // query is the whole of the state, so the address carries everything the page
  // shows and a results link is one somebody can send. An address with no query
  // is the page's own "type a name" state rather than a redirect, so the search
  // field on it still has somewhere to live.
  if (segments.length === 2 && segments[0] === 'money' && segments[1] === 'search') {
    return { kind: 'moneySearch', params: moneySearchParams(searchParams) };
  }

  // One committee's money page and its full-payments view (campaign money phase
  // 2). The trailing registration number is the identity and the only thing that
  // resolves — names collide, registration numbers do not — so an old or
  // misspelled name part still lands on the right page, which then forwards to
  // the current address. An address carrying no number is a page that does not
  // exist. The bare /money/committees is the register's own list (phase 3), and
  // its filter, name box and row count all ride in the query string.
  if (segments.length >= 2 && segments[0] === 'money' && segments[1] === 'committees') {
    if (segments.length === 2) {
      return { kind: 'moneyCommitteeList', params: committeeListParams(searchParams) };
    }
    const slug = decodeURIComponent(segments[2]);
    if (!registrationNumberFromSlug(slug)) {
      return { kind: 'notFound', path: pathname };
    }
    const params = {
      slug,
      tab: searchParams.get('tab') ?? undefined,
      year: searchParams.get('year') ?? undefined,
    };
    if (segments.length === 3) {
      return { kind: 'moneyCommittee', ...params };
    }
    if (segments.length === 4 && segments[3] === 'payments') {
      return { kind: 'moneyCommitteePayments', ...params };
    }
    return { kind: 'notFound', path: pathname };
  }

  // The retired greyed "Campaign Finance" tracking row pointed here before the
  // public money section shipped — forward the old address to /money.
  if (segments.length === 2 && segments[0] === 'track' && segments[1] === 'campaign-finance') {
    return { kind: 'moneyLanding' };
  }

  // Bill detail and legislator detail resolve to their redesigned profile
  // screens (docs/product-onboarding/bill-detail-guide.md and legislator-profile-guide.md). Chat sessions
  // are still old-design — redirect those to Home.
  if (segments.length === 2 && segments[0] === 'bills') {
    return {
      kind: 'bill',
      billId: decodeURIComponent(segments[1]),
      tab: searchParams.get('tab') ?? undefined,
      track: searchParams.get('track') === '1' ? true : undefined,
    };
  }

  if (segments.length === 2 && segments[0] === 'legislators') {
    return {
      kind: 'legislator',
      legislatorId: decodeURIComponent(segments[1]),
      // Both are passed through as written and validated by the screen, which is
      // how the bill page already handles an unknown `tab`. A year outside the
      // years we hold has to land on a real page saying so, not on a 404.
      tab: searchParams.get('tab') ?? undefined,
      year: searchParams.get('year') ?? undefined,
    };
  }

  if (segments.length === 3 && segments[0] === 'chat' && segments[1] === 'sessions') {
    return { kind: 'tab', screen: 'Home' };
  }

  if (segments.length === 2 && segments[0] === 'chat' && segments[1] === 'new') {
    return { kind: 'tab', screen: 'Home' };
  }

  // The standalone Vote Detail page is old-design and was cut before v0
  // ([#38](https://github.com/alethical-org/alethical/issues/38) — its Definition
  // of Done is that the feature "remains removed or hidden from the v0 shipped
  // surface"), but its URL still resolved to the old screen: no top nav, no
  // footer, no way back, ISO dates, one card per member. Every recorded roll call
  // now lives on the bill's Votes tab ([#83](https://github.com/alethical-org/alethical/issues/83)),
  // so send the old link there rather than Home — the visitor still lands on the
  // vote they asked for, in the shipped design, at a URL they can share
  // (grounded-answers.md rule 5).
  if (segments.length === 4 && segments[0] === 'bills' && segments[2] === 'votes') {
    return { kind: 'bill', billId: decodeURIComponent(segments[1]), tab: 'votes' };
  }

  return { kind: 'notFound', path: pathname };
}

type AnyNavState = WebNavigationState | undefined;

function activeRouteFromState(state: AnyNavState):
  | {
      name: keyof RootStackParamList | keyof MainTabParamList;
      params?: Record<string, unknown>;
      state?: AnyNavState;
    }
  | undefined {
  if (!state || !state.routes || state.routes.length === 0) {
    return undefined;
  }

  const index = state.index ?? 0;
  const route = state.routes[index] as {
    name: keyof RootStackParamList | keyof MainTabParamList;
    params?: Record<string, unknown>;
    state?: AnyNavState;
  };

  if (route.state) {
    return activeRouteFromState(route.state) ?? route;
  }

  return route;
}

/**
 * The URL for one route + params. Owns the whole route → path mapping so the
 * address bar (pathnameFromNavigationState) and every in-app link's `href`
 * (navigation/links.ts) are generated from the same switch and cannot drift.
 */
export function pathForRoute(activeRoute: {
  name: keyof RootStackParamList | keyof MainTabParamList;
  params?: Record<string, unknown>;
}): string {
  switch (activeRoute.name) {
    case 'Home':
      return '/';
    case 'Bills': {
      const params = new URLSearchParams();
      for (const key of BILLS_FILTER_PARAMS) {
        const value = (activeRoute.params as Record<string, unknown> | undefined)?.[key];
        if (value) {
          params.set(key, String(value));
        }
      }
      const query = params.toString();
      return query ? `/bills?${query}` : '/bills';
    }
    case 'Legislators': {
      const params = new URLSearchParams();
      for (const key of LEGISLATORS_FILTER_PARAMS) {
        const value = (activeRoute.params as Record<string, unknown> | undefined)?.[key];
        if (value) {
          params.set(key, String(value));
        }
      }
      const query = params.toString();
      return query ? `/legislators?${query}` : '/legislators';
    }
    case 'Tracked':
      return '/tracked';
    case 'Chat':
      return '/chat';
    case 'Account':
      return '/account';
    case 'Ask': {
      const params = new URLSearchParams();
      if (activeRoute.params?.q) {
        params.set('q', String(activeRoute.params.q));
      }
      if (activeRoute.params?.sort) {
        params.set('sort', String(activeRoute.params.sort));
      }
      if (activeRoute.params?.billId) {
        params.set('bill', String(activeRoute.params.billId));
      }
      if (activeRoute.params?.legislatorId) {
        params.set('legislator', String(activeRoute.params.legislatorId));
      }
      if (
        Number.isSafeInteger(activeRoute.params?.suggestionIndex) &&
        Number(activeRoute.params?.suggestionIndex) >= 0
      ) {
        params.set('suggestion', String(activeRoute.params?.suggestionIndex));
      }
      const query = params.toString();
      return query ? `/ask?${query}` : '/ask';
    }
    case 'BillDetail': {
      const path = `/bills/${encodeURIComponent(String(activeRoute.params?.billId ?? ''))}`;
      const params = new URLSearchParams();
      if (activeRoute.params?.tab) {
        params.set('tab', String(activeRoute.params.tab));
      }
      if (activeRoute.params?.track) {
        params.set('track', '1');
      }
      const query = params.toString();
      return query ? `${path}?${query}` : path;
    }
    case 'LegislatorProfile': {
      const path = `/legislators/${encodeURIComponent(String(activeRoute.params?.legislatorId ?? ''))}`;
      const params = new URLSearchParams();
      if (activeRoute.params?.tab) {
        params.set('tab', String(activeRoute.params.tab));
      }
      if (activeRoute.params?.year) {
        params.set('year', String(activeRoute.params.year));
      }
      const query = params.toString();
      return query ? `${path}?${query}` : path;
    }
    case 'FindMyLegislator': {
      const address = activeRoute.params?.address;
      return address
        ? `/find-my-legislator?address=${encodeURIComponent(String(address))}`
        : '/find-my-legislator';
    }
    case 'MoneyLanding':
      return '/money';
    case 'Read':
      return '/read';
    case 'Research':
      return `/read/research/${encodeURIComponent(String(activeRoute.params?.slug ?? ''))}`;
    case 'Guide':
      return `/read/guides/${encodeURIComponent(String(activeRoute.params?.slug ?? ''))}`;
    case 'CommitteeList': {
      const params = new URLSearchParams();
      for (const key of COMMITTEE_LIST_PARAMS) {
        const value = activeRoute.params?.[key];
        if (value) {
          params.set(key, String(value));
        }
      }
      const query = params.toString();
      return query ? `/money/committees?${query}` : '/money/committees';
    }
    case 'MoneySearch': {
      const query = activeRoute.params?.q;
      return query ? `/money/search?q=${encodeURIComponent(String(query))}` : '/money/search';
    }
    case 'CommitteeMoney':
    case 'CommitteePayments': {
      const base = `/money/committees/${encodeURIComponent(String(activeRoute.params?.slug ?? ''))}`;
      const path = activeRoute.name === 'CommitteePayments' ? `${base}/payments` : base;
      const params = new URLSearchParams();
      if (activeRoute.params?.tab) {
        params.set('tab', String(activeRoute.params.tab));
      }
      if (activeRoute.params?.year) {
        params.set('year', String(activeRoute.params.year));
      }
      const query = params.toString();
      return query ? `${path}?${query}` : path;
    }
    case 'Privacy':
      return '/privacy';
    case 'SiteMetrics':
      return '/site-metrics';
    case 'Terms':
      return '/terms';
    case 'AboutUs':
      return '/about';
    case 'ContactUs':
      return '/about/contact';
    case 'ConfirmEmail':
      return '/confirm';
    case 'ResetPassword':
      return '/reset';
    case 'NotFound': {
      const path = String(activeRoute.params?.path ?? '');
      return path.startsWith('/') ? path : '/';
    }
    case 'VoteDetail':
      return `/bills/${encodeURIComponent(String(activeRoute.params?.billId ?? ''))}/votes/${encodeURIComponent(String(activeRoute.params?.voteEventId ?? ''))}`;
    case 'ChatSession':
      if (
        !activeRoute.params?.sessionId &&
        activeRoute.params?.subjectType === 'bill' &&
        activeRoute.params?.subjectId
      ) {
        const params = new URLSearchParams();
        if (activeRoute.params.title) {
          params.set('title', String(activeRoute.params.title));
        }
        if (activeRoute.params.seedPrompt) {
          params.set('prompt', String(activeRoute.params.seedPrompt));
        }
        params.set('subjectType', String(activeRoute.params.subjectType));
        params.set('subjectId', String(activeRoute.params.subjectId));
        if (activeRoute.params.subjectLabel) {
          params.set('subjectLabel', String(activeRoute.params.subjectLabel));
        }
        return `/chat/new?${params.toString()}`;
      }
      return activeRoute.params?.sessionId
        ? `/chat/sessions/${encodeURIComponent(String(activeRoute.params.sessionId))}`
        : '/';
    default:
      return '/';
  }
}

export function pathnameFromNavigationState(state: WebNavigationState) {
  const activeRoute = activeRouteFromState(state);

  if (!activeRoute) {
    return '/';
  }

  return pathForRoute(activeRoute);
}

const tabOrder: (keyof MainTabParamList)[] = ['Home', 'Tracked', 'Chat', 'Account'];

function tabState(screen: keyof MainTabParamList): WebNavigationState {
  return {
    routes: tabOrder.map((name) => ({ name })),
    index: tabOrder.indexOf(screen),
  };
}

export function stateFromPathname(pathname: string): WebNavigationState {
  const target = targetFromPathname(pathname);
  const homeTabs = {
    name: 'Tabs',
    state: tabState('Home'),
  };

  switch (target.kind) {
    case 'tab':
      return {
        routes: [
          {
            name: 'Tabs',
            state: tabState(target.screen),
          },
        ],
        index: 0,
      };
    case 'bill':
      return {
        routes: [
          homeTabs,
          {
            name: 'BillDetail',
            params: { billId: target.billId, tab: target.tab, track: target.track },
          },
        ],
        index: 1,
      };
    case 'legislator':
      return {
        routes: [
          homeTabs,
          {
            name: 'LegislatorProfile',
            params: {
              legislatorId: target.legislatorId,
              tab: target.tab,
              year: target.year,
            },
          },
        ],
        index: 1,
      };
    case 'findMyLegislator':
      return {
        routes: [homeTabs, { name: 'FindMyLegislator', params: { address: target.address } }],
        index: 1,
      };
    case 'bills':
      return {
        routes: [homeTabs, { name: 'Bills', params: target.params }],
        index: 1,
      };
    case 'legislators':
      return {
        routes: [homeTabs, { name: 'Legislators', params: target.params }],
        index: 1,
      };
    case 'moneyLanding':
      return {
        routes: [homeTabs, { name: 'MoneyLanding' }],
        index: 1,
      };
    case 'read':
      return {
        routes: [homeTabs, { name: 'Read' }],
        index: 1,
      };
    case 'research':
      return {
        routes: [homeTabs, { name: 'Research', params: { slug: target.slug } }],
        index: 1,
      };
    case 'guide':
      return {
        routes: [homeTabs, { name: 'Guide', params: { slug: target.slug } }],
        index: 1,
      };
    case 'moneyCommittee':
      return {
        routes: [
          homeTabs,
          {
            name: 'CommitteeMoney',
            params: { slug: target.slug, tab: target.tab, year: target.year },
          },
        ],
        index: 1,
      };
    case 'moneyCommitteePayments':
      return {
        routes: [
          homeTabs,
          {
            name: 'CommitteePayments',
            params: { slug: target.slug, tab: target.tab, year: target.year },
          },
        ],
        index: 1,
      };
    case 'moneyCommitteeList':
      return {
        routes: [homeTabs, { name: 'CommitteeList', params: target.params }],
        index: 1,
      };
    case 'moneySearch':
      return {
        routes: [homeTabs, { name: 'MoneySearch', params: target.params }],
        index: 1,
      };
    case 'privacy':
      return {
        routes: [homeTabs, { name: 'Privacy' }],
        index: 1,
      };
    case 'siteMetrics':
      return {
        routes: [homeTabs, { name: 'SiteMetrics' }],
        index: 1,
      };
    case 'terms':
      return {
        routes: [homeTabs, { name: 'Terms' }],
        index: 1,
      };
    case 'aboutUs':
      return {
        routes: [homeTabs, { name: 'AboutUs' }],
        index: 1,
      };
    case 'contactUs':
      return {
        routes: [homeTabs, { name: 'ContactUs' }],
        index: 1,
      };
    case 'confirmEmail':
      return {
        routes: [{ name: 'ConfirmEmail' }],
        index: 0,
      };
    case 'resetPassword':
      return {
        routes: [{ name: 'ResetPassword' }],
        index: 0,
      };
    case 'chatSession':
      return {
        routes: [
          {
            name: 'Tabs',
            state: tabState('Chat'),
          },
          {
            name: 'ChatSession',
            params: target.params,
          },
        ],
        index: 1,
      };
    case 'ask':
      return {
        routes: [homeTabs, { name: 'Ask', params: target.params }],
        index: 1,
      };
    case 'notFound':
      return {
        routes: [homeTabs, { name: 'NotFound', params: { path: target.path } }],
        index: 1,
      };
  }
}
