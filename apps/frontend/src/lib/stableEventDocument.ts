// Kept small: the global error boundary must not import the lazy event player.
const retirements = new WeakMap<HTMLElement, () => void>();
export const STABLE_EVENT_DOCUMENT_ID = 'stable-event-document';

export function stableEventDocument(path: string): HTMLElement | null {
  if (typeof document === 'undefined' || window.location.pathname !== path) return null;
  const host = document.getElementById(STABLE_EVENT_DOCUMENT_ID);
  return host?.dataset.eventPath === path ? host : null;
}

export function registerStableEventRetirement(host: HTMLElement, cleanup: () => void) {
  retirements.set(host, cleanup);
}

/** Keep a keyboard reader on the same control when the real header appears. */
export function clearStableEventHeader(host: HTMLElement): () => void {
  const header = host.querySelector<HTMLElement>('[data-event-nav]');
  const active = host.ownerDocument.activeElement;
  const focused = active instanceof HTMLElement && header?.contains(active) ? active : null;
  const href = focused?.getAttribute('href');
  const name = focused?.getAttribute('aria-label') || focused?.textContent?.trim();
  header?.replaceChildren();
  return () => {
    if (!focused || host.ownerDocument.activeElement !== host.ownerDocument.body) return;
    const replacement = Array.from(
      header?.querySelectorAll<HTMLElement>('a,button,[role="button"]') ?? [],
    ).find(
      (node) =>
        (href && node.getAttribute('href') === href) ||
        (name && (node.getAttribute('aria-label') || node.textContent?.trim()) === name),
    );
    replacement?.focus({ preventScroll: true });
  };
}

/** Route departure and fatal app failure share the same idempotent retirement. */
export function retireStableEventDocument(host?: HTMLElement | null) {
  if (typeof document === 'undefined') return;
  const target = host ?? document.getElementById(STABLE_EVENT_DOCUMENT_ID);
  if (target) {
    // Also release the first-paint listeners if startup failed before claiming it.
    target.dispatchEvent(new Event('alethical-event-claimed'));
    const cleanup = retirements.get(target);
    retirements.delete(target);
    try {
      cleanup?.();
    } catch {
      // An unavailable third-party player cannot hide the app's recovery view.
    }
    target.remove();
  }
  if (!document.getElementById(STABLE_EVENT_DOCUMENT_ID)) {
    document.body.removeAttribute('data-stable-event-document');
  }
}
