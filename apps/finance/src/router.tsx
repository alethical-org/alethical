import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from 'react';

/** The browser's own address is the only route state, so Back, Forward,
 * copied links and new tabs all show what the address names. */
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

const SCROLL_KEY = 'alethical-finance-scroll:';

/** True when the current address was reached by Back or Forward, so a page
 * restores where the reader was instead of starting at the top. */
let arrivedByHistory = false;

export function cameByHistory(): boolean {
  return arrivedByHistory;
}

function saveScroll() {
  try {
    window.sessionStorage.setItem(
      SCROLL_KEY + window.location.pathname + window.location.search,
      String(Math.round(window.scrollY)),
    );
  } catch {
    // Storage can be unavailable; Back then starts at the top.
  }
}

/** Where the reader was on this address, if they have been here before. */
export function savedScroll(): number | null {
  try {
    const value = window.sessionStorage.getItem(
      SCROLL_KEY + window.location.pathname + window.location.search,
    );
    return value === null ? null : Number(value);
  } catch {
    return null;
  }
}

/** Forget every saved position: nothing carries across a sign-out. */
export function clearSavedScroll() {
  try {
    for (const key of Object.keys(window.sessionStorage)) {
      if (key.startsWith(SCROLL_KEY)) window.sessionStorage.removeItem(key);
    }
  } catch {
    // Nothing to clear.
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    arrivedByHistory = true;
    notify();
  });
  window.addEventListener('pagehide', saveScroll);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot() {
  return window.location.pathname + window.location.search;
}

export function useLocation(): URL {
  const current = useSyncExternalStore(subscribe, snapshot, () => '/');
  return new URL(current, window.location.origin);
}

export function navigate(to: string, { replace = false } = {}) {
  saveScroll();
  arrivedByHistory = false;
  if (replace) window.history.replaceState(null, '', to);
  else window.history.pushState(null, '', to);
  notify();
}

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { to: string };

/** A real anchor: opens in a new tab, copies, and works without scripts. */
export function Link({ to, onClick, ...rest }: LinkProps) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      rest.target
    ) {
      return;
    }
    event.preventDefault();
    navigate(to);
  }
  return <a href={to} onClick={handleClick} {...rest} />;
}
