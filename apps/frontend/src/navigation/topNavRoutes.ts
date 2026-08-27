import type { IaItem } from './ia';
import { routePath } from './links';

type TopNavNavigateArgs =
  | ['Bills']
  | ['Legislators']
  | ['FindMyLegislator']
  | ['MoneyLanding']
  | ['Read']
  | ['AboutUs']
  | ['SiteMetrics']
  | ['ContactUs']
  | ['Tabs', { screen: 'Tracked' }];

export type TopNavNavigation = {
  navigate: (...args: TopNavNavigateArgs) => unknown;
  getParent?: () => TopNavNavigation | undefined;
};

function rootNavigation(navigation: TopNavNavigation): TopNavNavigation {
  let root = navigation;
  let parent = root.getParent?.();
  while (parent) {
    root = parent;
    parent = root.getParent?.();
  }
  return root;
}

/**
 * Send every live dropdown row through one shared route map.
 *
 * Tracked is a tab nested inside the root Tabs screen, so asking a root-stack
 * page to navigate straight to `Tracked` does nothing. Keeping the complete
 * route here prevents individual page headers from making that mistake again.
 */
export function navigateTopNavItem(
  navigation: TopNavNavigation,
  item: Pick<IaItem, 'id'>,
): boolean {
  switch (item.id) {
    case 'search-bills':
      navigation.navigate('Bills');
      return true;
    case 'search-legislators':
      navigation.navigate('Legislators');
      return true;
    case 'search-campaign-money':
      navigation.navigate('MoneyLanding');
      return true;
    case 'read':
      navigation.navigate('Read');
      return true;
    case 'search-find-my-legislator':
      navigation.navigate('FindMyLegislator');
      return true;
    case 'about-us':
      navigation.navigate('AboutUs');
      return true;
    case 'about-site-metrics':
      navigation.navigate('SiteMetrics');
      return true;
    case 'about-contact':
      navigation.navigate('ContactUs');
      return true;
    case 'track-bills': {
      const root = rootNavigation(navigation);
      root.navigate('Tabs', { screen: 'Tracked' });
      return true;
    }
    default:
      return false;
  }
}

/**
 * The URL behind each interactive nav row, so the row is a real `<a href>` the
 * browser can open in a new tab (navigation/links.ts). Keyed to the same ids the
 * switch above handles, so a row's link and its click land in the same place.
 */
export const NAV_ITEM_HREFS: Record<string, string> = {
  ask: routePath.ask(),
  'search-bills': routePath.bills(),
  'search-legislators': routePath.legislators(),
  // Restored now that /find-my-legislator reads back as its own screen instead
  // of redirecting to Home, so this row's link lands where its click lands
  // (issue #764).
  'search-find-my-legislator': routePath.findMyLegislator(),
  'search-campaign-money': routePath.money(),
  read: routePath.read(),
  // Live now that Bills is an active Track row: the link lands on the Tracked page,
  // which prompts a signed-out visitor to sign in rather than advertising a
  // capability it can't deliver (grounded-answers rule 2).
  'track-bills': routePath.tracked(),
  'about-us': routePath.aboutUs(),
  'about-site-metrics': routePath.siteMetrics(),
  'about-contact': routePath.contactUs(),
};

/** One address, comparable: no query, no fragment, no trailing slash. */
function normalizeNavPath(path: string) {
  const trimmed = path.split(/[?#]/)[0].replace(/\/+$/, '');
  return trimmed.length > 0 ? trimmed : '/';
}

/**
 * Which nav row, if any, points at the page the reader is on. The bar and the
 * phone drawer mark that row `aria-current="page"`, the way the bill header, the
 * section rail, the profile tabs and the search dropdowns already mark their own
 * current thing.
 *
 * Two properties this deliberately has:
 *
 * - **Exact match only.** `aria-current="page"` claims "this link is the page
 *   you are on", nothing weaker. So `/read` marks Read and
 *   `/read/guides/{name}` marks nothing. A filtered list is still its own page,
 *   which is why the query string is dropped before comparing.
 * - **It returns a row id, never a menu key.** So a dropdown trigger can never
 *   take the mark: a trigger opens a panel and is not a page. On `/money` the
 *   Money in politics row inside Search is marked and the Search trigger is not.
 */
export function currentNavItemId(pathname: string): string | null {
  const here = normalizeNavPath(pathname);
  const match = Object.entries(NAV_ITEM_HREFS).find(([, href]) => normalizeNavPath(href) === here);
  return match ? match[0] : null;
}
