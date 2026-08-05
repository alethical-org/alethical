import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  GestureResponderEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Check, Plus } from 'lucide-react-native';

import { useTrackedStateUnknown } from '../../hooks/useAppQueries';
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
//
// THREE forms, one box (#1013).
//
// The third form is "we do not know yet". Until the watchlist has come back, a
// signed-in reader's tracked state is genuinely unknown, and the button used to
// render `tracked={false}` — asserting "+ Track" on a bill they may well already
// track, where pressing it re-saves instead of removing. A wrong assertion is worse
// than a blank one, so the label is what goes: same black box, no words, a spinner.
// The button asks for that state itself rather than taking it as a prop, so every
// surface gets it without threading a flag down through four screens (and without
// this change needing to touch a file another session has open).
//
// All three forms share ONE fixed box per size, because the labels do not: measured
// on production before this change, "✓ Tracked" is 16 to 18px wider than "+ Track"
// at every size, so every ordinary track and untrack nudged its whole row sideways —
// on a list, under the reader's finger as they pressed it. Height is explicit rather
// than a minimum: the label's line box is taller than the spinner's, so a min-height
// would bind on the spinner form alone and the box would shrink on resolve.
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
  const stateUnknown = useTrackedStateUnknown();
  const spinnerVisible = useDelayed(stateUnknown, SPINNER_DELAY_MS);
  const unknownRef = useInertBusyNode(stateUnknown);
  const glyph = size === 'web' ? 17 : 16;
  const btnSize =
    size === 'web' ? styles.btnWeb : size === 'mobile' ? styles.btnMobile : styles.btnCard;
  const textSize =
    size === 'web' ? styles.textWeb : size === 'mobile' ? styles.textMobile : styles.textCard;

  if (stateUnknown) {
    // A View rather than a disabled Pressable: there is nothing to press, and
    // RN-Web's Pressable manages aria-disabled from its own `disabled` state (which
    // would also let the tap fall through to a wrapping card link). The View's
    // attributes are set on the DOM node instead of through accessibilityState —
    // measured in a browser, `accessibilityState={{ disabled: true, busy: true }}`
    // rendered NEITHER `aria-disabled` nor `aria-busy`, and `accessibilityRole`
    // silently made the box `tabindex="0"`, so it was a tab stop announcing as an
    // ordinary enabled button with no action behind it.
    return (
      <View
        ref={unknownRef}
        accessibilityRole="button"
        accessibilityLabel="Checking your tracked bills"
        style={[styles.btn, btnSize, styles.btnUnknown]}
      >
        {/* Held back ~300ms. Motion that appears and vanishes inside a couple hundred
            milliseconds reads as a flicker, and on a ten-card list it is ten of them.
            Under the threshold the reader sees a briefly quiet button and nothing
            twitches. The dimmed box itself is NOT delayed — it shows from the first
            frame, because the button must never claim a state it does not have. */}
        {spinnerVisible ? <ActivityIndicator size="small" color={TRACK_WHITE} /> : null}
      </View>
    );
  }

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

// Mark the unknown form as a busy, unavailable, unfocusable button on the DOM node.
//
// It has to be done here rather than through props, because RN-Web drops all three.
// Verified in a browser on this version: `accessibilityState={{ disabled: true,
// busy: true }}` rendered neither `aria-disabled` nor `aria-busy`, and
// `accessibilityRole="button"` gave the box `tabindex="0"` — so without this the
// checking form was a tab stop that announced as an ordinary, pressable button.
// Same escape hatch BillResultCard uses for its title tooltip; React never manages
// these attributes, so it does not clobber them.
function useInertBusyNode(active: boolean) {
  const ref = useRef<View>(null);
  useEffect(() => {
    if (!isWeb || !active || !ref.current) return;
    const node = ref.current as unknown as HTMLElement;
    node.setAttribute('aria-busy', 'true');
    node.setAttribute('aria-disabled', 'true');
    node.setAttribute('tabindex', '-1');
  }, [active]);
  return ref;
}

// Follow `value` up, but only after it has stayed true for `delayMs`. Resets the
// moment it goes false, so a fast answer never shows anything.
function useDelayed(value: boolean, delayMs: number): boolean {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!value) {
      setSettled(false);
      return;
    }
    const timer = setTimeout(() => setSettled(true), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}

// Bespoke ink fill + hover. No semantic token maps to the #2c322c hover, so it
// stays a local const (as BillHeader does for its breadcrumb grey).
const TRACK_INK = '#11150f';
const TRACK_INK_HOVER = '#2c322c';
const TRACK_WHITE = '#ffffff';
const SPINNER_DELAY_MS = 300;

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    // Centred, because the box no longer hugs its content: a shorter label or a
    // spinner has to sit in the middle of the fixed width rather than at its start.
    justifyContent: 'center',
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
  // Box 128 x 46: "✓ Tracked" measures 127.31px here, "+ Track" 108.86px.
  btnWeb: {
    gap: 10,
    borderRadius: t.radii.md,
    paddingVertical: 12,
    paddingLeft: 17,
    paddingRight: 20,
    minWidth: 128,
    height: 46,
  },
  // Mobile: mirror the screen's ShareButton (radius 10, 10/14/10/11, gap 7, 15/600).
  // Box 112 x 44: "✓ Tracked" measures 107.48px here, "+ Track" 90.19px. 44 was
  // already this size's height and remains the minimum touch target.
  btnMobile: {
    gap: 7,
    borderRadius: 10,
    paddingVertical: 10,
    paddingLeft: 11,
    paddingRight: 14,
    minWidth: 112,
    height: 44,
  },
  // Card: the compact button on bill lists / home / the Ask answer card.
  // Radius 10, 10/18, gap 8, 14/700. Box 124 x 44, and the height is a change:
  // this size rendered at 39px, and it is NOT desktop-only — the Ask answer page's
  // own bill card uses it and renders on phones, where 39px is under the 44px
  // minimum touch target. Growing it 5px is an accessibility fix, not just a lock.
  // (The width went 116 -> 124 in the design reference after "✓ Tracked" was measured
  // at 116.28px here, which a 116 box would still have grown past.)
  btnCard: {
    gap: 8,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 18,
    minWidth: 124,
    height: 44,
  },
  btnHover: { backgroundColor: TRACK_INK_HOVER, borderColor: TRACK_INK_HOVER },
  // Still black, so it is recognisably Track; dimmed, so it reads as not yet yours
  // to press.
  btnUnknown: { opacity: 0.62 },
  text: {
    fontFamily: t.typography.ui,
    fontWeight: t.fontWeights.semibold,
    color: TRACK_WHITE,
    // The fixed box leaves only a few px of slack at the widest label, so a two-token
    // label must never take the chance to wrap inside an explicit height.
    ...(isWeb ? ({ whiteSpace: 'nowrap' } as object) : null),
  },
  textWeb: { fontSize: t.fontSizes.bodyLg },
  textMobile: { fontSize: t.fontSizes.body },
  textCard: { fontSize: t.fontSizes.small, fontWeight: t.fontWeights.bold },
});
