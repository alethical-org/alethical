/**
 * Phase-0 IA contract — single source of truth for the new top-nav information
 * architecture (✦ Ask · Search · Track · About · auth).
 *
 * The ask entry is PAGE-AWARE (O10, ratified 2026-07-12 — docs/ui-copy-guide.md
 * § Feature naming): on the signed-out home the hero IS the ask surface, so the
 * nav shows no ask entry (Search → Bills carries the "Grounded Ask" badge);
 * every non-home page restores "✦ Ask" as a top-level entry.
 *
 * The web router (navigation/webRoutes.ts) and nav chrome migrate onto this
 * registry during the frontend track; the v2 home TopNav (theme/primitives.tsx)
 * already renders its dropdowns from it, so adding a roadmap item or a new
 * surface is a one-line change here instead of edits scattered across the
 * routing switch.
 *
 * See docs/mvp-redesign-plan.md for decisions and the migration steps.
 */

export type MenuKey = 'ask' | 'search' | 'track' | 'about';

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

/** Top-level menus, in nav order. `ask` is page-aware — see the header note. */
export const MENUS: { key: MenuKey; label: string }[] = [
  { key: 'ask', label: '✦ Ask' },
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
  // ✦ Ask — top-level on non-home pages only (page-aware, see header note).
  // Anonymous one-shot cited answer; follow-ups/history gate on auth.
  {
    id: 'ask',
    label: '✦ Ask',
    path: '/ask',
    menu: 'ask',
    availability: 'mvp',
    authGated: false,
    note: 'Anonymous users get one stateless cited answer; follow-ups, history, and saved sessions require sign-in. Hidden on the signed-out home (the hero is the ask surface).',
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
    availability: 'roadmap',
    authGated: false,
    description: 'See who represents you — by address, city, or area',
    inNavDropdown: true,
  },
  {
    id: 'search-issues',
    label: 'Issues',
    path: '/search/issues',
    menu: 'search',
    availability: 'roadmap',
    authGated: false,
    description: "See an issue's bills — and who authored them",
    inNavDropdown: true,
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
    id: 'search-news',
    label: 'News & media',
    path: '/search/news',
    menu: 'search',
    availability: 'roadmap',
    authGated: false,
    note: 'Roadmap: "In the news", YouTube legislative sessions. Beyond current v1-scope boundary.',
  },

  // Track — personalized, signed-in ("your space"). Auth-gated.
  {
    id: 'track-bills',
    label: 'Bills',
    path: '/track/bills',
    menu: 'track',
    availability: 'roadmap',
    authGated: true,
    description: 'Follow a bill — save it to your watchlist',
    inNavDropdown: true,
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
    inNavDropdown: true,
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

/**
 * Old paths that must redirect to their new homes after the migration, so
 * existing links and bookmarks keep working. `match: 'prefix'` rewrites the
 * matched prefix and preserves the tail + query string — e.g. `/chat/new` and
 * `/chat/sessions/:id` map to `/ask/new` and `/ask/sessions/:id`. The default
 * is an exact-path match.
 */
export const REDIRECTS: { from: string; to: string; match?: 'exact' | 'prefix' }[] = [
  { from: '/search', to: '/bills' },
  { from: '/tracked', to: '/track/bills' },
  { from: '/chat', to: '/ask', match: 'prefix' },
];

/**
 * Signed-in account menu (replaces the "Sign in" button when authenticated).
 * Resolves open item O9.
 */
export const ACCOUNT_MENU: { id: string; label: string; path?: string; action?: 'signOut' }[] = [
  { id: 'account', label: 'Account', path: ROUTES.account },
  { id: 'tracked', label: 'Tracked', path: '/track/bills' },
  { id: 'notifications', label: 'Notification preferences', path: ROUTES.notificationPrefs },
  { id: 'sign-out', label: 'Sign out', action: 'signOut' },
];

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
