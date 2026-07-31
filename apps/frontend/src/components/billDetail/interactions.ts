import { useState } from 'react';
import { Platform } from 'react-native';

export const isWeb = Platform.OS === 'web';

// A sticky right-hand rail, pinned 24px below the top of the window. Web-only —
// React Native has no 'sticky' position — and applied inline so it stays out of
// StyleSheet.create's typed position union. One value for every rail that does
// this: Bill Detail's facts rail and section index, and the Ask answer page's
// "From the bill" rail.
export const STICKY_RAIL = { position: 'sticky', top: 24 } as object;

// Standard hover pattern (mirrors searchPieces useHover): spread `hover` onto a
// Pressable, read `hovered` to switch styles. No-op affordance on native.
export function useHover(): [boolean, { onHoverIn: () => void; onHoverOut: () => void }] {
  const [hovered, setHovered] = useState(false);
  return [hovered, { onHoverIn: () => setHovered(true), onHoverOut: () => setHovered(false) }];
}
