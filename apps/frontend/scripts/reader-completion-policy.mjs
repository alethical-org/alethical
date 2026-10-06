import { safeAuthCallbackReport } from './safe-auth-callback-report.mjs';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
const METRIC_HOSTS = new Set([
  'va.vercel-scripts.com',
  'vitals.vercel-insights.com',
  'static.cloudflareinsights.com',
  'cloudflareinsights.com',
]);
const PUBLIC_API =
  /^\/api\/v1\/(?:bills|legislators|sessions|meta|policy-areas|campaign-finance|lobbying)(?:\/|$)/;
const ASSET_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com', 'www.lrl.mn.gov']);

export function readerBaseUrl(value) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Reader checks require a bare approved origin');
  }
  if (!(
    url.origin === 'https://www.alethical.com' ||
    (LOOPBACK.has(url.hostname) && url.protocol === 'http:')
  )) {
    throw new Error('Reader checks require official production or HTTP loopback');
  }
  return url.origin;
}

export function commitSha(value) {
  if (!/^[0-9a-f]{40}$/.test(value ?? '')) throw new Error('Expected a full commit hash');
  return value;
}

// Never return the request address, headers, body, or auth field names/values.
export function readerRequestPolicy(address, method, baseUrl) {
  let url;
  try {
    url = new URL(address);
  } catch {
    return 'deny';
  }
  if (!['http:', 'https:'].includes(url.protocol)) return 'deny';
  const report = safeAuthCallbackReport(address);
  if (
    report.privateQueryFieldsPresent ||
    report.privateFragmentFieldsPresent ||
    url.username ||
    url.password
  )
    return 'deny';
  if (
    METRIC_HOSTS.has(url.hostname) ||
    url.hostname.endsWith('.cloudflareinsights.com') ||
    /\/(?:_vercel\/insights|cdn-cgi\/rum|api\/v1\/site-metrics\/events)(?:\/|$)/.test(url.pathname)
  )
    return 'metrics';
  if (method !== 'GET' && method !== 'HEAD') return 'deny';
  if (/\/(?:auth|sign-in|sign-up|login|oauth|callback|me|ask|chat)(?:\/|$)/i.test(url.pathname))
    return 'deny';
  if (url.origin === baseUrl) return 'read';
  if (url.origin === 'https://api.alethical.com' && PUBLIC_API.test(url.pathname)) return 'read';
  if (url.protocol === 'https:' && ASSET_HOSTS.has(url.hostname)) return 'read';
  if (url.origin === 'https://www.revisor.mn.gov' && url.pathname.startsWith('/bills/'))
    return 'official-source';
  return 'deny';
}
