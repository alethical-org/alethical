import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useHover } from '../billDetail/interactions';
import {
  KIND_LABEL_COMMITTEE,
  trackedCommitteeName,
  trackedCommitteePath,
  trackedCommitteeSubtitle,
  type TrackedCommitteeLike,
} from '../../lib/trackedPage';
import { linkProps } from '../../navigation/links';
import { prefersReducedMotion, theme as t } from '../../theme/tokens';

const isWeb = typeof document !== 'undefined';

// One followed committee on the Tracked page (#1943): the mono kind label, the
// name, and the kind-and-seat line under it. The whole card is a real link to
// the committee's money page, in the same chrome as the bill cards beside it.
//
// Deliberately no figure, no date and no "what changed" line. A follow is a
// bookmark; nothing computes whether a committee's filings moved, so the card
// states only what the register says the committee is. Unfollowing happens on
// the committee page, where the control lives beside Share.
export function TrackedCommitteeCard({
  committee,
  onPress,
}: {
  committee: TrackedCommitteeLike;
  onPress: () => void;
}) {
  const [hovered, hover] = useHover();
  const name = trackedCommitteeName(committee);
  const subtitle = trackedCommitteeSubtitle(committee);
  return (
    <Pressable
      {...linkProps(trackedCommitteePath(committee), onPress)}
      accessibilityLabel={`Open ${name}`}
      {...hover}
      style={[styles.card, hovered && styles.cardHover]}
    >
      <View style={styles.topRow}>
        <Text style={styles.kindLabel}>{KIND_LABEL_COMMITTEE}</Text>
        <Text style={styles.regChip}>REG {committee.registrationNumber}</Text>
      </View>
      <Text style={styles.name}>{name}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderRadius: 18,
    paddingVertical: 22,
    paddingHorizontal: 30,
    gap: 10,
    ...(t.shadows.card as object),
    ...(isWeb && !prefersReducedMotion()
      ? ({ transitionProperty: 'border-color, box-shadow', transitionDuration: '0.16s' } as object)
      : null),
  },
  cardHover: {
    borderColor: 'rgba(45,212,126,0.55)',
    ...(isWeb
      ? ({ boxShadow: '0 14px 34px rgba(17,21,15,0.10)' } as object)
      : (t.shadows.lg as object)),
  },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 14, flexWrap: 'wrap' },
  // Same mono, size and tracking as the bill card's kind label and the page's
  // NO CHANGE divider, so the three read as one system.
  kindLabel: {
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.label,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 1.68,
    color: t.colors.text.muted,
  },
  regChip: {
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.label,
    letterSpacing: 0.4,
    color: t.colors.text.faint,
  },
  name: {
    fontFamily: t.typography.title,
    fontSize: t.fontSizes.h2,
    fontWeight: t.fontWeights.heavy,
    lineHeight: 31,
    color: t.colors.text.primary,
    maxWidth: 1040,
  },
  subtitle: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.small,
    lineHeight: 21,
    color: t.colors.text.secondary,
  },
});
