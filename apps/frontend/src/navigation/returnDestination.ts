import { currentWebHistoryEntry, type AppReturnDestination } from './webHistory';
import {
  safeReturnPath,
  safeAccountReturnPath,
  returnAccessVersion,
  returnPageWasInvalidated,
  validReturnName,
  returnPageName,
} from './returnPageNames';
export {
  returnPageName,
  rememberReturnPageName,
  rememberReturnPageAlias,
  forgetReturnPageName,
  useReturnPageName,
  setReturnAccess,
} from './returnPageNames';

export type ReturnDestination = { href: string; name: string; historyEntryId?: string };

/** Resolve once for text, href and activation. Unproven history uses the named fallback. */
export function resolveReturnDestination(href: string, name: string): ReturnDestination {
  if (!validReturnName(name)) throw new Error('A return link requires a readable destination name');
  const entry = currentWebHistoryEntry();
  const earlier: AppReturnDestination | undefined = entry?.returnTo;
  const earlierName = earlier ? (earlier.name ?? returnPageName(earlier.href)) : null;
  if (
    entry &&
    earlier &&
    earlier.sessionId === entry.sessionId &&
    earlier.depth === entry.depth - 1 &&
    earlier.entryId !== entry.entryId &&
    (safeReturnPath(earlier.href) === earlier.href ||
      (earlier.accessVersion != null &&
        earlier.accessVersion === returnAccessVersion() &&
        safeAccountReturnPath(earlier.href) === earlier.href)) &&
    !returnPageWasInvalidated(earlier.href) &&
    validReturnName(earlierName ?? '')
  ) {
    return { href: earlier.href, name: earlierName!, historyEntryId: earlier.entryId };
  }
  return { href, name };
}

/** Do not traverse an entry if the link's advertised context has changed since render. */
export function canRestoreReturnDestination(destination: ReturnDestination) {
  if (!destination.historyEntryId) return false;
  const resolved = resolveReturnDestination(destination.href, destination.name);
  return (
    resolved.historyEntryId === destination.historyEntryId &&
    resolved.href === destination.href &&
    resolved.name === destination.name
  );
}
