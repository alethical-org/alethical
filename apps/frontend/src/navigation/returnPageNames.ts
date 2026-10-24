import { useEffect } from 'react';
import type { AppReturnDestination } from './webHistory';
import { eventIndexBySlug } from '../lib/eventsIndex';
import { pieceIndexBySlug, TOPICS } from '../lib/researchIndex';
import {
  installReturnCapture,
  readReturnAccess,
  notifyReturnContext,
  returnAccessVersion,
  sanitizePublicReturnPath,
} from './returnCaptureBridge';
export { setReturnAccess, returnAccessVersion } from './returnCaptureBridge';
import { targetFromPathname, stateFromPathname, pathnameFromNavigationState } from './webRoutes';
import { registrationNumberFromSlug } from '../lib/committeeRoute';

export const staticNames: Record<string, string> = {
  '/': 'Home',
  '/ask': 'Ask',
  '/bills': 'Search bills',
  '/legislators': 'Search legislators',
  '/candidates': 'Find my candidates',
  '/candidates/features': 'Candidate profile features',
  '/find-my-legislator': 'Find my legislator',
  '/money': 'Money in politics',
  '/money/committees': 'Committees',
  '/money/races': 'Money by race',
  '/money/search': 'money search',
  '/money/outside-spending': 'Outside spending',
  '/money/lobbying': 'Lobbying',
  '/money/lobbying/lobbyists': 'Lobbyists',
  '/money/lobbying/principals': 'Principals',
  '/blog': 'Blog',
  '/blog/research': 'Research reports',
  '/blog/guides': 'Guides',
  '/blog/short-posts': 'Short posts',
  '/blog/events': 'Events',
  '/blog/sets/how-the-money-works': 'How the Money Works',
  '/about': 'About us',
  '/about/contact': 'Contact us',
  '/services': 'Services',
  '/privacy': 'Privacy',
  '/terms': 'Terms',
};

export function initialReturnPageName(pathname: string): string | null {
  if (staticNames[pathname]) return staticNames[pathname];
  const topic = TOPICS.find((entry) => `/blog/topics/${entry.slug}` === pathname);
  if (topic) return topic.label;
  const event = /^\/blog\/events\/([^/]+)$/.exec(pathname);
  if (event) return eventIndexBySlug(event[1])?.title ?? null;
  const article = /^\/blog\/(research|guides)\/([^/]+)$/.exec(pathname);
  return article ? (pieceIndexBySlug(article[2])?.title ?? null) : null;
}

const publicNames = new Map<string, string>();
const LIMIT = 200;
const invalidNames = new Set<string>();
const aliases = new Map<string, Set<string>>();
const accountReturns = new Map<string, AppReturnDestination>();
const accountNames = new Map<string, string>();
/** Protected context stays only in memory and only while this account has access. */
export function safeAccountReturnPath(path: string): string | null {
  const access = readReturnAccess();
  if (
    !access.ready ||
    typeof path !== 'string' ||
    !path.startsWith('/') ||
    path.startsWith('//') ||
    /[\\\u0000-\u001f]/.test(path)
  )
    return null;
  const url = new URL(path, 'https://alethical.invalid');
  if (url.origin !== 'https://alethical.invalid' || url.hash) return null;
  if (
    [...url.searchParams.keys()].some(
      (key) => !['candidate', 'claim', 'from', 'page'].includes(key),
    ) ||
    (url.searchParams.has('from') && url.searchParams.get('from') !== 'profile')
  )
    return null;
  const source = `${url.pathname}${url.search}`;
  if (targetFromPathname(source).kind === 'notFound') return null;
  // Only the route owner decides which public identifiers and aliases survive.
  // Ignored query values must not enter private memory or a copied return link.
  const href = pathnameFromNavigationState(stateFromPathname(source));
  const pathname = new URL(href, 'https://alethical.invalid').pathname;
  const isAdminPath = [
    '/admin',
    '/admin/users',
    '/admin/operations',
    '/admin/candidate-claims',
    '/admin/metrics',
    '/admin/site-metrics',
  ].includes(pathname);
  const candidateAccount = /^\/candidates\/[^/]+\/(claim|manage)$/.test(pathname);
  if (
    !candidateAccount &&
    !isAdminPath &&
    !['/email-preferences', '/comment-emails', '/tracked'].includes(pathname)
  )
    return null;
  if (isAdminPath && (!access.accountId || !access.admin)) return null;
  if (!access.accountId && !/^\/candidates\/[^/]+\/claim$/.test(pathname)) return null;
  return href;
}

/** Return context is public navigation only, never sign-in, admin or editor state. */
export function safeReturnPath(path: string): string | null {
  return sanitizePublicReturnPath(path);
}

export function validReturnName(name: string): boolean {
  if (typeof name !== 'string') return false;
  return (
    Boolean(name.trim()) &&
    name.length <= 500 &&
    !/^(go back|back|back to|previous)$/i.test(name.trim()) &&
    !/[\u0000-\u001f]/.test(name)
  );
}

