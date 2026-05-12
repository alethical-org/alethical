import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

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
const RECENT_BILLS_PAGE_SIZE = 5;

export function HomeScreen({ navigation }: Props) {
  const { isSignedIn, signInWithGoogle, user } = useAuth();
  const [recentPage, setRecentPage] = useState(0);
  const billsQuery = useBills();
  const trackedQuery = useTrackedBills(user?.id);
  const toggleTrackedBill = useToggleTrackedBill(user?.id);

  const trackedIds = new Set((trackedQuery.data ?? []).map((bill) => bill.id));
  const allRecentBills = billsQuery.data ?? [];
  const totalRecentPages = Math.max(1, Math.ceil(allRecentBills.length / RECENT_BILLS_PAGE_SIZE));
  const safeRecentPage = Math.min(recentPage, totalRecentPages - 1);
  const recentBills = useMemo(
    () => allRecentBills.slice(
      safeRecentPage * RECENT_BILLS_PAGE_SIZE,
      safeRecentPage * RECENT_BILLS_PAGE_SIZE + RECENT_BILLS_PAGE_SIZE
    ),
    [allRecentBills, safeRecentPage]
  );
  const recentStart = allRecentBills.length === 0 ? 0 : safeRecentPage * RECENT_BILLS_PAGE_SIZE + 1;
  const recentEnd = Math.min(allRecentBills.length, recentStart + recentBills.length - 1);

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
        </View>
      </Card>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Recent Bills</Text>
        <Text style={styles.sectionMeta}>
          {allRecentBills.length > 0
            ? `${recentStart}-${recentEnd} of ${allRecentBills.length}`
            : 'No bills available'}
        </Text>
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
      {totalRecentPages > 1 ? (
        <View style={styles.paginationRow}>
          <Pressable
            accessibilityRole="button"
            disabled={safeRecentPage === 0}
            onPress={() => setRecentPage((page) => Math.max(0, page - 1))}
            style={({ pressed }) => [
              styles.pageButton,
              safeRecentPage === 0 && styles.pageButtonDisabled,
              pressed && safeRecentPage > 0 && styles.pageButtonPressed,
            ]}
          >
            <Text style={[styles.pageButtonText, safeRecentPage === 0 && styles.pageButtonTextDisabled]}>
              Previous
            </Text>
          </Pressable>
          <Text style={styles.pageIndicator}>Page {safeRecentPage + 1} of {totalRecentPages}</Text>
          <Pressable
            accessibilityRole="button"
            disabled={safeRecentPage >= totalRecentPages - 1}
            onPress={() => setRecentPage((page) => Math.min(totalRecentPages - 1, page + 1))}
            style={({ pressed }) => [
              styles.pageButton,
              safeRecentPage >= totalRecentPages - 1 && styles.pageButtonDisabled,
              pressed && safeRecentPage < totalRecentPages - 1 && styles.pageButtonPressed,
            ]}
          >
            <Text style={[
              styles.pageButtonText,
              safeRecentPage >= totalRecentPages - 1 && styles.pageButtonTextDisabled,
            ]}>
              Next
            </Text>
          </Pressable>
        </View>
      ) : null}

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
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  sectionTitle: {
    color: theme.colors.ink,
    fontFamily: theme.typography.title,
    fontSize: 28,
  },
  sectionMeta: {
    color: theme.colors.mutedInk,
    fontFamily: theme.typography.ui,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.9,
    textTransform: 'uppercase',
  },
  stack: {
    gap: theme.spacing.md,
  },
  paginationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  pageButton: {
    minHeight: 42,
    minWidth: 112,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.md,
  },
  pageButtonPressed: {
    opacity: 0.78,
  },
  pageButtonDisabled: {
    borderColor: theme.colors.surfaceAlt,
    opacity: 0.55,
  },
  pageButtonText: {
    color: theme.colors.ink,
    fontFamily: theme.typography.ui,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  pageButtonTextDisabled: {
    color: theme.colors.mutedInk,
  },
  pageIndicator: {
    color: theme.colors.mutedInk,
    fontFamily: theme.typography.body,
    fontSize: 14,
  },
  topicRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
});
