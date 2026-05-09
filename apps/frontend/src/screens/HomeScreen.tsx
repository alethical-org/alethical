import { StyleSheet, Text, TextInput, View } from 'react-native';

import { BillCard } from '../components/BillCard';
import { Card } from '../components/Card';
import { Chip } from '../components/Chip';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenView } from '../components/ScreenView';
import { TickerStrip } from '../components/TickerStrip';
import { useBills, useLegislators, useToggleTrackedBill, useTrackedBills } from '../hooks/useAppQueries';
import { useAuth } from '../providers/AuthProvider';
import { MainTabScreenProps } from '../navigation/types';
import { theme } from '../theme/tokens';
import { useResponsive } from '../hooks/useResponsive';

type Props = MainTabScreenProps<'Home'>;

export function HomeScreen({ navigation }: Props) {
  const { isDesktop } = useResponsive();
  const { user } = useAuth();
  const billsQuery = useBills();
  const legislatorsQuery = useLegislators();
  const trackedQuery = useTrackedBills(user?.id);
  const toggleTrackedBill = useToggleTrackedBill(user?.id);

  const trackedIds = new Set((trackedQuery.data ?? []).map((bill) => bill.id));
  const recentBills = (billsQuery.data ?? []).slice(0, 3);
  const tickerItems = (billsQuery.data ?? []).slice(0, 4).flatMap((bill) => [
    { label: bill.identifier, value: bill.status },
    { label: 'Updated', value: bill.updatedAt },
  ]);

  return (
    <ScreenView
      title="Alethical"
      subtitle="Plain-language legislative intelligence for people who care about what Minnesota government is doing."
      actions={
        <>
          <PrimaryButton label="Find My Legislator" onPress={() => navigation.navigate('FindMyLegislator')} />
          <PrimaryButton
            label="Tracked Bills"
            tone="secondary"
            onPress={() => navigation.navigate('Tabs', { screen: 'Tracked' })}
          />
        </>
      }
    >
      <TickerStrip title="Session Watch" items={tickerItems} />

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

      <View style={[styles.snapshotRow, isDesktop && styles.snapshotRowDesktop]}>
        <Card style={styles.snapshotCard}>
          <Text style={styles.snapshotValue}>{billsQuery.data?.length ?? 0}</Text>
          <Text style={styles.snapshotLabel}>Recent bills in this demo session</Text>
        </Card>
        <Card style={styles.snapshotCard}>
          <Text style={styles.snapshotValue}>{legislatorsQuery.data?.length ?? 0}</Text>
          <Text style={styles.snapshotLabel}>Legislators with profile summaries</Text>
        </Card>
        <Card style={styles.snapshotCard}>
          <Text style={styles.snapshotValue}>{trackedQuery.data?.length ?? 0}</Text>
          <Text style={styles.snapshotLabel}>Bills you are tracking</Text>
        </Card>
      </View>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Recent Bills</Text>
        <Text style={styles.sectionSubtitle}>A calm briefing, not a wall of legislative text.</Text>
      </View>
      <View style={styles.stack}>
        {recentBills.map((bill) => (
          <BillCard
            key={bill.id}
            bill={bill}
            tracked={trackedIds.has(bill.id)}
            onPress={() => navigation.navigate('BillDetail', { billId: bill.id })}
            onToggleTrack={() => toggleTrackedBill.mutate(bill.id)}
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
  snapshotRow: {
    gap: 0,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  snapshotRowDesktop: {
    flexDirection: 'row',
  },
  snapshotCard: {
    flex: 1,
    minHeight: 120,
    justifyContent: 'center',
    borderWidth: 0,
    borderRightWidth: 1,
    borderColor: theme.colors.border,
  },
  snapshotValue: {
    color: theme.colors.ink,
    fontFamily: theme.typography.title,
    fontSize: 38,
  },
  snapshotLabel: {
    color: theme.colors.mutedInk,
    fontFamily: theme.typography.ui,
    fontSize: 15,
    lineHeight: 22,
    textTransform: 'uppercase',
  },
  sectionHeader: {
    gap: theme.spacing.xs,
  },
  sectionTitle: {
    color: theme.colors.ink,
    fontFamily: theme.typography.title,
    fontSize: 28,
  },
  sectionSubtitle: {
    color: theme.colors.mutedInk,
    fontFamily: theme.typography.body,
    fontSize: 15,
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
