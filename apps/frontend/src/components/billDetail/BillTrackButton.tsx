import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  GestureResponderEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Check, Plus, RefreshCw } from '../icons';

import { useTrackedListState } from '../../hooks/useAppQueries';
import { theme as t } from '../../theme/tokens';
import {
  BillTrackButtonSize,
  trackButtonAppearance,
  trackButtonSize,
  trackButtonToggleProps,
} from './billTrackButtonAppearance';
import { isWeb, useHover, useUnavailableControl } from './interactions';

// Bill Detail header Track control — the one shared Track toggle on bill profiles,
// bill cards, home, Ask answers, and the tracked-bills list. It is sized per viewport:
// 'web' mirrors SharePopover's shareBtn, 'mobile' the screen's ShareButton, 'card'
// the compact on-card button.
//
// It is functional (this replaced the retired inert RoadmapTrackButton, #976):
// onPress toggles the bill on the signed-in user's watchlist, or routes a
// signed-out user through sign-in (see hooks/useBillTracking). It reflects state
// (Track / Tracked) because a live toggle cannot honestly keep showing "+ Track"
// on a bill the reader already tracks.
//
// FOUR forms (#1013, #1021), and a four-way visual system:
//
//   filled black          = we know          -> "+ Track"
//   filled mint           = we know          -> "✓ Tracked"
//   filled black, dimmed  = we're asking     -> spinner, no label, unpressable
//   outlined              = we don't know    -> refresh glyph, no label, pressable
//
// The two wordless forms exist because the button used to render `tracked={false}`
// whenever it had no answer — asserting "+ Track" on a bill the reader may already
// track, where pressing it re-saves instead of removing. A wrong assertion is worse
// than a blank one, so the label is what goes. It never falls back to a label on
// failure either: with refetch-on-press the ACTION is safe, but the LABEL would still
// state a fact about someone's own list that we never got.
//
// Both wordless forms are for a SIGNED-IN reader whose list has not arrived, only.
// Signed out is not unknown — they track nothing, so "+ Track" is correct and honest,
// and neither form may ever appear for them. Neither is a general loading or error
// state for this control (`lib/trackedState.ts` derives all four, and pins that case).
//
// The button asks for the state itself rather than taking it as a prop, so every
// surface gets all four forms without threading a flag down through five screens.
//
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
  size: BillTrackButtonSize;
}) {
  const [hovered, hover] = useHover();
  const { state: resolveState, recheck } = useTrackedListState();
  const state = resolveState(tracked);
  const spinnerVisible = useDelayed(state === 'checking', SPINNER_DELAY_MS);
  const unknownRef = useUnavailableControl(state === 'checking', { busy: true });
  const { glyphSize, fontSize, fontWeight, ...buttonSizeStyle } = trackButtonSize(size);
  // The wordless checking and retry forms are outside this change. Keep their
  // existing fixed boxes and glyph sizes while the two known states use the handoff.
  const unknownGlyphSize = size === 'web' ? 17 : 16;
  const unknownButtonSizeStyle =
    size === 'web'
      ? styles.btnUnknownWeb
      : size === 'mobile'
        ? styles.btnUnknownMobile
        : styles.btnUnknownCard;

  if (state === 'checking') {
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
        style={[styles.btn, unknownButtonSizeStyle, styles.btnUnknown]}
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

  if (state === 'unavailable') {
    // The check failed with nothing to fall back on. Deliberately NOT "+ Track":
    // pressing that on a bill the reader already tracks would re-save instead of
    // remove, and the label would assert a fact about their own list we never got.
    // So the box loses its fill instead of its honesty — outlined is the third rung
    // of a three-way system (filled = we know, filled + dimmed = we're asking,
    // outlined = we don't know), it asserts no word, it is live rather than dead, and
    // it keeps the same footprint so a failure cannot reflow a card.
    //
    // One press refetches the whole shared list, so EVERY unresolved button on the
    // page recovers at once rather than each row retrying its own bill. That falls
    // out of every button reading one query key; it needs no coordination.
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Couldn't check whether you track this bill. Press to check again."
        onPress={pressRecheck(recheck)}
        {...hover}
        style={[
          styles.btn,
          unknownButtonSizeStyle,
          styles.btnRetry,
          hovered && styles.btnRetryHover,
        ]}
      >
        <RefreshCw size={unknownGlyphSize} color={TRACK_INK} strokeWidth={2.4} />
      </Pressable>
    );
  }

  const appearance = trackButtonAppearance(tracked, hovered);

  return (
    <Pressable
      accessibilityRole="button"
      {...trackButtonToggleProps(tracked)}
      onPress={onPress}
      {...hover}
      style={[
        styles.btn,
        buttonSizeStyle,
        { backgroundColor: appearance.backgroundColor, borderColor: appearance.borderColor },
      ]}
    >
      {tracked ? (
        <Check size={glyphSize} color={appearance.glyphColor} strokeWidth={2.6} />
      ) : (
        <Plus size={glyphSize} color={appearance.glyphColor} strokeWidth={2.6} />
      )}
      <Text style={[styles.text, { color: appearance.textColor, fontSize, fontWeight }]}>
        {tracked ? 'Tracked' : 'Track'}
      </Text>
    </Pressable>
  );
}

// Swallow the press before rechecking. Every card surface wraps this button in a real
// link, so an unswallowed press would follow the card's href to the bill instead of
// retrying — the same reason the label forms are handed a pressInsideLink onPress.
function pressRecheck(recheck: () => void) {
  return (event: GestureResponderEvent) => {
    const native = event?.nativeEvent as unknown as { stopPropagation?: () => void } | undefined;
    event?.stopPropagation?.();
    native?.stopPropagation?.();
    event?.preventDefault?.();
    recheck();
  };
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

// The checking and retry forms keep their existing neutral colours. The two known
// states live in billTrackButtonAppearance.ts so their paired tokens cannot drift.
const TRACK_INK = '#11150f';
const TRACK_WHITE = '#ffffff';
const SPINNER_DELAY_MS = 300;

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    ...(isWeb
      ? ({
          transitionProperty: 'background-color, border-color',
          transitionDuration: '0.15s',
        } as object)
      : null),
  },
  btnUnknownWeb: {
    gap: 10,
    borderRadius: 12,
    paddingVertical: 12,
    paddingLeft: 17,
    paddingRight: 20,
    minWidth: 128,
    height: 46,
  },
  btnUnknownMobile: {
    gap: 7,
    borderRadius: 10,
    paddingVertical: 10,
    paddingLeft: 11,
    paddingRight: 14,
    minWidth: 112,
    height: 44,
  },
  btnUnknownCard: {
    gap: 8,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 18,
    minWidth: 124,
    height: 44,
  },
  // Still black, so it is recognisably Track; dimmed, so it reads as not yet yours
  // to press.
  btnUnknown: { opacity: 0.62 },
  // The failed form: the same box with its fill removed. Losing the fill is what says
  // "we don't know" without spending a word on it, and it keeps the ink glyph legible.
  btnRetry: { backgroundColor: TRACK_WHITE, borderColor: 'rgba(17,21,15,0.32)' },
  btnRetryHover: { backgroundColor: '#f7f8fa', borderColor: TRACK_INK },
  text: {
    fontFamily: t.typography.ui,
    fontWeight: t.fontWeights.semibold,
    // Keep the label on one line while allowing its content to set the button width.
    ...(isWeb ? ({ whiteSpace: 'nowrap' } as object) : null),
  },
});
