import { useCallback, useEffect, type RefObject } from 'react';
import { Platform, type ScrollView } from 'react-native';

/** Reveal the current section in the phone/tablet strip without moving the page. */
export function useActiveBillChip(ref: RefObject<ScrollView | null>, active: string) {
  const reveal = useCallback(() => {
    if (Platform.OS !== 'web') return;
    const strip = ref.current?.getScrollableNode?.() as HTMLElement | undefined;
    const chip = strip?.querySelector<HTMLElement>('[aria-current="location"]');
    if (!strip || !chip) return;
    const viewport = strip.getBoundingClientRect();
    const bounds = chip.getBoundingClientRect();
    // Existing shared keyboard outline: 2px wide with a 2px offset.
    const left = viewport.left + 4;
    const right = viewport.right - 4;
    if (bounds.left < left) strip.scrollLeft += Math.floor(bounds.left - left);
    else if (bounds.right > right) strip.scrollLeft += Math.ceil(bounds.right - right);
    // Horizontal scrolling alone preserves the page's section/hash target and focus.
  }, [ref, active]);

  useEffect(reveal, [reveal]);
  return reveal;
}
