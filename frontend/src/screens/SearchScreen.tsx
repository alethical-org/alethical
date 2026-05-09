import { useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { BillCard } from '../components/BillCard';
import { Card } from '../components/Card';
import { Chip } from '../components/Chip';
import { LegislatorCard } from '../components/LegislatorCard';
import { ScreenView } from '../components/ScreenView';
import { useBills, useLegislators, useToggleTrackedBill, useTrackedBills } from '../hooks/useAppQueries';
import { MainTabScreenProps } from '../navigation/types';
import { useAuth } from '../providers/AuthProvider';
import { theme } from '../theme/tokens';
import { useResponsive } from '../hooks/useResponsive';

type SearchMode = 'All' | 'Bills' | 'Legislators';
type Props = MainTabScreenProps<'Search'>;

export function SearchScreen({ navigation }: Props) {
  const { isDesktop } = useResponsive();
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<SearchMode>('All');

  const billsQuery = useBills(query);
  const legislatorsQuery = useLegislators(query);
  const trackedQuery = useTrackedBills(user?.id);
  const toggleTrackedBill = useToggleTrackedBill(user?.id);
  const trackedIds = useMemo(() => new Set((trackedQuery.data ?? []).map((bill) => bill.id)), [trackedQuery.data]);

  const showBills = mode === 'All' || mode === 'Bills';
  const showLegislators = mode === 'All' || mode === 'Legislators';

  return (
    <ScreenView
      title="Search"
      subtitle="Find bills, legislators, and issue areas without having to know the legislature’s internal jargon."
    >
      <Card>
        <Text style={styles.formLabel}>Reporter&apos;s Desk</Text>
        <TextInput
          accessibilityLabel="Search bills and legislators"
          placeholder="Jobs omnibus, Omar Fateh, child welfare, housing..."
          placeholderTextColor={theme.colors.mutedInk}
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
        />
        <View style={styles.modeRow}>
          {(['All', 'Bills', 'Legislators'] as SearchMode[]).map((value) => (
            <Chip key={value} label={value} selected={mode === value} onPress={() => setMode(value)} />
          ))}
        </View>
      </Card>

      <View style={[styles.resultsGrid, isDesktop && styles.resultsGridDesktop]}>
        {showBills ? (
          <View style={styles.column}>
            <Text style={styles.columnTitle}>Bills</Text>
            <View style={styles.stack}>
              {billsQuery.isLoading ? (
                <Card>
                  <Text style={styles.bodyText}>Loading bills from the backend.</Text>
                </Card>
              ) : null}
              {billsQuery.error ? (
                <Card>
                  <Text style={styles.bodyText}>
                    {billsQuery.error instanceof Error ? billsQuery.error.message : 'Bills could not be loaded.'}
                  </Text>
                </Card>
              ) : null}
              {!billsQuery.isLoading && !billsQuery.error && (billsQuery.data ?? []).length === 0 ? (
                <Card>
                  <Text style={styles.bodyText}>No bills match this search.</Text>
                </Card>
              ) : null}
              {(billsQuery.data ?? []).map((bill) => (
                  <BillCard
                    key={bill.id}
                    bill={bill}
                    tracked={trackedIds.has(bill.id)}
                    onPress={() => navigation.navigate('BillDetail', { billId: bill.id })}
                    onToggleTrack={() => toggleTrackedBill.mutate(bill.id)}
                  />
                ))}
            </View>
          </View>
        ) : null}

        {showLegislators ? (
          <View style={[styles.column, isDesktop && styles.rightColumn]}>
            <Text style={styles.columnTitle}>Legislators</Text>
            <View style={styles.stack}>
              {legislatorsQuery.isLoading ? (
                <Card>
                  <Text style={styles.bodyText}>Loading legislators from the backend.</Text>
                </Card>
              ) : null}
              {legislatorsQuery.error ? (
                <Card>
                  <Text style={styles.bodyText}>
                    {legislatorsQuery.error instanceof Error ? legislatorsQuery.error.message : 'Legislators could not be loaded.'}
                  </Text>
                </Card>
              ) : null}
              {!legislatorsQuery.isLoading && !legislatorsQuery.error && (legislatorsQuery.data ?? []).length === 0 ? (
                <Card>
                  <Text style={styles.bodyText}>No legislators match this search.</Text>
                </Card>
              ) : null}
              {(legislatorsQuery.data ?? []).map((legislator) => (
                <LegislatorCard
                  key={legislator.id}
                  legislator={legislator}
                  onPress={() =>
                    navigation.navigate('LegislatorProfile', { legislatorId: legislator.id })
                  }
                />
              ))}
            </View>
          </View>
        ) : null}
      </View>
    </ScreenView>
  );
}

const styles = StyleSheet.create({
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
  modeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  formLabel: {
    color: theme.colors.accent,
    fontFamily: theme.typography.ui,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.4,
  },
  resultsGrid: {
    gap: theme.spacing.lg,
  },
  resultsGridDesktop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  column: {
    flex: 1,
    gap: theme.spacing.md,
  },
  rightColumn: {
    borderLeftWidth: 1,
    borderLeftColor: theme.colors.border,
    paddingLeft: theme.spacing.lg,
  },
  columnTitle: {
    color: theme.colors.ink,
    fontFamily: theme.typography.title,
    fontSize: 28,
  },
  stack: {
    gap: theme.spacing.md,
  },
  bodyText: {
    color: theme.colors.ink,
    fontFamily: theme.typography.body,
    fontSize: 15,
    lineHeight: 23,
  },
});
