import { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useCommitteeTracking } from '../../hooks/useCommitteeTracking';
import { useResponsive } from '../../hooks/useResponsive';
import {
  CHECKING_COMMITTEE_LABEL,
  ON_YOUR_TRACKED_LIST_LEAD,
  ON_YOUR_TRACKED_LIST_LINK,
  RECHECK_COMMITTEE_LABEL,
  RETRY_COMMITTEE_WRITE_LABEL,
  TRACK_COMMITTEE_LABEL,
  TRACKED_COMMITTEE_LABEL,
  trackCommitteeState,
  trackCommitteeToggleProps,
} from '../../lib/trackCommitteeButton';
import { linkProps, routePath } from '../../navigation/links';
import { trackButtonAppearance, trackButtonSize } from '../billDetail/billTrackButtonAppearance';
import { isWeb, useHover, useUnavailableControl } from '../billDetail/interactions';
import { Check, Plus, RefreshCw } from '../icons';
import { theme as t } from '../../theme/tokens';

// The Track control on a committee's money page, beside Share (#1943). The bill
// Track button's twin: one button, aria-pressed false then true, pressing again
// unfollows, in the bill control's own colours and sizes so a committee control
// never runs ahead of the bill one. Following is a bookmark: the only sentence it
// adds is the line under the followed state saying where the bookmark now lives.
//
// Signed out it renders only `beside` (the Share control), no Track at all:
// following a committee while signed out is deliberately not built, and a control
// that opened a sign-in flow nobody has designed would fix a decision nobody made.
//
// Five forms, derived in `lib/trackCommitteeButton.ts` and pinned by its tests:
// hidden · checking (dimmed, wordless) · unavailable (outlined refresh glyph, a
// press rechecks or retries) · tracked · untracked.
export function TrackCommitteeButton({
  registrationNumber,
  beside,
  onOpenTracked,
}: {
  registrationNumber: string;
  /** The control drawn to the right of Track, in the same row: Share. */
  beside?: ReactNode;
  /** Opens the Tracked page in-app; the line is a real link either way. */
  onOpenTracked?: () => void;
}) {
  const tracking = useCommitteeTracking();
  const { isMobile } = useResponsive();
  const [hovered, hover] = useHover();
  const [lineHovered, lineHover] = useHover();
  const tracked = tracking.isTracked(registrationNumber);
  const writeFailed = tracking.writeFailed(registrationNumber);
  const state = trackCommitteeState({
    isSignedIn: tracking.isSignedIn,
    hasList: tracking.hasList,
    isError: tracking.listUnavailable,
    writeFailed,
    isTracked: tracked,
  });
  const unknownRef = useUnavailableControl(state === 'checking', { busy: true });
  const size = isMobile ? 'mobile' : 'web';
  const { glyphSize, fontSize, fontWeight, ...buttonSizeStyle } = trackButtonSize(size);

  if (state === 'hidden') {
    return <>{beside}</>;
  }

  let control: ReactNode;
  if (state === 'checking') {
    // A View, not a disabled Pressable, for the reasons BillTrackButton records:
    // RN-Web renders neither aria-disabled nor aria-busy from accessibilityState,
    // so the DOM attributes are set through the ref instead.
    control = (
      <View
        ref={unknownRef}
        accessibilityRole="button"
        accessibilityLabel={CHECKING_COMMITTEE_LABEL}
        style={[styles.btn, buttonSizeStyle, styles.btnUnknown]}
      />
    );
  } else if (state === 'unavailable') {
    control = (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={writeFailed ? RETRY_COMMITTEE_WRITE_LABEL : RECHECK_COMMITTEE_LABEL}
        onPress={() => (writeFailed ? tracking.retry(registrationNumber) : tracking.recheck())}
        {...hover}
        style={[styles.btn, buttonSizeStyle, styles.btnRetry, hovered && styles.btnRetryHover]}
      >
        <RefreshCw size={glyphSize} color={TRACK_INK} strokeWidth={2.4} />
      </Pressable>
    );
  } else {
    const appearance = trackButtonAppearance(tracked, hovered);
    control = (
      <Pressable
        accessibilityRole="button"
        {...trackCommitteeToggleProps(tracked)}
        onPress={() => tracking.toggleTrack(registrationNumber)}
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
          {tracked ? TRACKED_COMMITTEE_LABEL : TRACK_COMMITTEE_LABEL}
        </Text>
      </Pressable>
    );
  }

  return (
    <View style={styles.column}>
      <View style={styles.row}>
        <View style={styles.trackSlot}>{control}</View>
        {beside}
      </View>
      {state === 'tracked' ? (
        <Text style={styles.line}>
          {ON_YOUR_TRACKED_LIST_LEAD}
          <Text
            {...linkProps(routePath.tracked(), () => onOpenTracked?.())}
            {...lineHover}
            style={[styles.lineLink, lineHovered && styles.lineLinkHover]}
          >
            {ON_YOUR_TRACKED_LIST_LINK}
          </Text>
        </Text>
      ) : null}
    </View>
  );
}

// The checking and retry forms keep the bill control's neutral colours; the two
// known states read theirs from billTrackButtonAppearance.ts.
const TRACK_INK = '#11150f';
const TRACK_WHITE = '#ffffff';

const styles = StyleSheet.create({
  column: { alignItems: 'flex-end' },
  // Share's own wrapper carries a 10px bottom margin (SharePopover.tsx, shareWrap),
  // so Track gets the same slot and the row aligns on the margin edge, exactly as
  // BillHeader.tsx pairs the bill Track button with Share. Without it Share sat
  // 4px above Track. The margin is also the gap to the line under a tracked control.
  trackSlot: { marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
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
  btnUnknown: { backgroundColor: TRACK_INK, borderColor: TRACK_INK, opacity: 0.62, minWidth: 112 },
  btnRetry: { backgroundColor: TRACK_WHITE, borderColor: 'rgba(17,21,15,0.32)', minWidth: 112 },
  btnRetryHover: { backgroundColor: '#f7f8fa', borderColor: TRACK_INK },
  text: {
    fontFamily: t.typography.ui,
    fontWeight: t.fontWeights.semibold,
    ...(isWeb ? ({ whiteSpace: 'nowrap' } as object) : null),
  },
  line: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.small,
    lineHeight: 20,
    color: t.colors.text.muted,
  },
  lineLink: { color: t.colors.brand.deep, fontWeight: t.fontWeights.semibold },
  lineLinkHover: { color: t.colors.brand.forest },
});
