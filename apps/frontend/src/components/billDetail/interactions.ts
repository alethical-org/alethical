import { useEffect, useRef, useState } from 'react';
import { Platform, View } from 'react-native';

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

// Mark a control as unavailable (and optionally busy) so assistive technology and the
// keyboard both agree with what the reader can see.
//
// This exists because the OBVIOUS way to do it silently does nothing on this stack.
// Measured in a browser (#1013, #1025): `accessibilityState={{ disabled: true, busy:
// true }}` on a Pressable or a View renders NEITHER `aria-disabled` NOR `aria-busy`,
// and `accessibilityRole="button"` quietly adds `tabindex="0"` on top — so a control
// that looks correctly marked in the source is a keyboard tab stop announcing itself as
// an ordinary, pressable button with nothing behind it. No error, no warning, no type
// complaint. It fails completely quietly, which is why it survived in three places.
//
// The one case where `accessibilityState` DOES appear to work is the tell: RN-Web's
// Pressable manages `aria-disabled` from its own `disabled` PROP. So a control passing
// `disabled={...}` is fine (`PrimaryButton`, the pagination arrows), and a control that
// only sets accessibilityState — or that gates by swapping `onPress` for `undefined` —
// is not. That is exactly why this looks like it works most of the time.
//
// Spread the returned ref onto the node. Setting the attributes directly is safe:
// React never manages them, so it does not clobber them. Native gets a no-op, where
// accessibilityState is the real mechanism and works.
export function useUnavailableControl(
  active: boolean,
  { busy = false, blockFocus = true }: { busy?: boolean; blockFocus?: boolean } = {},
) {
  const ref = useRef<View>(null);
  useEffect(() => {
    if (!isWeb || !ref.current) return;
    const node = ref.current as unknown as HTMLElement;
    if (!active) {
      // Clear on the way out, so a control that becomes usable again does not stay
      // marked unavailable to a screen reader while looking live on screen.
      node.removeAttribute('aria-disabled');
      node.removeAttribute('aria-busy');
      if (blockFocus) node.removeAttribute('tabindex');
      return;
    }
    node.setAttribute('aria-disabled', 'true');
    if (busy) node.setAttribute('aria-busy', 'true');
    // Keep the keyboard off a control that cannot do anything. `focusable={false}` does
    // NOT achieve this on RN-Web; tabIndex -1 does.
    if (blockFocus) node.setAttribute('tabindex', '-1');
  }, [active, busy, blockFocus]);
  return ref;
}
