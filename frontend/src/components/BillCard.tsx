import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Bill } from '../data/types';
import { theme } from '../theme/tokens';
import { Card } from './Card';
import { Chip } from './Chip';

interface BillCardProps {
  bill: Pick<Bill, 'id' | 'identifier' | 'title' | 'chamber' | 'status' | 'updatedAt'> & {
    topics?: string[];
    sponsorNames?: string[];
  };
  tracked?: boolean;
  onPress?: () => void;
  onToggleTrack?: () => void;
}

export function BillCard({ bill, tracked = false, onPress, onToggleTrack }: BillCardProps) {
  return (
    <Pressable onPress={onPress} style={styles.pressable}>
      {() => (
        <Card>
          <View style={styles.header}>
            <View style={styles.titleWrap}>
              <Text style={styles.identifier}>{bill.identifier}</Text>
              <Text style={styles.title}>{bill.title}</Text>
            </View>
            <Chip label={tracked ? 'Tracked' : 'Track'} selected={tracked} onPress={onToggleTrack} />
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaText}>
              {bill.chamber} | {bill.status}
            </Text>
            <Text style={styles.metaText}>Updated {bill.updatedAt}</Text>
          </View>
          <Text style={styles.supporters}>
            Chief sponsors: {(bill.sponsorNames ?? []).join(', ') || 'Unavailable'}
          </Text>
          <View style={styles.topicRow}>
            {(bill.topics ?? []).map((topic) => (
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
  title: {
    color: theme.colors.ink,
    fontFamily: theme.typography.title,
    fontSize: 24,
    lineHeight: 30,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  metaText: {
    color: theme.colors.mutedInk,
    fontFamily: theme.typography.mono,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  supporters: {
    color: theme.colors.ink,
    fontFamily: theme.typography.body,
    fontSize: 15,
    lineHeight: 22,
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
