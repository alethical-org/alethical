import { useCallback, useEffect, useRef } from 'react';
import {
  Platform,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollView,
} from 'react-native';

import {
  currentWebHistoryEntry,
  readCurrentScrollPosition,
  saveCurrentScrollPosition,
  type AppHistoryEntry,
} from '../navigation/webHistory';

function visibleScroller(node: HTMLElement | null): node is HTMLElement {
  return Boolean(node?.isConnected && node.getClientRects().length);
}

/**
 * Saves a page's inner ScrollView position on its exact browser-history entry,
 * then restores it when Back returns to that entry. Search filters and page
 * numbers already live in the URL; this supplies the remaining "same place"
 * part of browser Back for React Native Web's nested scroller.
 */
export function useHistoryScrollRestoration(ready = true) {
  const scrollRef = useRef<ScrollView | null>(null);
  // React Navigation draws the destination screen before RootNavigator adds its
  // browser-history entry. Reading here during render therefore reads the page
  // being left and can copy its scroll position onto the new page. Wait until
  // the next animation frame, when the destination owns the current entry.
  const targetRef = useRef<number | null>(null);
  const restoredRef = useRef(Platform.OS !== 'web');
  const ownerRef = useRef<AppHistoryEntry | null>(null);

  const ownsCurrentEntry = useCallback(() => {
    const current = currentWebHistoryEntry();
    const owner = ownerRef.current;
    return Boolean(
      owner && current?.sessionId === owner.sessionId && current.entryId === owner.entryId,
    );
  }, []);

  const restore = useCallback(() => {
    if (Platform.OS !== 'web' || restoredRef.current || !ready) {
      return;
    }
    const node = scrollRef.current as unknown as HTMLElement | null;
    if (!visibleScroller(node) || !ownsCurrentEntry()) {
      return;
    }
    const target = targetRef.current ?? readCurrentScrollPosition();
    targetRef.current = target;
    node.scrollTop = target;
    restoredRef.current = Math.abs(node.scrollTop - target) < 2;
  }, [ready, ownsCurrentEntry]);

  const scheduleRestore = useCallback(() => {
    if (
      Platform.OS !== 'web' ||
      restoredRef.current ||
      typeof requestAnimationFrame === 'undefined'
    ) {
      return;
    }
    requestAnimationFrame(restore);
  }, [restore]);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof requestAnimationFrame === 'undefined') {
      return;
    }
    const frame = requestAnimationFrame(() => {
      const node = scrollRef.current as unknown as HTMLElement | null;
      if (!visibleScroller(node)) return;
      // Filters can create a new history entry without remounting this screen.
      // Adopt that entry only after navigation has finished and this screen is visible.
      ownerRef.current = currentWebHistoryEntry();
      restore();
    });
    return () => cancelAnimationFrame(frame);
  });

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (Platform.OS !== 'web') return;
      const node = scrollRef.current as unknown as HTMLElement | null;
      // React Native Web emits a trailing scroll callback after 100ms, even after
      // unmount. Hidden stack screens also stay mounted. Neither owns the new page.
      if (!visibleScroller(node) || !ownsCurrentEntry()) return;
      const y = event.nativeEvent.contentOffset.y;
      if (targetRef.current === null || (!restoredRef.current && y + 2 < targetRef.current)) {
        return;
      }
      restoredRef.current = true;
      saveCurrentScrollPosition(y);
    },
    [ownsCurrentEntry],
  );

  return {
    ref: scrollRef,
    onScroll,
    onContentSizeChange: scheduleRestore,
    scrollEventThrottle: 100,
  };
}
