import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Legislator } from '../data/types';
import { Card } from './Card';
import { theme } from '../theme/tokens';

interface LegislatorCardProps {
  legislator: Legislator;
  onPress?: () => void;
}

export function LegislatorCard({ legislator, onPress }: LegislatorCardProps) {
  return (
    <Pressable onPress={onPress}>
      {() => (
        <Card>
          <Text style={styles.name}>{legislator.name}</Text>
          <Text style={styles.meta}>
            {legislator.chamber} | District {legislator.district} | {legislator.party}
          </Text>
          <Text style={styles.bio}>{legislator.bio}</Text>
          <View style={styles.focusRow}>
            {legislator.focusAreas.map((area) => (
              <View key={area} style={styles.focusPill}>
                <Text style={styles.focusLabel}>{area}</Text>
              </View>
            ))}
          </View>
        </Card>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  name: {
    color: theme.colors.ink,
    fontFamily: theme.typography.title,
    fontSize: 24,
  },
  meta: {
    color: theme.colors.mutedInk,
    fontFamily: theme.typography.mono,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  bio: {
    color: theme.colors.ink,
    fontFamily: theme.typography.body,
    fontSize: 15,
    lineHeight: 22,
  },
  focusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  focusPill: {
    backgroundColor: theme.colors.infoSoft,
    borderRadius: theme.radii.pill,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  focusLabel: {
    color: theme.colors.info,
    fontFamily: theme.typography.ui,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
});
