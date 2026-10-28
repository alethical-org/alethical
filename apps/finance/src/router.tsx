import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from 'react';

/** The browser's own address is the only route state, so Back, Forward,
 * copied links and new tabs all show what the address names. */
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

if (typeof window !== 'undefined') window.addEventListener('popstate', notify);

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
