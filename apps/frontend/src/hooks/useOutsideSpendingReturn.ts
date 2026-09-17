import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import {
  outsideBrowseReturn,
  type OutsideSpendingBrowseAddress,
} from '../lib/outsideSpendingBrowse';
import { currentWebHistoryEntry } from '../navigation/webHistory';
import { stateFromPathname } from '../navigation/webRoutes';
import type { RootScreenProps } from '../navigation/types';

type Bookmark = NonNullable<OutsideSpendingBrowseAddress['returnContext']>;
const subjectKey = (address: OutsideSpendingBrowseAddress) =>
  address.spender ? `spender:${address.spender}` : `about:${address.about}`;
function storageKey() {
  const entry = currentWebHistoryEntry();
  return entry ? `alethical:outside-return:${entry.sessionId}:${entry.entryId}` : null;
}

/** Captured before opening a name, while its browsing entry still owns the scroll position. */
export function outsideSpendingReturnContext(
  href: string,
  subject: OutsideSpendingBrowseAddress,
): Bookmark | undefined {
  if (Platform.OS !== 'web') return undefined;
  const entry = currentWebHistoryEntry();
  return entry
    ? { href, depth: entry.depth, sessionId: entry.sessionId, subject: subjectKey(subject) }
    : undefined;
}

function savedBookmark(address: OutsideSpendingBrowseAddress): Bookmark | undefined {
  if (Platform.OS !== 'web') return undefined;
  try {
    const key = storageKey();
    const value = key ? JSON.parse(window.sessionStorage.getItem(key) ?? 'null') : null;
    if (
      value &&
      value.subject === subjectKey(address) &&
      typeof value.href === 'string' &&
      typeof value.depth === 'number' &&
      typeof value.sessionId === 'string'
    )
      return value;
  } catch {
    /* Storage can be unavailable; the named link still has its safe fallback. */
  }
  return undefined;
}

export function useOutsideSpendingReturn(
  address: OutsideSpendingBrowseAddress,
  navigation: RootScreenProps<'OutsideSpending'>['navigation'],
) {
  const bookmark = useRef(address.returnContext ?? savedBookmark(address));
  const href = outsideBrowseReturn({
    ...address,
    returnTo: bookmark.current?.href ?? address.returnTo,
  });
  useEffect(() => {
    if (Platform.OS !== 'web' || !bookmark.current) return;
    // Root navigation creates the browser entry after drawing the screen. Associate
    // the bookmark with that exact entry, not with whichever screen it replaced.
    const frame = requestAnimationFrame(() => {
      try {
        const key = storageKey();
        if (key) window.sessionStorage.setItem(key, JSON.stringify(bookmark.current));
      } catch {
        /* A reload falls back safely if browser storage is blocked. */
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [address.spender, address.about, address.year, address.sort, address.page]);
  const onReturn = () => {
    const current = Platform.OS === 'web' ? currentWebHistoryEntry() : null;
    const prior = bookmark.current;
    if (prior && current && current.sessionId === prior.sessionId && current.depth > prior.depth) {
      window.history.go(prior.depth - current.depth);
      return;
    }
    const target = stateFromPathname(href).routes.at(-1);
    navigation.replace('OutsideSpending', target?.params as OutsideSpendingBrowseAddress);
  };
  return { href, onReturn };
}
