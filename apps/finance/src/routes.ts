/**
 * Every Finance address, from Design's system map (IA System map) and route
 * decision D20: the landing page at / for everyone, Finance Home at /home. The
 * station-file pages sit under Media buys, the collection's name in
 * docs/architecture/alethical-finance-architecture.md §6.
 *
 * A route whose screen is not built yet answers "not found" (BUILT below), and
 * nothing links to it, so an unfinished page is never reachable.
 */
export type RouteName =
  | 'landing'
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
  | 'identities'
  | 'employers'
  | 'employer'
  | 'committee-members'
  | 'lobbying'
  | 'lobbyist'
  | 'principal'
  | 'media-buys'
  | 'station-folder'
  | 'station-file'
  | 'printed-agency-name'
  | 'station'
  | 'check-station-files'
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
  { name: 'landing', pattern: '/', title: 'Alethical Finance', signedOut: true },
  { name: 'home', pattern: '/home', title: 'Finance Home' },
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
  { name: 'money-connections', pattern: '/money/connections', title: 'Money connections' },
  {
    name: 'identities',
    pattern: '/money/identities',
    title: 'Confirm identities',
    section: 'money',
  },
  {
    name: 'employers',
    pattern: '/money/employers',
    title: 'Donors by employer',
    section: 'money',
  },
  {
    name: 'employer',
    pattern: '/money/employers/:name',
    title: 'Donors by employer',
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
  {
    name: 'committee-members',
    pattern: '/legislature/committees/:id/members',
    title: 'Committee members’ campaign accounts',
    section: 'people',
  },
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
    pattern: '/media-buys/files/:key',
    title: 'Station file',
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
    name: 'check-station-files',
    pattern: '/media-buys/check',
    title: 'Check station files',
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

/** The signed-in screens that are built. Every other route answers not found
 * and is never linked to. */
export const BUILT: ReadonlySet<RouteName> = new Set<RouteName>([
  'landing',
  'home',
  'sign-in',
  'auth-return',
  'search',
  'people',
  'person',
  'recipients',
  'candidate',
  'legislator',
  'campaign-money',
  'committee',
  'committee-members',
  'legislation',
  'bill',
  'roll-call',
  'media-buys',
  'station-file',
  'station-folder',
  'station',
  'printed-agency-name',
  'payments-under-name',
  'money-by-race',
  'lobbying',
  'lobbyist',
  'principal',
  'organization',
  'employers',
  'employer',
]);

export function isBuilt(name: RouteName): boolean {
  return BUILT.has(name);
}

/** Where a listed account lands after signing in: Finance Home, or the landing
 * page while the signed-in screens are off. */
export function homePath(screens: boolean): string {
  return screens ? '/home' : '/';
}

/**
 * A Finance address built from its route's own pattern, so no link is written by
 * hand (the build's link check, scripts/check-built-links.mjs, tells a hand-written
 * `/bills/${id}` apart from a link to the public site). Each parameter is encoded.
 */
export function hrefFor(
  name: RouteName,
  params: Record<string, string> = {},
  query: Record<string, string | null | undefined> = {},
): string {
  const route = ROUTES.find((item) => item.name === name);
  if (!route) throw new Error(`No Finance route named ${name}`);
  const path = route.pattern.replace(/:([a-z]+)/gi, (_, key: string) => {
    const value = params[key];
    if (value === undefined) throw new Error(`${name} needs ${key}`);
    return encodeURIComponent(value);
  });
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== null && value !== undefined && value !== '') search.set(key, value);
  }
  const rest = search.toString();
  return rest ? `${path}?${rest}` : path;
}

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
 * A safe place to return to after sign-in: a built signed-in Finance page on
 * this site, never another origin and never a sign-in step. Anything else, and
 * every address while the signed-in screens are off, returns home.
 */
export function safeReturnPath(value: string | null | undefined, screens: boolean): string {
  const home = homePath(screens);
  if (!screens || !value || !value.startsWith('/') || value.startsWith('//')) return home;
  if (value.includes('\\')) return home;
  const pathname = value.split(/[?#]/, 1)[0];
  const match = matchRoute(pathname);
  if (!match || match.route.signedOut || !isBuilt(match.route.name)) return home;
  return value;
}
