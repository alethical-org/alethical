import { useState } from 'react';
import { Platform, type PressableStateCallbackType } from 'react-native';

export function hasFineHoverPointer(): boolean {
  return (
    Platform.OS === 'web' &&
    typeof window !== 'undefined' &&
    window.matchMedia?.('(hover: hover) and (pointer: fine) and (min-width: 768px)').matches ===
      true
  );
}

export function finePointerHovered(state: PressableStateCallbackType): boolean {
  return hasFineHoverPointer() && Boolean('hovered' in state && state.hovered);
}

export function useFinePointerHover() {
  const [hovered, setHovered] = useState(false);
  return {
    hovered: hovered && hasFineHoverPointer(),
    onHoverIn: () => {
      if (hasFineHoverPointer()) setHovered(true);
    },
    onHoverOut: () => setHovered(false),
  };
}
