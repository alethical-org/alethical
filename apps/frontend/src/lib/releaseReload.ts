/**
 * One automatic recovery reload per tab, only before a screen has drawn.
 * Once interactive, a reload would destroy unsent forms and private search memory.
 * The HTML script listener shares the in-memory startup flag and storage budget.
 * No address, account or request data is stored by recovery.
 */
const RELOAD_KEY = 'alethical.release-program-reload';

type ReloadTarget = {
  __alethicalScreenDrawn?: boolean;
  sessionStorage?: Storage;
  location?: { reload: () => void };
};

/** End automatic startup recovery when the first usable screen draws. */
export function markScreenDrawn(
  target: ReloadTarget | undefined = typeof window === 'undefined' ? undefined : window,
): void {
  if (target) target.__alethicalScreenDrawn = true;
}

export function requestReleaseReload(
  target: ReloadTarget | undefined = typeof window === 'undefined' ? undefined : window,
): boolean {
  if (!target?.location || target.__alethicalScreenDrawn) {
    return false;
  }

  try {
    if (!target.sessionStorage || target.sessionStorage.getItem(RELOAD_KEY)) {
      return false;
    }
    target.sessionStorage?.setItem(RELOAD_KEY, '1');
  } catch {
    // A browser with storage blocked cannot hold the one-reload budget, so it
    // does not get the reload either. An error page beats a reload loop.
    return false;
  }

  target.location.reload();
  return true;
}
