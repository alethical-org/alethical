/**
 * Phase-0 IA contract — single source of truth for the new top-nav information
 * architecture (Search · Track · About · auth).
 *
 * Ask stays reachable through its answer route and in-page actions, but it is not
 * a global navigation item. Every page now shares the same Ask-free menu.
 *
 * The web router (navigation/webRoutes.ts) and nav chrome migrate onto this
 * registry during the frontend track; the v2 home TopNav (theme/primitives.tsx)
 * already renders its dropdowns from it, so adding a roadmap item or a new
 * surface is a one-line change here instead of edits scattered across the
 * routing switch.
 *
 * See docs/product-onboarding/mvp-redesign-plan.md for decisions and the migration steps.
 */

export type MenuKey = 'search' | 'track' | 'about';

export type Availability = 'mvp' | 'roadmap';

export interface IaItem {
  /** Stable, unique id. */
  id: string;
  /** Nav label, as displayed. */
  label: string;
  /** Web path. Detail routes carry `:param` segments. */
  path: string;
  /** Menu this item lives under. `null` = it IS a top-level nav entry. */
  menu: MenuKey | null;
  /** Ships in MVP, or declared-but-hidden roadmap. */
  availability: Availability;
  /** Requires an authenticated user to reach. */
  authGated: boolean;
  /** One-line dropdown row description (v2 nav design). */
  description?: string;
  /**
   * Roadmap items only: render greyed in the nav dropdown's "ON THE ROADMAP"
   * group (curated set — other roadmap items stay declared but unshown).
   */
  inNavDropdown?: boolean;
  /** Optional framing note. */
  note?: string;
}

/** Top-level menus, in nav order. */
export const MENUS: { key: MenuKey; label: string }[] = [
  { key: 'search', label: 'Search' },
  { key: 'track', label: 'Track' },
  { key: 'about', label: 'About' },
];

/**
 * The IA registry. Order within a menu is display order. Roadmap items are
 * declared here so the migration and future work stay mechanical; they are
 * hidden in MVP nav (see `visibleMenuItems`).
 */
