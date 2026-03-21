import { PropsWithChildren } from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';

import { Card } from './Card';
import { theme } from '../theme/tokens';

interface SectionCardProps extends PropsWithChildren {
  title: string;
  eyebrow?: string;
  style?: ViewStyle;
}

export function SectionCard({ title, eyebrow, children, style }: SectionCardProps) {
  return (
    <Card style={style}>
      <View style={styles.header}>
        {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
        <Text style={styles.title}>{title}</Text>
      </View>
      {children}
    </Card>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: theme.spacing.xs,
  },
  eyebrow: {
    color: theme.colors.accent,
    fontFamily: theme.typography.ui,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  title: {
    color: theme.colors.ink,
    fontFamily: theme.typography.title,
    fontSize: 28,
  },
});
