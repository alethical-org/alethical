/**
 * Phase-0 IA contract — single source of truth for the new top-nav information
 * architecture (Money · Search · Blog · About · auth).
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
 * The reader-facing description is docs/product-onboarding/site-navigation-guide.md.
 */

/**
 * A menu an item can belong to. `track` no longer draws a group in the bar
 * (#1698 moved tracking behind the account avatar), but the key stays: the
 * tracking capabilities below are still declared, and Tracked Bills is still a
 * real page. Only `MENUS` decides what the bar and the phone drawer render.
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
  /**
   * Dropdown this item lives under. `null` means it lives under none: either it
   * is a bar item in its own right (Blog, via `NAV_BAR` below) or it is reached
   * from in-page actions rather than the bar at all (Ask).
   */
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
  /**
   * Newly launched section: the nav row carries a small green NEW chip
   * (campaign money IA, Aug 2026). Take it off once the section stops being new.
   */
  isNew?: boolean;
}

/** Money is a direct public destination before Search in both website layouts. */
const MONEY_ITEM: IaItem = {
  // Keep the existing id so routing and saved menu references stay compatible.
  id: 'search-campaign-money',
  label: 'Money',
  path: '/money',
  menu: null,
  availability: 'mvp',
  authGated: false,
};

/**
 * Blog — everything Alethical publishes in its own name, at `/blog`.
 *
 * It is a bar item with no dropdown, so it appears in `NAV_BAR` below as well as
 * in the registry. This was a `reading` menu holding a single row labelled
 * "Campaign money" until 27 Aug 2026: the bar showed a dropdown with one item in
 * it and the phone drawer showed a heading over one row. Everything we publish
 * sits on the one `/blog` page, so the bar has nothing to disclose and the
 * drawer gains no nested layer (Design's nav drawing, 27 Aug 2026;
 * docs/architecture/published-writing-decisions.md §2.1).
 *
 * Money and Blog no longer carry NEW labels in either navigation layout.
 */
const READ_ITEM: IaItem = {
  id: 'read',
  label: 'Blog',
  path: '/blog',
  menu: null,
  availability: 'mvp',
  authGated: false,
  // Own research may add figures across members (.claude/rules/grounded-answers.md rule 13).
};

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
    // Anonymous Ask is one stateless cited answer; follow-ups and history require sign-in.
  },

  // Search — public discovery ("the library").
  {
    id: 'search-bills',
    label: 'Bills and votes',
    path: '/bills',
    menu: 'search',
    availability: 'mvp',
    authGated: false,
    description: 'Read bill summaries, check their status, and see how legislators voted',
    // Carries the purple "Grounded Ask" pill in the nav dropdown.
  },
  MONEY_ITEM,
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
    description: 'Look up any legislator’s bills, committees, and campaign money',
  },
  {
    id: 'search-candidates',
    label: 'Find my candidates',
    path: '/candidates',
    menu: 'search',
    availability: 'mvp',
    authGated: false,
    description: 'See who is running for office in your area',
    isNew: true,
  },
  {
    id: 'search-find-my-legislator',
    label: 'Find my legislators',
    path: '/find-my-legislator',
    menu: 'search',
    availability: 'mvp',
    authGated: false,
    // "by street address" and not "by address, city, or area": districts are
    // drawn below city level and the lookup's geocoder only matches a house
    // number + street, so a city or ZIP cannot resolve to a district
    // (grounded-answers.md rule 2, never advertise what you can't answer).
    description: 'Enter your street address to see who represents you',
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
    id: 'search-claimed-profiles',
    label: 'Claimed profiles',
    path: '/search/claimed-profiles',
    menu: 'search',
    availability: 'roadmap',
    authGated: false,
    inNavDropdown: true,
  },
  {
    // In Search's greyed group, not Yours' (campaign money IA, Aug 2026): news
    // about the legislature is something a reader looks up before it is
    // something they follow. Before Ask AI, which stays last in the pill row.
    id: 'search-news',
    label: 'News',
    path: '/search/news',
    menu: 'search',
    availability: 'roadmap',
    authGated: false,
    inNavDropdown: true,
    // "In the news" and YouTube sessions remain beyond current product scope.
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
  // Read — Alethical's own published writing, second in the bar. Declared here
  // as `READ_ITEM` above so `NAV_BAR` can point a bar entry straight at it.
  READ_ITEM,

  // Track — personalized, signed-in ("your space"). Auth-gated. No longer a
  // group in the bar: Tracked Bills moved into the account menu (#1698), and
  // these rows stay declared so the tracking roadmap is still recorded here.
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
    // Follow a legislator for activity notifications (#151) remains on the roadmap.
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
    // Greyed "Candidates" moved out of the Yours dropdown (campaign money IA,
    // Aug 2026): searching candidates is a Search capability, and Search's greyed
    // group already shows it via search-candidates above. Declared here so the
    // tracking capability stays on the roadmap, just not as a second grey pill.
    id: 'track-candidates',
    label: 'Candidates',
    path: '/track/candidates',
    menu: 'track',
    availability: 'roadmap',
    authGated: true,
    description: "Follow who's running — the record behind the campaign, through election day",
  },
  // A greyed "Campaign Finance" tracking row used to sit here
  // (/track/campaign-finance). The capability shipped as the public Campaign
  // money section (search-campaign-money above), and the old address forwards
  // to /money in navigation/webRoutes.ts. The greyed "News" row moved with it
  // into Search's group (search-news above).

  // About — static content.
  {
    id: 'about-us',
    label: 'About us',
    path: '/about',
    menu: 'about',
    availability: 'mvp',
    authGated: false,
    // Mission, team, story.
  },
  {
    id: 'about-services',
    label: 'Campaign services',
    path: '/services',
    menu: 'about',
    availability: 'mvp',
    authGated: false,
  },
  {
    id: 'about-contact',
    label: 'Contact us',
    path: '/about/contact',
    menu: 'about',
    availability: 'mvp',
    authGated: false,
  },
];

/**
 * The same 4 top-level entries appear in both auth states and website layouts.
 * A menu entry opens a panel. Money and Blog link directly to their destinations.
 */
export type NavBarEntry =
  { kind: 'menu'; key: MenuKey; label: string } | { kind: 'link'; item: IaItem };

export const NAV_BAR: NavBarEntry[] = [
  { kind: 'link', item: MONEY_ITEM },
  { kind: 'menu', key: 'search', label: 'Search' },
  { kind: 'link', item: READ_ITEM },
  { kind: 'menu', key: 'about', label: 'About' },
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

/**
 * The phone drawer's one compact roadmap row: Search's greyed items, with Ask AI
 * held last.
 *
 * A calculated "More Tracking" chip used to sit before Ask AI, standing in for
 * whatever the Yours menu still had on its roadmap. #1698 dropped it: the Yours
 * group is gone from the bar, so the chip pointed at a menu a reader could no
 * longer open, and the account menu's Tracked Bills row already names the one
 * thing that is live.
 */
export function mobileNavRoadmapLabels(): string[] {
  const searchRoadmap = navDropdownItems('search').roadmap;
  const askAi = searchRoadmap.find((item) => item.id === 'search-ask-ai');
  const namedSearchRoadmap = searchRoadmap.filter((item) => item.id !== 'search-ask-ai');

  return [...namedSearchRoadmap.map((item) => item.label), ...(askAi ? [askAi.label] : [])];
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
