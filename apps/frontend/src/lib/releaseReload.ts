/**
 * One page reload per browser tab, for when a file this release needs is gone.
 *
 * A deployment replaces every content-named JavaScript file. A tab left open
 * across a release still holds the old page, so the piece it asks for next can
 * be missing. Reloading fetches the current page and the current files.
 *
 * The key is shared with the `alethical-release-recovery` program in
 * `apps/frontend/public/index.html`, which does the same for the first file a
 * page loads. One budget between them: if a reload has not fixed it, a second
 * one will not either, and a reload loop is worse than an error page.
 */
const RELOAD_KEY = 'alethical.release-program-reload';

type ReloadTarget = {
  sessionStorage?: Storage;
  location?: { reload: () => void };
};

export function requestReleaseReload(
  target: ReloadTarget | undefined = typeof window === 'undefined' ? undefined : window,
): boolean {
  if (!target?.location) {
    return false;
  }

  try {
    if (target.sessionStorage?.getItem(RELOAD_KEY)) {
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
