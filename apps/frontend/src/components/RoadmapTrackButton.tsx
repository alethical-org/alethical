import { useEffect, useRef } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Plus } from 'lucide-react-native';

import { useHover } from './billDetail/interactions';
import { pressInsideLink } from '../navigation/links';
import { theme as t } from '../theme/tokens';

const isWeb = Platform.OS === 'web';

// Roadmap Track button — bill tracking is a not-yet-live roadmap feature. The
// control renders in the site's INK fill (background #11150f, white label/icon):
// ink is the reserved role for Track alone (green stays for other forward actions),
// so the button reads as the primary tracking affordance on every surface. It is
// still INERT: aria-disabled, performs no action, and only swallows the tap so a
// wrapping card doesn't navigate. There is deliberately no "coming soon" label and
// no separate "Tracking" state. One shared component so every surface (search
// results, home, Ask answers) reads consistently.
export function RoadmapTrackButton() {
  const [hovered, hover] = useHover();
  // Inert control: announce it as disabled so assistive tech doesn't offer an
  // action that does nothing. RN-Web's Pressable manages `aria-disabled` from its
  // own `disabled` state and ignores the prop, but we can't use `disabled` (it
  // would let the tap fall through to the wrapping card and navigate) — so set the
  // attribute directly on the web node, as BillResultCard does for `title`.
  const ref = useRef<View>(null);
  useEffect(() => {
    if (isWeb && ref.current) {
      (ref.current as unknown as HTMLElement).setAttribute('aria-disabled', 'true');
    }
  }, []);
  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      accessibilityLabel="Track bill"
      // Kept out of the tab order (inert); onPress only swallows the tap so the
      // wrapping card can't fire — clicking is a true no-op. The wrapping card is
      // a real <a href>, so swallowing means cancelling the click as well as
      // stopping it propagating, or the browser would follow the card's URL.
      tabIndex={-1}
      onPress={pressInsideLink()}
      {...hover}
      style={[styles.btn, hovered && styles.btnHover]}
    >
      <Plus size={15} color="#ffffff" strokeWidth={2.6} />
      <Text style={styles.text}>Track</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#11150f',
    borderWidth: 1,
    borderColor: '#11150f',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 18,
    ...(isWeb
      ? ({
          transitionProperty: 'background-color, border-color',
          transitionDuration: '0.15s',
        } as object)
      : null),
  },
  btnHover: { backgroundColor: '#2c322c', borderColor: '#2c322c' },
  text: {
    fontFamily: t.typography.ui,
    fontSize: 14,
    fontWeight: t.fontWeights.bold,
    color: '#ffffff',
  },
});