export const IA: IaItem[] = [
  // Ask route — reached from in-page actions, not the global navigation.
  // Anonymous one-shot cited answer; follow-ups/history gate on auth.
  {
    id: 'ask',
    label: '✦ Ask',
    path: '/ask',
    menu: null,
    availability: 'mvp',
    authGated: false,
    note: 'Anonymous users get one stateless cited answer; follow-ups, history, and saved sessions require sign-in. Reached from in-page actions rather than the global navigation.',
  },

  // Search — public discovery ("the library").
  {
    id: 'search-bills',
    label: 'Bills',
    path: '/bills',
    menu: 'search',
    availability: 'mvp',
    authGated: false,
    description: 'Make sense of any bill — grounded in the source',
    note: 'Carries the purple "Grounded Ask" pill in the nav dropdown.',
  },
  {
    id: 'search-legislators',
    // "Legislators" (not "Search Legislators") in the nav dropdown — we're already
    // in the Search menu, so the "Search" prefix is redundant. The capability card
    // in the page body keeps the fuller "Search Legislators" title.
    label: 'Legislators',
    path: '/legislators',
    menu: 'search',
    availability: 'mvp',
    authGated: false,
    description: 'Look up any legislator — committees and authored bills',
  },
  {
    id: 'search-find-my-legislator',
    label: 'Find My Legislator',
    path: '/find-my-legislator',
    menu: 'search',
    availability: 'mvp',
    authGated: false,
    // "by street address" and not "by address, city, or area": districts are
    // drawn below city level and the lookup's geocoder only matches a house
    // number + street, so a city or ZIP cannot resolve to a district
    // (grounded-answers.md rule 2, never advertise what you can't answer).
    description: 'See who represents you — by street address',
  },
  {
    id: 'search-issues',
    label: 'Issues',
    path: '/search/issues',
    menu: 'search',
    availability: 'roadmap',
    authGated: false,
    description: "See an issue's bills — and who authored them",
  },
  {
    id: 'search-laws',
    label: 'Laws',
    path: '/search/laws',
    menu: 'search',
    availability: 'roadmap',
    authGated: false,
  },
  {
    id: 'search-candidates',
    label: 'Candidates',
    path: '/search/candidates',
    menu: 'search',
    availability: 'roadmap',
    authGated: false,
    description: "Know who's really running — the record behind the campaign",
    inNavDropdown: true,
  },
  {
    id: 'search-claimed-profiles',
    label: 'Claimed Profiles',
    path: '/search/claimed-profiles',
    menu: 'search',
    availability: 'roadmap',
    authGated: false,
    inNavDropdown: true,
  },
  {
    // Free-form "Ask AI" is a ROADMAP capability, not the shipped grounded Ask
    // (/ask, mvp above): open-ended AI questions aren't built yet, so this rides
    // in the greyed "ON THE ROADMAP" group as an inert pill. "Ask AI" is a
    // deliberate, Eugene-directed exception to the ui-copy-guide "never Ask AI"
    // ban (2026-08-04) — the ban governs shipped/live copy; this is a
    // non-committal roadmap chip. See docs/design/ui-copy-guide.md § Feature naming.
    id: 'search-ask-ai',
    label: 'Ask AI',
    path: '/search/ask-ai',
    menu: 'search',
    availability: 'roadmap',
    authGated: false,
    inNavDropdown: true,
  },
  // Track — personalized, signed-in ("your space"). Auth-gated.
  {
    id: 'track-bills',
    label: 'Bills',
    path: '/track/bills',
    menu: 'track',
    // Live, not roadmap: bill tracking ships, so Bills renders as an active row at
    // the top of the Track dropdown (same icon-tile + description + link pattern as
    // the Search rows), above the "ON THE ROADMAP" group. Still auth-gated — the row
    // links to the Tracked page, which prompts a signed-out visitor to sign in.
    availability: 'mvp',
    authGated: true,
    description: 'Follow a bill — save it to your watchlist',
  },
  {
    id: 'track-legislators',
    label: 'Legislators',
    path: '/track/legislators',
    menu: 'track',
    availability: 'roadmap',
    authGated: true,
    description: 'Follow a legislator — every bill they author, every vote they cast',
    inNavDropdown: true,
    note: 'Roadmap: follow a legislator for activity notifications (#151).',
  },
  {
    id: 'track-issues',
    label: 'Issues',
    path: '/track/issues',
    menu: 'track',
    availability: 'roadmap',
    authGated: true,
    description: 'Follow an issue — and every bill as it advances',
  },
  {
    id: 'track-laws',
    label: 'Laws',
    path: '/track/laws',
    menu: 'track',
    availability: 'roadmap',
    authGated: true,
  },
  {
    id: 'track-candidates',
    label: 'Candidates',
    path: '/track/candidates',
    menu: 'track',
    availability: 'roadmap',
    authGated: true,
    description: "Follow who's running — the record behind the campaign, through election day",
    inNavDropdown: true,
  },
  {
    id: 'track-campaign-finance',
    label: 'Campaign Finance',
    path: '/track/campaign-finance',
    menu: 'track',
    availability: 'roadmap',
    authGated: true,
    description: 'Follow the filings — who gave, who received, how much, and when',
    inNavDropdown: true,
  },
  {
    id: 'track-news',
    label: 'News',
    path: '/track/news',
    menu: 'track',
    availability: 'roadmap',
    authGated: true,
    inNavDropdown: true,
    note: 'Roadmap: "In the news", YouTube legislative sessions. Beyond current product-scope boundary.',
  },

  // About — static content.
  {
    id: 'about-us',
    label: 'About Us',
    path: '/about',
    menu: 'about',
    availability: 'mvp',
    authGated: false,
    note: 'Mission, team, story.',
  },
  {
    id: 'about-contact',
    label: 'Contact Us',
    path: '/about/contact',
    menu: 'about',
    availability: 'mvp',
    authGated: false,
  },
];

/**
 * Non-menu routes that still need registry-backed paths: detail pages, auth,
 * account surfaces, and footer/legal. Not shown in top-nav dropdowns.
 */
