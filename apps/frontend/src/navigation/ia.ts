/**
 * Phase-0 IA contract — single source of truth for the new top-nav information
 * architecture (Ask AI · Search · Track · About · auth).
 *
 * This declares the TARGET IA. It is additive and non-breaking: nothing in the
 * live app consumes it yet. During the frontend-track migration, the web router
 * (navigation/webRoutes.ts) and the nav chrome (navigation/RootNavigator.tsx)
 * become driven by this registry, so adding a roadmap item or a new surface is a
 * one-line change here instead of edits scattered across the routing switch.
 *
 * See docs/mvp-redesign-plan.md for decisions and the migration steps.
 */

export type MenuKey = 'askAI' | 'search' | 'track' | 'about';

export type Availability = 'mvp' | 'roadmap';

export interface IaItem {
  /** Stable, unique id. */
  id: string;
  /** Sentence-case nav label. */
  label: string;
  /** Web path. Detail routes carry `:param` segments. */
  path: string;
  /** Menu this item lives under. `null` = it IS a top-level nav entry. */
  menu: MenuKey | null;
  /** Ships in MVP, or declared-but-hidden roadmap. */
  availability: Availability;
  /** Requires an authenticated user to reach. */
  authGated: boolean;
  /** Optional framing note. */
  note?: string;
}

/** Top-level menus, in nav order. */
export const MENUS: { key: MenuKey; label: string }[] = [
  { key: 'askAI', label: 'Ask AI' },
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
  // Ask AI — top-level. Anonymous one-shot cited answer; follow-ups/history gate on auth.
  {
    id: 'ask',
    label: 'Ask AI',
    path: '/ask',
    menu: 'askAI',
    availability: 'mvp',
    authGated: false,
    note: 'Anonymous users get one stateless cited answer; follow-ups, history, and saved sessions require sign-in.',
  },

  // Search — public discovery ("the library").
  { id: 'search-bills', label: 'Bills', path: '/bills', menu: 'search', availability: 'mvp', authGated: false },
  {
    id: 'search-legislators',
    label: 'Legislators',
    path: '/legislators',
    menu: 'search',
    availability: 'mvp',
    authGated: false,
    note: 'Directory + profiles, with "Find My Legislator" (address lookup) as the primary CTA.',
  },
  { id: 'search-issues', label: 'Issues', path: '/search/issues', menu: 'search', availability: 'roadmap', authGated: false },
  { id: 'search-policies', label: 'Policies', path: '/search/policies', menu: 'search', availability: 'roadmap', authGated: false },
  { id: 'search-laws', label: 'Laws', path: '/search/laws', menu: 'search', availability: 'roadmap', authGated: false },
  { id: 'search-candidates', label: 'Candidates', path: '/search/candidates', menu: 'search', availability: 'roadmap', authGated: false },
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
  { id: 'track-bills', label: 'Bills', path: '/track/bills', menu: 'track', availability: 'mvp', authGated: true },
  { id: 'track-issues', label: 'Issues', path: '/track/issues', menu: 'track', availability: 'roadmap', authGated: true },
  { id: 'track-policies', label: 'Policies', path: '/track/policies', menu: 'track', availability: 'roadmap', authGated: true },
  {
    id: 'track-legislators',
    label: 'Legislators',
    path: '/track/legislators',
    menu: 'track',
    availability: 'roadmap',
    authGated: true,
    note: 'Roadmap: follow a legislator for activity notifications.',
  },
  { id: 'track-laws', label: 'Laws', path: '/track/laws', menu: 'track', availability: 'roadmap', authGated: true },
  { id: 'track-candidates', label: 'Candidates', path: '/track/candidates', menu: 'track', availability: 'roadmap', authGated: true },

  // About — static content.
  { id: 'about-us', label: 'About us', path: '/about', menu: 'about', availability: 'mvp', authGated: false, note: 'Mission, team, story.' },
  {
    id: 'about-trust',
    label: 'Trust & integrity',
    path: '/about/trust',
    menu: 'about',
    availability: 'mvp',
    authGated: false,
    note: 'Data handling + why trust us. Brand-critical.',
  },
  { id: 'about-contact', label: 'Contact us', path: '/about/contact', menu: 'about', availability: 'mvp', authGated: false },
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

/** Whether an item is reachable for the given auth state. */
export const isReachable = (item: IaItem, isSignedIn: boolean): boolean => !item.authGated || isSignedIn;

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
