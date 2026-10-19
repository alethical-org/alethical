import {
  currentWebHistoryEntry,
  readSavedCurrentScrollPosition,
  scrollPositionStorageKey,
} from '../navigation/webHistory';

/** Preserve first-paint reading and save against the entry that owns this host. */
export function mountStableEventScroll(host: HTMLElement, path: string): () => void {
  const win = host.ownerDocument.defaultView;
  if (!win) return () => {};
  let owner = currentWebHistoryEntry();
  let detached = false;
  let frame: number | undefined;
  const clearPending = () => {
    delete host.dataset.eventPendingScroll;
  };
  const save = () => {
    // Browser scroll anchoring may also move this position as the real header
    // appears. Only reader input cancels a target waiting for deeper content.
    if (host.dataset.eventPendingScroll) return;
    if (!owner) return;
    try {
      win.sessionStorage.setItem(
        scrollPositionStorageKey(owner.sessionId, owner.entryId),
        String(Math.max(0, Math.round(host.scrollTop))),
      );
    } catch {
      /* Scrolling still works without tab storage. */
    }
  };
  const restoreKnown = () => {
    const saved = readSavedCurrentScrollPosition();
    clearPending();
    if (saved === null) return;
    host.scrollTop = saved;
    if (Math.abs(host.scrollTop - saved) > 2) {
      host.dataset.eventPendingScroll = String(saved);
    }
  };
  const restorePending = () => {
    frame = undefined;
    if (detached || !host.dataset.eventPendingScroll) return;
    const target = Number(host.dataset.eventPendingScroll);
    host.scrollTop = target;
    if (Math.abs(host.scrollTop - target) <= 2) {
      clearPending();
      save();
    }
  };
  const schedule = () => {
    if (!detached && host.dataset.eventPendingScroll && frame === undefined) {
      frame = win.requestAnimationFrame(restorePending);
    }
  };
  const adopt = () => {
    if (win.location.pathname !== path) return;
    const next = currentWebHistoryEntry();
    if (next?.sessionId === owner?.sessionId && next?.entryId === owner?.entryId) return;
    owner = next;
    restoreKnown();
    schedule();
  };
  const interaction = () => {
    if (!host.dataset.eventPendingScroll) return;
    clearPending();
    save();
  };
  const inputEvents = ['wheel', 'touchstart', 'pointerdown', 'click', 'focusin'];
  // The server's tiny boot program restores before first paint. At application
  // startup the visible position already belongs to the reader, even if it is 0.
  save();
  host.dispatchEvent(new win.Event('alethical-event-claimed'));
  host.addEventListener('scroll', save, { passive: true });
  for (const event of inputEvents) host.addEventListener(event, interaction, { passive: true });
  host.ownerDocument.addEventListener('keydown', interaction, { passive: true });
  host.addEventListener('load', schedule, true);
  win.addEventListener('popstate', adopt);
  win.addEventListener('alethical-return-context', adopt);
  const changes = new MutationObserver(schedule);
  changes.observe(host, { childList: true, subtree: true });
  const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
  for (const node of host.querySelectorAll('main,[data-event-discussion]')) resize?.observe(node);
  void host.ownerDocument.fonts?.ready.then(schedule);
  schedule();
  return () => {
    if (detached) return;
    detached = true;
    save();
    if (frame !== undefined) win.cancelAnimationFrame(frame);
    changes.disconnect();
    resize?.disconnect();
    host.removeEventListener('scroll', save);
    for (const event of inputEvents) host.removeEventListener(event, interaction);
    host.ownerDocument.removeEventListener('keydown', interaction);
    host.removeEventListener('load', schedule, true);
    win.removeEventListener('popstate', adopt);
    win.removeEventListener('alethical-return-context', adopt);
  };
}
