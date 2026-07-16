import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { Legislator } from '../../data/types';
import { theme as t } from '../../theme/tokens';

const isWeb = Platform.OS === 'web';

// Legislator card for the redesigned Search Legislators screen
// (docs/mockups/search-legislators). The whole card links to the profile. There
// is NO follow/track action on this screen (follow-a-legislator is #151, v2).

type LegislatorCardData = Pick<
  Legislator,
  'id' | 'name' | 'chamber' | 'district' | 'party' | 'committees' | 'focusAreas'
> & { authoredCount?: number };

interface LegislatorResultCardProps {
  legislator: LegislatorCardData;
  onPress?: () => void;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : '';
  return (first + last).toUpperCase();
}

function chamberTitle(chamber: string): string {
  return chamber === 'Senate' ? 'State Senator' : 'State Representative';
}

// Interim authored count: prefer an explicit prop; else parse the "N authored
// bills" string the list API currently packs into focusAreas (see #291/#296).
function authoredCount(data: LegislatorCardData): number {
  if (typeof data.authoredCount === 'number') return data.authoredCount;
  for (const area of data.focusAreas ?? []) {
    const match = area.match(/(\d[\d,]*)\s*(?:bills?\s*authored|authored\s*bills?)/i);
    if (match) return Number(match[1].replace(/,/g, ''));
  }
  return 0;
}

export function LegislatorResultCard({ legislator, onPress }: LegislatorResultCardProps) {
  const [hovered, setHovered] = useState(false);
  const committees = legislator.committees ?? [];
  const shown = committees.slice(0, 2);
  const extra = committees.length - shown.length;
  const authored = authoredCount(legislator);

  return (
    <Pressable
      accessibilityRole="link"
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={[styles.card, hovered && styles.cardHover]}
    >
      <View style={styles.topRow}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials(legislator.name)}</Text>
        </View>
        <View style={styles.info}>
          <View style={styles.nameRow}>
            <Text style={styles.name}>{legislator.name}</Text>
            <View style={styles.partyChip}>
              <Text style={styles.partyText}>{legislator.party}</Text>
            </View>
          </View>
          <Text style={styles.subMeta}>
            {legislator.chamber} · District {legislator.district}
          </Text>
          <View style={styles.roleRow}>
            <View style={styles.roleDot} />
            <Text style={styles.roleText}>{chamberTitle(legislator.chamber)}</Text>
          </View>
        </View>
      </View>

      <View style={styles.divider} />

      {committees.length > 0 ? (
        <View style={styles.committeeRow}>
          {shown.map((committee) => (
            <View key={committee} style={styles.committeeChip}>
              <Text style={styles.committeeText}>{committee}</Text>
            </View>
          ))}
          {extra > 0 ? <Text style={styles.moreText}>+{extra} more</Text> : null}
        </View>
      ) : null}

      <Text style={styles.activity}>
        <Text style={styles.activityNum}>{authored}</Text>
        {authored === 1 ? ' bill authored' : ' bills authored'}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderRadius: 18,
    paddingVertical: 24,
    paddingHorizontal: 26,
    gap: 16,
    ...(t.shadows.card as object),
    ...(isWeb
      ? ({ transitionProperty: 'border-color, box-shadow', transitionDuration: '0.15s' } as object)
      : null),
  },
  cardHover: {
    borderColor: 'rgba(45,212,126,0.55)',
    ...(t.shadows.lg as object),
  },
  topRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  avatar: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: t.colors.tint.t150,
    borderWidth: 1,
    borderColor: t.colors.tint.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontFamily: t.typography.title,
    fontSize: t.fontSizes.subhead,
    fontWeight: t.fontWeights.heavy,
    color: t.colors.brand.deep,
  },
  info: { flex: 1, minWidth: 0, gap: 4 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  name: {
    fontFamily: t.typography.title,
    fontSize: t.fontSizes.h4,
    fontWeight: t.fontWeights.heavy,
    color: t.colors.text.primary,
  },
  partyChip: {
    backgroundColor: t.colors.surfaces.s400,
    borderRadius: t.radii.pill,
    paddingVertical: 3,
    paddingHorizontal: 9,
  },
  partyText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.caption,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.6,
    color: t.colors.text.secondary,
  },
  subMeta: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.small,
    color: t.colors.text.muted,
  },
  roleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 1 },
  roleDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: t.colors.brand.base },
  roleText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.meta,
    fontWeight: t.fontWeights.bold,
    color: t.colors.brand.deep,
  },
  divider: { height: 1, backgroundColor: t.colors.alpha.ink08 },
  committeeRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  committeeChip: {
    backgroundColor: t.colors.surfaces.s400,
    borderRadius: t.radii.sm,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  committeeText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.label,
    fontWeight: t.fontWeights.semibold,
    color: t.colors.text.secondary,
  },
  moreText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.label,
    fontWeight: t.fontWeights.semibold,
    color: t.colors.text.faint,
  },
  activity: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.small,
    color: t.colors.text.secondary,
  },
  activityNum: { fontWeight: t.fontWeights.heavy, color: t.colors.text.primary },
});
