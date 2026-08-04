import { Pressable, StyleSheet, Text } from 'react-native';
import { Check, Plus } from 'lucide-react-native';

import { theme as t } from '../../theme/tokens';
import { isWeb, useHover } from './interactions';

// Bill Detail header Track control — the one live tracking affordance on a bill
// profile. INK fill (#11150f, white label/icon): ink is the reserved role for
// Track alone, so it reads as the primary tracking action beside the white
// outline Share (grounded next to it in the header). One shared component so web
// and mobile stay the same button, sized per viewport to match Share on each
// (`size`): web mirrors SharePopover's shareBtn, mobile the screen's ShareButton.
//
// Unlike components/RoadmapTrackButton.tsx (the still-inert on-card roadmap
// button, tracked in #976), this one is functional: onPress toggles the bill on
// the signed-in user's watchlist, or routes a signed-out user through sign-in.
// It reflects state (Track / Tracked) because a live toggle cannot honestly keep
// showing "+ Track" on a bill the reader already tracks.
export function BillTrackButton({
  tracked,
  onPress,
  size,
}: {
  tracked: boolean;
  onPress: () => void;
  /** 'web' matches SharePopover's button; 'mobile' matches the mobile ShareButton. */
  size: 'web' | 'mobile';
}) {
  const [hovered, hover] = useHover();
  const mobile = size === 'mobile';
  const glyph = mobile ? 16 : 17;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={tracked ? 'Untrack this bill' : 'Track this bill'}
      accessibilityState={{ selected: tracked }}
      onPress={onPress}
      {...hover}
      style={[styles.btn, mobile ? styles.btnMobile : styles.btnWeb, hovered && styles.btnHover]}
    >
      {tracked ? (
        <Check size={glyph} color={TRACK_WHITE} strokeWidth={2.6} />
      ) : (
        <Plus size={glyph} color={TRACK_WHITE} strokeWidth={2.6} />
      )}
      <Text style={[styles.text, mobile ? styles.textMobile : styles.textWeb]}>
        {tracked ? 'Tracked' : 'Track'}
      </Text>
    </Pressable>
  );
}

// Bespoke ink fill + hover, matching components/RoadmapTrackButton.tsx so both
// Track controls read identically. No semantic token maps to the #2c322c hover,
// so it stays a local const (as BillHeader does for its breadcrumb grey).
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
  btnHover: { backgroundColor: TRACK_INK_HOVER, borderColor: TRACK_INK_HOVER },
  text: {
    fontFamily: t.typography.ui,
    fontWeight: t.fontWeights.semibold,
    color: TRACK_WHITE,
  },
  textWeb: { fontSize: t.fontSizes.bodyLg },
  textMobile: { fontSize: t.fontSizes.body },
});
