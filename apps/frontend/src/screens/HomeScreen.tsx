import { StyleSheet, Text, TextInput, View } from 'react-native';

import { BillCard } from '../components/BillCard';
import { Card } from '../components/Card';
import { Chip } from '../components/Chip';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenView } from '../components/ScreenView';
import { useBills, useToggleTrackedBill, useTrackedBills } from '../hooks/useAppQueries';
import { useAuth } from '../providers/AuthProvider';
import { MainTabScreenProps } from '../navigation/types';
import { theme } from '../theme/tokens';

type Props = MainTabScreenProps<'Home'>;

export function HomeScreen({ navigation }: Props) {
  const { isSignedIn, signInWithGoogle, user } = useAuth();
  const billsQuery = useBills();
  const trackedQuery = useTrackedBills(user?.id);
  const toggleTrackedBill = useToggleTrackedBill(user?.id);

  const trackedIds = new Set((trackedQuery.data ?? []).map((bill) => bill.id));
  const recentBills = (billsQuery.data ?? []).slice(0, 3);

  return (
    <ScreenView
      hideMasthead
      hideHeader
    >
      <Card style={styles.heroCard}>
        <Text style={styles.heroEyebrow}>Start here</Text>
        <TextInput
          accessibilityLabel="Search bills or legislators"
          placeholder="Search bills, legislators, or topics"
          placeholderTextColor={theme.colors.mutedInk}
          style={styles.searchInput}
          onFocus={() => navigation.navigate('Tabs', { screen: 'Search' })}
        />
        <View style={styles.quickActionRow}>
          <PrimaryButton label="Open Search" onPress={() => navigation.navigate('Tabs', { screen: 'Search' })} />
          <PrimaryButton
            label="Ask Chat"
            tone="secondary"
            onPress={() =>
              navigation.navigate('ChatSession', {
                title: 'General civic question',
                seedPrompt: 'What are the biggest bills moving this week?',
                subjectType: 'general',
              })
            }
          />
        </View>
      </Card>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Recent Bills</Text>
      </View>
      <View style={styles.stack}>
        {recentBills.map((bill) => (
          <BillCard
            key={bill.id}
            bill={bill}
            tracked={trackedIds.has(bill.id)}
            onPress={() => navigation.navigate('BillDetail', { billId: bill.id })}
            onSponsorPress={(legislatorId) => navigation.navigate('LegislatorProfile', { legislatorId })}
            onToggleTrack={() => {
              if (!isSignedIn) {
                void signInWithGoogle();
                return;
              }
              toggleTrackedBill.mutate(bill.id);
            }}
          />
        ))}
      </View>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Explore By Topic</Text>
      </View>
      <View style={styles.topicRow}>
        {['Education', 'Labor', 'Children', 'Housing', 'Budget'].map((topic) => (
          <Chip
            key={topic}
            label={topic}
            onPress={() => navigation.navigate('Tabs', { screen: 'Search' })}
          />
        ))}
      </View>
    </ScreenView>
  );
}

const styles = StyleSheet.create({
  heroCard: {
    backgroundColor: theme.colors.surfaceAlt,
    borderColor: theme.colors.border,
  },
  heroEyebrow: {
    color: theme.colors.accent,
    fontFamily: theme.typography.ui,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.4,
  },
  searchInput: {
    minHeight: 52,
    borderRadius: theme.radii.md,
    borderBottomWidth: 2,
    borderColor: theme.colors.border,
    backgroundColor: 'transparent',
    paddingHorizontal: 0,
    color: theme.colors.ink,
    fontFamily: theme.typography.mono,
    fontSize: 15,
  },
  quickActionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  sectionHeader: {
    gap: theme.spacing.xs,
  },
  sectionTitle: {
    color: theme.colors.ink,
    fontFamily: theme.typography.title,
    fontSize: 28,
  },
  stack: {
    gap: theme.spacing.md,
  },
  topicRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
});
