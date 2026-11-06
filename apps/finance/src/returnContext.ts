import { isBuilt, matchRoute } from './routes';

/**
 * Return context (Design build notes, "Return context"): a link carries the
 * earlier page's own address as `from`, so the next page's return link opens
 * exactly that page, with its tab, year and query, and names it. Nested returns
 * keep at most 3 earlier pages.
 */
const MAX_DEPTH = 3;

/** The earlier page's address, if it is a built signed-in Finance page. */
export function safeFrom(value: string | null | undefined): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return null;
  }
  const match = matchRoute(value.split(/[?#]/, 1)[0]);
  if (!match || match.route.signedOut || !isBuilt(match.route.name)) return null;
  return value;
}

/** Keep section anchors out of query parsing, including nested return addresses. */
function addressParts(address: string) {
  const hashAt = address.indexOf('#');
  const hash = hashAt < 0 ? '' : address.slice(hashAt);
  const withoutHash = hashAt < 0 ? address : address.slice(0, hashAt);
  const queryAt = withoutHash.indexOf('?');
  return {
    path: queryAt < 0 ? withoutHash : withoutHash.slice(0, queryAt),
    params: new URLSearchParams(queryAt < 0 ? '' : withoutHash.slice(queryAt + 1)),
    hash,
  };
}

function depth(address: string): number {
  let count = 0;
  let current: string | null = address;
  while (current && count <= MAX_DEPTH) {
    current = addressParts(current).params.get('from');
    if (current) count += 1;
  }
  return count;
}

function trimmed(address: string): string {
  if (depth(address) < MAX_DEPTH) return address;
  // Keep the nearest pages and their filters. Only the oldest return falls off
  // the bounded chain; dropping this page's `from` loses its immediate parent.
  function keepNearest(current: string, remaining: number): string {
    const { path, params, hash } = addressParts(current);
    const earlier = params.get('from');
    if (remaining === 0) params.delete('from');
    else if (earlier) params.set('from', keepNearest(earlier, remaining - 1));
    const query = params.toString();
    return `${path}${query ? `?${query}` : ''}${hash}`;
  }
  return keepNearest(address, MAX_DEPTH - 1);
}

/** `href` with the earlier page's address attached as `from`. */
export function withFrom(href: string, from: string | null): string {
  const earlier = safeFrom(from);
  if (!earlier) return href;
  const { path, params, hash } = addressParts(href);
  params.set('from', trimmed(earlier));
  return `${path}?${params.toString()}${hash}`;
}

/** Where this page's return link goes and what it says, or null for none. */
export function returnTarget(search: string): { to: string; name: string } | null {
  const earlier = safeFrom(new URLSearchParams(search).get('from'));
  if (!earlier) return null;
  const match = matchRoute(earlier.split(/[?#]/, 1)[0]);
  return match ? { to: earlier, name: match.route.returnName ?? match.route.title } : null;
}
