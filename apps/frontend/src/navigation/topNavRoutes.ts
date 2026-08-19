import type { IaItem } from './ia';

type TopNavNavigateArgs =
  | ['Bills']
  | ['Legislators']
  | ['FindMyLegislator']
  | ['MoneyLanding']
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
