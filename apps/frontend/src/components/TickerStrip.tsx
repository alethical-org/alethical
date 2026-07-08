import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { theme } from '../theme/tokens';

interface TickerItem {
  label: string;
  value: string;
}

interface TickerStripProps {
  title: string;
  items: TickerItem[];
}

export function TickerStrip({ title, items }: TickerStripProps) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{title}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        {items.map((item) => (
          <View key={`${item.label}-${item.value}`} style={styles.item}>
            <Text style={styles.label}>{item.label}</Text>
            <Text style={styles.value}>{item.value}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: theme.colors.ink,
    borderWidth: 1,
    borderColor: theme.colors.ink,
    paddingVertical: theme.spacing.sm,
    gap: theme.spacing.xs,
  },
  title: {
    color: theme.colors.white,
    fontFamily: theme.typography.ui,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.4,
    paddingHorizontal: theme.spacing.md,
    textTransform: 'uppercase',
  },
  content: {
    paddingHorizontal: theme.spacing.md,
    gap: theme.spacing.lg,
  },
  item: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    alignItems: 'center',
  },
  label: {
    color: theme.colors.accent,
    fontFamily: theme.typography.ui,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  value: {
    color: theme.colors.white,
    fontFamily: theme.typography.mono,
    fontSize: 11,
    textTransform: 'uppercase',
  },
});