export const ROUTES = {
  home: '/',
  billDetail: '/bills/:billId',
  voteDetail: '/bills/:billId/votes/:voteEventId',
  legislatorProfile: '/legislators/:legislatorId',
  findMyLegislator: '/find-my-legislator',
  askNew: '/ask/new',
  askSession: '/ask/sessions/:sessionId',
  signIn: '/sign-in',
  account: '/account',
  notificationPrefs: '/account/notifications',
  privacy: '/privacy',
  terms: '/terms',
} as const;

// An `ACCOUNT_MENU` constant used to sit here, listing Account / Tracked /
// Notification preferences / Sign out. Nothing ever read it, and the menu that
// shipped with #1006 is header + Sign out only — the Account page it named is
// pre-redesign and its URL redirects Home, so a row would point at a broken
// surface. Removed rather than left describing a menu we deliberately did not
// build; the shipped one lives in components/auth/AccountControl.tsx.

// --- Selectors: keep every router/nav derivation in one place ---

export const itemsByMenu = (menu: MenuKey): IaItem[] => IA.filter((item) => item.menu === menu);

export const mvpItems = (): IaItem[] => IA.filter((item) => item.availability === 'mvp');

export const roadmapItems = (): IaItem[] => IA.filter((item) => item.availability === 'roadmap');

/** Items to render in a menu right now, honoring the hide-roadmap default (O5). */
export const visibleMenuItems = (menu: MenuKey, opts?: { showRoadmap?: boolean }): IaItem[] =>
  itemsByMenu(menu).filter((item) => (opts?.showRoadmap ? true : item.availability === 'mvp'));

/**
 * What a v2 nav dropdown renders: live (mvp) rows on top, then the curated
 * greyed "ON THE ROADMAP" group (roadmap items opted in via `inNavDropdown`).
 */
export const navDropdownItems = (menu: MenuKey): { live: IaItem[]; roadmap: IaItem[] } => ({
  live: itemsByMenu(menu).filter((item) => item.availability === 'mvp'),
  roadmap: itemsByMenu(menu).filter(
    (item) => item.availability === 'roadmap' && item.inNavDropdown === true,
  ),
});

/** The phone drawer combines both menus into one compact roadmap row. */
export function mobileNavRoadmapLabels(): string[] {
  const searchRoadmap = navDropdownItems('search').roadmap;
  const trackRoadmap = navDropdownItems('track').roadmap;
  const askAi = searchRoadmap.find((item) => item.id === 'search-ask-ai');
  const namedSearchRoadmap = searchRoadmap.filter((item) => item.id !== 'search-ask-ai');
  const namedRoadmapLabels = new Set(namedSearchRoadmap.map((item) => item.label));
  const namedTrackRoadmap = trackRoadmap.filter((item) =>
    ['track-campaign-finance', 'track-news'].includes(item.id),
  );
  for (const item of namedTrackRoadmap) namedRoadmapLabels.add(item.label);
  const hasMoreTracking = trackRoadmap.some((item) => !namedRoadmapLabels.has(item.label));

  return [
    ...namedSearchRoadmap.map((item) => item.label),
    ...namedTrackRoadmap.map((item) => item.label),
    ...(hasMoreTracking ? ['More Tracking'] : []),
    ...(askAi ? [askAi.label] : []),
  ];
}

/** Whether an item is reachable for the given auth state. */
export const isReachable = (item: IaItem, isSignedIn: boolean): boolean =>
  !item.authGated || isSignedIn;

/**
 * Integrity check for the registry — unique ids and unique paths. Pure; wire it
 * into a dev assertion or a test once the frontend has a runner. Returns the
 * list of problems (empty array = valid).
 */
export function validateIa(): string[] {
  const problems: string[] = [];
  const seenIds = new Set<string>();
  const seenPaths = new Set<string>();
  for (const item of IA) {
    if (seenIds.has(item.id)) {
      problems.push(`duplicate id: ${item.id}`);
    }
    if (seenPaths.has(item.path)) {
      problems.push(`duplicate path: ${item.path}`);
    }
    seenIds.add(item.id);
    seenPaths.add(item.path);
  }
  return problems;
}
