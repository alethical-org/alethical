/**
 * Phase-0 IA contract — single source of truth for the new top-nav information
 * architecture (Search · Reports · About · auth).
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

/**
 * A menu an item can belong to. `track` no longer draws a group in the bar
 * (#1698 moved tracking behind the account avatar), but the key stays: the
 * tracking capabilities below are still declared, and Tracked Bills is still a
 * real page. Only `MENUS` decides what the bar and the phone drawer render.
 */
export type MenuKey = 'search' | 'track' | 'reports' | 'about';

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
  /**
   * Newly launched section: the nav row carries a small green NEW chip
   * (campaign money IA, Aug 2026). Take it off once the section stops being new.
   */
  isNew?: boolean;
  /** Optional framing note. */
  note?: string;
}

/**
 * Top-level menus, in nav order — the same three in both auth states, which
 * differ only in the right-hand control (Sign in, or the avatar).
 *
 * A "Yours" group used to sit second, holding one row: Tracked Bills. #1698
 * moved that row into the account menu, where a reader's own things belong, and
 * dropped the group from the bar. Reports took second place: it holds one child
 * for now, and holds as a group because the child names a subject rather than
 * repeating the header (nav build prompt, 20 Aug 2026).
 */
export const MENUS: { key: MenuKey; label: string }[] = [
  { key: 'search', label: 'Search' },
  { key: 'reports', label: 'Reports' },
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
    description: 'Make sense of any bill, with the official text beside it',
    note: 'Carries the purple "Grounded Ask" pill in the nav dropdown.',
  },
  {
    // Second in Search, between the two subject indexes and the person pair
    // (campaign money IA §01): named for what a person wants to know, not for
    // what the tables are called. Public — the money section has no sign-in
    // gate. The description promises only the record itself, because the
    // section's search and list lanes ship after this landing does
    // (grounded-answers.md rule 2, never advertise what you can't answer).
    id: 'search-campaign-money',
    // "Money in politics" since #1698: the row sits in Search, and the label is
    // broader than "Campaign money" because the section will hold lobbying too.
    // Position, NEW pill and destination all unchanged.
    //
    // The description names the search before the search works, and that is a
    // decision rather than an oversight (Eugene, 20 Aug 2026). #1700 had removed
    // this wording under grounded-answers.md rule 2, on the grounds that /money
    // answers a promised search with "Search is not built yet." Eugene overruled
    // it: /money opens with its own under-development notice, so a reader is told
    // where they are before they try anything, and the row can say what the
    // section is for rather than what it currently holds. Same call he made for
    // the homepage promo's "Search the money records" button, so the menu and the
    // homepage now say the same thing about the same destination.
    //
    // What that notice is doing is load-bearing. If /money ever stops declaring
    // itself unfinished while its search is still a picture, this row goes back
    // to describing the record (#1696 ships the working front door).
    label: 'Money in politics',
    path: '/money',
    menu: 'search',
    availability: 'mvp',
    authGated: false,
    description: 'Search any name to find people, committees, and who got paid',
    isNew: true,
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
    description: 'Look up any legislator’s bills, committees, and campaign money',
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
    note: 'Roadmap: "In the news", YouTube legislative sessions. Beyond current product-scope boundary.',
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
  // Reports — Alethical's own published research, second in the bar. One child
  // today; the group holds because "Campaign money" names a subject the header
  // does not, and adding a "report" suffix would stutter (nav build prompt,
  // 20 Aug 2026). The NEW pill rides on the child, not the group.
  {
    id: 'reports-campaign-money',
    label: 'Campaign money',
    path: '/reports',
    menu: 'reports',
    availability: 'mvp',
    authGated: false,
    description: 'What we found across campaign filings and how we counted it',
    isNew: true,
    note: 'Opens the research shelf. A signed report is the one surface allowed to add figures up across members (.claude/rules/grounded-answers.md rule 13).',
  },

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
    label: 'About Us',
    path: '/about',
    menu: 'about',
    availability: 'mvp',
    authGated: false,
    note: 'Mission, team, story.',
  },
  {
    id: 'about-site-metrics',
    label: 'Site Metrics',
    path: '/site-metrics',
    menu: 'about',
    availability: 'mvp',
    authGated: false,
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