/** Names come from served public records or established page names, never slugs. */
export function returnPageName(path: string): string | null {
  const publicPath = safeReturnPath(path);
  const safe = publicPath ?? safeAccountReturnPath(path);
  if (!safe) return null;
  const pathname = new URL(safe, 'https://alethical.invalid').pathname;
  const subject = returnNameKey(safe);
  if (invalidNames.has(subject)) return null;
  if (!publicPath)
    return (
      accountNames.get(subject) ??
      (
        {
          '/tracked': 'Tracked',
          '/email-preferences': 'Email preferences',
          '/comment-emails': 'Comment emails',
        } as Record<string, string>
      )[pathname] ??
      null
    );
  if (subject === pathname) {
    const name = initialReturnPageName(pathname);
    if (name) return name;
  }
  return publicNames.get(subject) ?? null;
}

function returnNameKey(path: string) {
  const url = new URL(path, 'https://alethical.invalid');
  if (url.pathname === '/admin/candidate-claims')
    return `${url.pathname}?claim=${encodeURIComponent(url.searchParams.get('claim') ?? '')}&candidate=${encodeURIComponent(url.searchParams.get('candidate') ?? '')}`;
  if (url.pathname === '/money/outside-spending') {
    for (const key of ['spender', 'about']) {
      const value = url.searchParams.get(key);
      if (value) return `${url.pathname}?${key}=${encodeURIComponent(value)}`;
    }
  }
  if (url.pathname === '/money/races' && url.searchParams.get('group'))
    return `${url.pathname}?group=${encodeURIComponent(url.searchParams.get('group')!)}`;
  const registered =
    /^\/money\/(committees|lobbying\/lobbyists|lobbying\/principals)\/([^/]+)(\/payments)?$/.exec(
      url.pathname,
    );
  if (registered) {
    const number = registrationNumberFromSlug(registered[2]);
    if (number) {
      const key = `/money/${registered[1]}/${number}${registered[3] ?? ''}`;
      return registered[3]
        ? `${key}?tab=${url.searchParams.get('tab') === 'spent' ? 'spent' : 'gave'}`
        : key;
    }
  }
  if (url.pathname === '/money/payments')
    return `${url.pathname}?name=${encodeURIComponent(url.searchParams.get('name') ?? '')}&role=${encodeURIComponent(url.searchParams.get('role') ?? '')}`;
  return url.pathname;
}

export function rememberReturnPageName(path: string, name: string) {
  const publicPath = safeReturnPath(path);
  const safe = publicPath ?? safeAccountReturnPath(path);
  if (!safe || !validReturnName(name)) return;
  const key = returnNameKey(safe);
  const restored = invalidNames.delete(key);
  const names = publicPath ? publicNames : accountNames;
  const changed = names.get(key) !== name.trim();
  names.delete(key);
  names.set(key, name.trim());
  if (restored || changed) notifyReturnContext();
  if (!publicPath) return;
  if (publicNames.size > LIMIT) publicNames.delete(publicNames.keys().next().value!);
}

export function useReturnPageName(
  pathname: string | null | undefined,
  name: string | null | undefined,
) {
  useEffect(() => {
    if (pathname && name) rememberReturnPageName(pathname, name);
  }, [pathname, name]);
}

export function forgetReturnPageName(path: string) {
  const safe = safeReturnPath(path) ?? safeAccountReturnPath(path);
  if (!safe) return;
  const key = returnNameKey(safe);
  let changed = false;
  for (const related of aliases.get(key) ?? [key]) {
    if (publicNames.delete(related)) changed = true;
    if (accountNames.delete(related)) changed = true;
    if (!invalidNames.has(related)) changed = true;
    invalidNames.add(related);
  }
  if (invalidNames.size > LIMIT) invalidNames.delete(invalidNames.values().next().value!);
  if (changed) notifyReturnContext();
}
export function returnPageWasInvalidated(path: string) {
  return invalidNames.has(returnNameKey(path));
}

/** Aliases are connected only by a caller holding the same served record, not by equal names. */
export function rememberReturnPageAlias(requested: string, served: string) {
  if (!safeReturnPath(requested) || !safeReturnPath(served)) return;
  const a = returnNameKey(requested),
    b = returnNameKey(served);
  const group = new Set([a, b, ...(aliases.get(a) ?? []), ...(aliases.get(b) ?? [])]);
  for (const key of group) aliases.set(key, group);
  while (aliases.size > LIMIT) aliases.delete(aliases.keys().next().value!);
}

installReturnCapture(
  (path) => {
    const publicHref = safeReturnPath(path);
    const href = publicHref ?? safeAccountReturnPath(path);
    const name = href ? returnPageName(href) : null;
    return href && name ? { href, name, public: Boolean(publicHref) } : null;
  },
  () => {
    accountNames.clear();
    accountReturns.clear();
  },
  {
    get: (id) => {
      const value = accountReturns.get(id);
      return value?.accessVersion === returnAccessVersion() ? value : undefined;
    },
    set: (id, value) => {
      accountReturns.set(id, value);
      if (accountReturns.size > LIMIT) accountReturns.delete(accountReturns.keys().next().value!);
    },
  },
);
