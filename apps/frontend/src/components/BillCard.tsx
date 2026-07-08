import { GestureResponderEvent, Pressable, StyleSheet, Text, View } from 'react-native';

import { Bill } from '../data/types';
import { theme } from '../theme/tokens';
import { Card } from './Card';
import { Chip } from './Chip';

interface BillCardProps {
  bill: Pick<
    Bill,
    | 'id'
    | 'identifier'
    | 'title'
    | 'chamber'
    | 'status'
    | 'updatedAt'
    | 'aiAnalysis'
    | 'chiefSponsorIds'
  > & {
    topics?: string[];
    sponsorNames?: string[];
  };
  tracked?: boolean;
  onPress?: () => void;
  onToggleTrack?: () => void;
  onSponsorPress?: (legislatorId: string) => void;
}

export function BillCard({
  bill,
  tracked = false,
  onPress,
  onToggleTrack,
  onSponsorPress,
}: BillCardProps) {
  const summary = bill.aiAnalysis?.summary ?? bill.title;
  const policyAreas = bill.aiAnalysis?.policyAreas ?? [];
  const meta = [
    bill.chamber,
    bill.status,
    bill.updatedAt !== 'Unknown' ? `Updated ${bill.updatedAt}` : null,
  ]
    .filter(Boolean)
    .join(' | ');
  const sponsors = (bill.sponsorNames ?? []).map((name, index) => ({
    name,
    legislatorId: bill.chiefSponsorIds[index],
  }));

  return (
    <Pressable onPress={onPress} style={styles.pressable}>
      {() => (
        <Card>
          <View style={styles.header}>
            <View style={styles.titleWrap}>
              <Text style={styles.identifier}>{bill.identifier}</Text>
            </View>
            <Chip
              label={tracked ? 'Tracked' : 'Track'}
              selected={tracked}
              onPress={onToggleTrack}
            />
          </View>
          <View style={styles.summaryBlock}>
            <Text style={styles.summaryText}>{summary}</Text>
          </View>
          <View style={styles.metaBlock}>
            <Text style={styles.metaText}>{meta}</Text>
            <View style={styles.authorRow}>
              <Text style={styles.authorText}>Author: </Text>
              {sponsors.length > 0 ? (
                sponsors.map((sponsor, index) => {
                  const clickable = Boolean(sponsor.legislatorId && onSponsorPress);
                  return (
                    <Pressable
                      key={`${sponsor.legislatorId ?? sponsor.name}-${index}`}
                      accessibilityRole={clickable ? 'link' : undefined}
                      disabled={!clickable}
                      onPress={(event: GestureResponderEvent) => {
                        event.stopPropagation();
                        if (sponsor.legislatorId) {
                          onSponsorPress?.(sponsor.legislatorId);
                        }
                      }}
                    >
                      <Text style={[styles.authorText, clickable && styles.authorLink]}>
                        {sponsor.name}
                        {index < sponsors.length - 1 ? ', ' : ''}
                      </Text>
                    </Pressable>
                  );
                })
              ) : (
                <Text style={styles.authorText}>Unavailable</Text>
              )}
            </View>
          </View>
          <View style={styles.topicRow}>
            {(policyAreas.length > 0 ? policyAreas : (bill.topics ?? [])).map((topic) => (
              <View key={topic} style={styles.topicPill}>
                <Text style={styles.topicLabel}>{topic}</Text>
              </View>
            ))}
          </View>
        </Card>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressable: {
    width: '100%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: theme.spacing.md,
  },
  titleWrap: {
    flex: 1,
    gap: theme.spacing.xs,
  },
  identifier: {
    color: theme.colors.accent,
    fontFamily: theme.typography.ui,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  summaryBlock: {
    gap: theme.spacing.xs,
  },
  summaryText: {
    color: theme.colors.ink,
    fontFamily: theme.typography.body,
    fontSize: 16,
    lineHeight: 24,
  },
  metaBlock: {
    gap: theme.spacing.xs,
  },
  metaText: {
    color: theme.colors.mutedInk,
    fontFamily: theme.typography.mono,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  authorText: {
    color: theme.colors.ink,
    fontFamily: theme.typography.body,
    fontSize: 14,
    lineHeight: 20,
  },
  authorRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
  },
  authorLink: {
    color: theme.colors.accent,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  topicRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  topicPill: {
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radii.pill,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  topicLabel: {
    color: theme.colors.mutedInk,
    fontFamily: theme.typography.ui,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
});
