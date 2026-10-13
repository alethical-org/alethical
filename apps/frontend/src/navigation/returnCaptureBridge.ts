import { stateFromPathname, pathnameFromNavigationState, safeArticleReturnHref } from './webRoutes';

// Keep public-list capture available before a lazy detail page loads. Served
// record names and protected-path validation are installed by returnPageNames.
import type { AppReturnDestination } from './webHistory';

type CapturedReturn = { href: string; name?: string; public: boolean };
let captureRecord: ((path: string) => CapturedReturn | null) | undefined;
let protectedReturns:
  | {
      get: (entryId: string) => AppReturnDestination | undefined;
      set: (entryId: string, destination: AppReturnDestination) => void;
    }
  | undefined;
export const accountReturn = (entryId: string) => protectedReturns?.get(entryId);
export function keepAccountReturn(entryId: string, destination: AppReturnDestination) {
  protectedReturns?.set(entryId, destination);
}

let clearAccountNames: (() => void) | undefined;
export function installReturnCapture(
  capture: (path: string) => CapturedReturn | null,
  clearAccount: () => void,
  returns: NonNullable<typeof protectedReturns>,
) {
  protectedReturns = returns;
  captureRecord = capture;
  clearAccountNames = clearAccount;
}

let access = { accountId: null as string | null, admin: false, ready: false, version: 0 };

export function notifyReturnContext() {
  if (typeof window !== 'undefined')
    window.dispatchEvent(new window.Event('alethical-return-context'));
}

export function setReturnAccess(accountId: string | null, admin: boolean, ready = true) {
  const wasReady = access.ready;
  if (!ready) {
    access.ready = false;
    if (wasReady) notifyReturnContext();
    return;
  }
  if (access.accountId !== accountId || access.admin !== admin) {
    clearAccountNames?.();
    access = { accountId, admin, ready, version: access.version + 1 };
    notifyReturnContext();
  } else {
    access.ready = true;
    if (!wasReady) notifyReturnContext();
  }
}
export function returnAccessVersion() {
  return access.ready ? access.version : null;
}

export function readReturnAccess() {
  return access;
}

// Capture only recognized public routes until the lazy name resolver is loaded.
// That resolver establishes the name before a return control renders. Keep the
// full safe address immediately, including filters; protected paths stay in memory.
export function sanitizePublicReturnPath(path: string): string | null {
  if (
    typeof path !== 'string' ||
    !path.startsWith('/') ||
    path.startsWith('//') ||
    /[\\\u0000-\u001f]/.test(path)
  )
    return null;
  const url = new URL(path, 'https://alethical.invalid');
  if (
    url.origin !== 'https://alethical.invalid' ||
    /^\/(confirm|reset|admin|email-preferences|comment-emails|unsubscribe|tracked)(\/|$)/.test(
      url.pathname,
    ) ||
    /^\/candidates\/[^/]+\/(claim|manage)(\/|$)/.test(url.pathname) ||
    /^\/money\/ads(\/|$)/.test(url.pathname) ||
    (url.hash && !/^#[a-z0-9_-]+$/i.test(url.hash))
  )
    return null;
  if (
    [...url.searchParams.keys()].some(
      (key) =>
        /^(code|token|access_token|refresh_token|state|address|email|password)$/i.test(key) ||
        (url.pathname.startsWith('/candidates') && !['election', 'candidate'].includes(key)),
    )
  )
    return null;
  const from = url.searchParams.get('from');
  if (
    from &&
    (!safeArticleReturnHref(from) ||
      [...new URL(from, 'https://alethical.invalid').searchParams.keys()].some(
        (key) => !['page', 'post'].includes(key),
      ))
  )
    return null;
  // The actual address owner retains supported filters and drops unknown input.
  // Do not duplicate its query-key lists in the program every visitor downloads.
  try {
    const navigationState = stateFromPathname(`${url.pathname}${url.search}`);
    if (navigationState.routes[navigationState.index ?? 0]?.name === 'NotFound') return null;
    const href = pathnameFromNavigationState(navigationState);
    return `${href}${url.hash}`;
  } catch {
    return null;
  }
}

export function capturePageReturn(path: string): CapturedReturn | null {
  if (captureRecord) return captureRecord(path);
  const href = sanitizePublicReturnPath(path);
  return href ? { href, public: true } : null;
}
