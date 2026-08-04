import { GestureResponderEvent, Pressable, StyleSheet, Text } from 'react-native';
import { Check, Plus } from 'lucide-react-native';

import { theme as t } from '../../theme/tokens';
import { isWeb, useHover } from './interactions';

// Bill Detail header Track control — the one live tracking affordance on a bill
// profile, and the shared Track control on bill cards / home / Ask answers. INK
// fill (#11150f, white label/icon): ink is the reserved role for Track alone, so
// it reads as the primary tracking action beside the white outline Share (in the
// header). One shared component across every surface, sized per viewport (`size`):
// 'web' mirrors SharePopover's shareBtn, 'mobile' the screen's ShareButton, 'card'
// the compact on-card button.
//
// It is functional (this replaced the retired inert RoadmapTrackButton, #976):
// onPress toggles the bill on the signed-in user's watchlist, or routes a
// signed-out user through sign-in (see hooks/useBillTracking). It reflects state
// (Track / Tracked) because a live toggle cannot honestly keep showing "+ Track"
// on a bill the reader already tracks.
export function BillTrackButton({
  tracked,
  onPress,
  size,
}: {
  tracked: boolean;
  // Matches Pressable's onPress so a link surface can pass a pressInsideLink handler
  // (which receives the event to swallow it); header callers pass a plain () => void.
  onPress: (event: GestureResponderEvent) => void;
  /**
   * 'web' matches SharePopover's button; 'mobile' matches the mobile ShareButton;
   * 'card' matches the compact on-card button (bill lists, home, Ask answer card).
   */
  size: 'web' | 'mobile' | 'card';
}) {
  const [hovered, hover] = useHover();
  const glyph = size === 'web' ? 17 : 16;
  const btnSize =
    size === 'web' ? styles.btnWeb : size === 'mobile' ? styles.btnMobile : styles.btnCard;
  const textSize =
    size === 'web' ? styles.textWeb : size === 'mobile' ? styles.textMobile : styles.textCard;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={tracked ? 'Untrack this bill' : 'Track this bill'}
      accessibilityState={{ selected: tracked }}
      onPress={onPress}
      {...hover}
      style={[styles.btn, btnSize, hovered && styles.btnHover]}
    >
      {tracked ? (
        <Check size={glyph} color={TRACK_WHITE} strokeWidth={2.6} />
      ) : (
        <Plus size={glyph} color={TRACK_WHITE} strokeWidth={2.6} />
      )}
      <Text style={[styles.text, textSize]}>{tracked ? 'Tracked' : 'Track'}</Text>
    </Pressable>
  );
}

// Bespoke ink fill + hover. No semantic token maps to the #2c322c hover, so it
// stays a local const (as BillHeader does for its breadcrumb grey).
const TRACK_INK = '#11150f';
const TRACK_INK_HOVER = '#2c322c';
const TRACK_WHITE = '#ffffff';

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: TRACK_INK,
    borderWidth: 1,
    borderColor: TRACK_INK,
    ...(isWeb
      ? ({
          transitionProperty: 'background-color, border-color',
          transitionDuration: '0.15s',
        } as object)
      : null),
  },
  // Web: mirror SharePopover's shareBtn (radius 12, 12/20/12/17, gap 10, 16/600).
  // Leading glyph, so 3px less on the left (docs/design/design-principles.md §2).
  btnWeb: {
    gap: 10,
    borderRadius: t.radii.md,
    paddingVertical: 12,
    paddingLeft: 17,
    paddingRight: 20,
  },
  // Mobile: mirror the screen's ShareButton (radius 10, 10/14/10/11, gap 7,
  // 15/600, 44pt min touch target).
  btnMobile: {
    gap: 7,
    borderRadius: 10,
    paddingVertical: 10,
    paddingLeft: 11,
    paddingRight: 14,
    minHeight: 44,
  },
  // Card: the compact button on bill lists / home / the Ask answer card.
  // Radius 10, 10/18, gap 8, 14/700.
  btnCard: {
    gap: 8,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 18,
  },
  btnHover: { backgroundColor: TRACK_INK_HOVER, borderColor: TRACK_INK_HOVER },
  text: {
    fontFamily: t.typography.ui,
    fontWeight: t.fontWeights.semibold,
    color: TRACK_WHITE,
  },
  textWeb: { fontSize: t.fontSizes.bodyLg },
  textMobile: { fontSize: t.fontSizes.body },
  textCard: { fontSize: t.fontSizes.small, fontWeight: t.fontWeights.bold },
});
