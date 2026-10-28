/**
 * Every Finance address, from Design's system map (exports/Alethical Finance,
 * IA System map). The station-file pages sit under Media buys, the collection's
 * name in docs/architecture/alethical-finance-architecture.md §6. Each page
 * renders a placeholder until its drawing is final.
 */
export type RouteName =
  | 'home'
  | 'sign-in'
  | 'auth-return'
  | 'search'
  | 'organization'
  | 'recipients'
  | 'money-connections'
  | 'campaign-money'
  | 'committee'
  | 'payments-under-name'
  | 'money-by-race'
  | 'lobbying'
  | 'lobbyist'
  | 'principal'
  | 'media-buys'
  | 'station-folder'
  | 'station-file'
  | 'printed-agency-name'
  | 'station'
  | 'media-buys-review'
  | 'people'
  | 'person'
  | 'candidate'
  | 'legislator'
  | 'legislation'
  | 'bill'
  | 'roll-call';

export type NavSection = 'money' | 'lobbying' | 'people' | 'legislation' | 'media-buys';

export interface RouteDefinition {
  name: RouteName;
  pattern: string;
  title: string;
  section?: NavSection;
  /** Reachable without signing in. */
  signedOut?: boolean;
}

export const ROUTES: readonly RouteDefinition[] = [
  { name: 'home', pattern: '/', title: 'Finance home' },
  { name: 'sign-in', pattern: '/sign-in', title: 'Sign in', signedOut: true },
  { name: 'auth-return', pattern: '/auth/return', title: 'Signing in', signedOut: true },
  { name: 'search', pattern: '/search', title: 'Search results' },
  { name: 'organization', pattern: '/organizations/:id', title: 'Organization profile' },
  {
    name: 'recipients',
    pattern: '/money/recipients',
    title: 'Vendors and payees',
    section: 'money',
  },
  {
    name: 'money-connections',
    pattern: '/money/connections',
    title: 'Money connections',
    section: 'money',
  },
  { name: 'campaign-money', pattern: '/money', title: 'Campaign money', section: 'money' },
  { name: 'committee', pattern: '/money/committees/:id', title: 'Committee', section: 'money' },
  {
    name: 'payments-under-name',
    pattern: '/money/names/:query',
    title: 'Payments under this name',
    section: 'money',
  },
  { name: 'money-by-race', pattern: '/money/races/:id', title: 'Money by race', section: 'money' },
  { name: 'lobbying', pattern: '/lobbying', title: 'Lobbying', section: 'lobbying' },
  { name: 'lobbyist', pattern: '/lobbying/lobbyists/:id', title: 'Lobbyist', section: 'lobbying' },
  {
    name: 'principal',
    pattern: '/lobbying/principals/:id',
    title: 'Principal',
    section: 'lobbying',
  },
  { name: 'media-buys', pattern: '/media-buys', title: 'Media buys', section: 'media-buys' },
  {
    name: 'station-folder',
    pattern: '/media-buys/folders/:id',
    title: 'Station folder',
    section: 'media-buys',
  },
  {
    name: 'station-file',
    pattern: '/media-buys/files/:id',
    title: 'TV station file',
    section: 'media-buys',
  },
  {
    name: 'printed-agency-name',
    pattern: '/media-buys/agencies/:name',
    title: 'Printed agency name',
    section: 'media-buys',
  },
  {
    name: 'station',
    pattern: '/media-buys/stations/:id',
    title: 'TV station',
    section: 'media-buys',
  },
  {
    name: 'media-buys-review',
    pattern: '/media-buys/review',
    title: 'Check TV station files',
    section: 'media-buys',
  },
  { name: 'people', pattern: '/people', title: 'People', section: 'people' },
  { name: 'person', pattern: '/people/:id', title: 'Person profile', section: 'people' },
  { name: 'candidate', pattern: '/candidates/:id', title: 'Candidate profile', section: 'people' },
  {
    name: 'legislator',
    pattern: '/legislators/:id',
    title: 'Legislator profile',
    section: 'people',
  },
  { name: 'legislation', pattern: '/bills', title: 'Legislation', section: 'legislation' },
  { name: 'bill', pattern: '/bills/:id', title: 'Bill', section: 'legislation' },
  { name: 'roll-call', pattern: '/votes/:id', title: 'Roll call', section: 'legislation' },
];

export interface RouteMatch {
  route: RouteDefinition;
  params: Record<string, string>;
}

function matches(pattern: string, pathname: string): Record<string, string> | null {
  const expected = pattern.split('/').filter(Boolean);
  const actual = pathname.split('/').filter(Boolean);
  if (expected.length !== actual.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < expected.length; index += 1) {
    const part = expected[index];
    if (part.startsWith(':')) {
      try {
        params[part.slice(1)] = decodeURIComponent(actual[index]);
      } catch {
        return null;
      }
    } else if (part !== actual[index]) {
      return null;
    }
  }
  return params;
}

/** The route an address names, or null for an address Finance does not have. */
export function matchRoute(pathname: string): RouteMatch | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  for (const route of ROUTES) {
    const params = matches(route.pattern, path);
    if (params) return { route, params };
  }
  return null;
}

/**
 * A safe place to return to after sign-in: a Finance path on this site, never
 * another origin and never a sign-in step itself.
 */
export function safeReturnPath(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return '/';
  }
  const pathname = value.split(/[?#]/, 1)[0];
  const match = matchRoute(pathname);
  if (!match || match.route.signedOut) return '/';
  return value;
}
