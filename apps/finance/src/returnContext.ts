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

function depth(address: string): number {
  let count = 0;
  let current: string | null = address;
  while (current && count <= MAX_DEPTH) {
    const query: string = current.includes('?') ? current.slice(current.indexOf('?') + 1) : '';
    current = new URLSearchParams(query).get('from');
    if (current) count += 1;
  }
  return count;
}

function trimmed(address: string): string {
  if (depth(address) < MAX_DEPTH) return address;
  const [path, query = ''] = address.split('?');
  const params = new URLSearchParams(query);
  params.delete('from');
  const rest = params.toString();
  return rest ? `${path}?${rest}` : path;
}

/** `href` with the earlier page's address attached as `from`. */
export function withFrom(href: string, from: string | null): string {
  const earlier = safeFrom(from);
  if (!earlier) return href;
  const [path, query = ''] = href.split('?');
  const params = new URLSearchParams(query);
  params.set('from', trimmed(earlier));
  return `${path}?${params.toString()}`;
}

/** Where this page's return link goes and what it says, or null for none. */
export function returnTarget(search: string): { to: string; name: string } | null {
  const earlier = safeFrom(new URLSearchParams(search).get('from'));
  if (!earlier) return null;
  const match = matchRoute(earlier.split(/[?#]/, 1)[0]);
  return match ? { to: earlier, name: match.route.title } : null;
}
