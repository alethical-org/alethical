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
  const targetRef = useRef(
    Platform.OS === 'web' && typeof window !== 'undefined' ? readCurrentScrollPosition() : 0,
  );
  const restoredRef = useRef(targetRef.current === 0);

  const restore = useCallback(() => {
    if (Platform.OS !== 'web' || restoredRef.current) {
      return;
    }
    const node = scrollRef.current as unknown as HTMLElement | null;
    if (!node || typeof node.scrollTop !== 'number') {
      return;
    }
    node.scrollTop = targetRef.current;
    restoredRef.current = Math.abs(node.scrollTop - targetRef.current) < 2;
  }, []);

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
    if (!restoredRef.current && y + 2 < targetRef.current) {
      return;
    }
    restoredRef.current = true;
    saveCurrentScrollPosition(y);
  }, []);

  return {
    ref: scrollRef,
    onScroll,
    onContentSizeChange: restore,
    scrollEventThrottle: 100,
  };
}
