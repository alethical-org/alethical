import { useEffect, useRef } from 'react';
import { GestureResponderEvent, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Plus } from 'lucide-react-native';

import { useHover } from './billDetail/interactions';
import { theme as t } from '../theme/tokens';

const isWeb = Platform.OS === 'web';

// Roadmap Track button — bill tracking is a not-yet-live roadmap feature, so this
// previews the control in the site's de-emphasized DASHED treatment and is INERT:
// it is aria-disabled, performs no action, and only swallows the tap so a wrapping
// card doesn't navigate. There is deliberately no "coming soon" label and no solid
// / affirmed "Tracking" state — the dashed style + the nav's roadmap entry already
// signal that tracking isn't live yet. One shared component so every surface (search
// results, home, Ask answers) reads consistently as roadmap.
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
      // wrapping card's link press can't fire — clicking is a true no-op.
      tabIndex={-1}
      onPress={(e: GestureResponderEvent) => e.stopPropagation()}
      {...hover}
      style={[styles.btn, hovered && styles.btnHover]}
    >
      <Plus size={15} color={hovered ? '#11150f' : '#4f5651'} strokeWidth={2.6} />
      <Text style={[styles.text, hovered && styles.textHover]}>Track</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(17,21,15,0.3)',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 18,
    ...(isWeb
      ? ({ transitionProperty: 'border-color, color', transitionDuration: '0.15s' } as object)
      : null),
  },
  btnHover: { borderColor: '#11150f' },
  text: {
    fontFamily: t.typography.ui,
    fontSize: 14,
    fontWeight: t.fontWeights.bold,
    color: '#4f5651',
  },
  textHover: { color: '#11150f' },
});
