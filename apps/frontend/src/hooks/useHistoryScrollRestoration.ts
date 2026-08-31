import { useCallback, useEffect, useRef } from 'react';
import {
  Platform,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollView,
} from 'react-native';

import { readCurrentScrollPosition, saveCurrentScrollPosition } from '../navigation/webHistory';

/**
 * Saves a page's inner ScrollView position on its exact browser-history entry,
 * then restores it when Back returns to that entry. Search filters and page
 * numbers already live in the URL; this supplies the remaining "same place"
 * part of browser Back for React Native Web's nested scroller.
 */
export function useHistoryScrollRestoration() {
  const scrollRef = useRef<ScrollView | null>(null);
  // React Navigation draws the destination screen before RootNavigator adds its
  // browser-history entry. Reading here during render therefore reads the page
  // being left and can copy its scroll position onto the new page. Wait until
  // the next animation frame, when the destination owns the current entry.
  const targetRef = useRef<number | null>(null);
  const restoredRef = useRef(Platform.OS !== 'web');

  const restore = useCallback(() => {
    if (Platform.OS !== 'web' || restoredRef.current) {
      return;
    }
    const node = scrollRef.current as unknown as HTMLElement | null;
    if (!node || typeof node.scrollTop !== 'number') {
      return;
    }
    const target = targetRef.current ?? readCurrentScrollPosition();
    targetRef.current = target;
    node.scrollTop = target;
    restoredRef.current = Math.abs(node.scrollTop - target) < 2;
  }, []);

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
    const frame = requestAnimationFrame(restore);
    return () => cancelAnimationFrame(frame);
  }, [restore]);

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (Platform.OS !== 'web') {
      return;
    }
    const y = event.nativeEvent.contentOffset.y;
    if (targetRef.current === null || (!restoredRef.current && y + 2 < targetRef.current)) {
      return;
    }
    restoredRef.current = true;
    saveCurrentScrollPosition(y);
  }, []);

  return {
    ref: scrollRef,
    onScroll,
    onContentSizeChange: scheduleRestore,
    scrollEventThrottle: 100,
  };
}
