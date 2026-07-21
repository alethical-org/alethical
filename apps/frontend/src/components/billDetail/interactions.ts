import { useState } from 'react';
import { Platform } from 'react-native';

export const isWeb = Platform.OS === 'web';

// Standard hover pattern (mirrors searchPieces useHover): spread `hover` onto a
// Pressable, read `hovered` to switch styles. No-op affordance on native.
export function useHover(): [boolean, { onHoverIn: () => void; onHoverOut: () => void }] {
  const [hovered, setHovered] = useState(false);
  return [hovered, { onHoverIn: () => setHovered(true), onHoverOut: () => setHovered(false) }];
}
