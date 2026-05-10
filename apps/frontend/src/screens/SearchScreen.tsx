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
const BILLS_PAGE_SIZE = 5;
const LEGISLATORS_PAGE_SIZE = 8;

export function SearchScreen({ navigation }: Props) {
  const { isDesktop } = useResponsive();
  const { isSignedIn, signInWithGoogle, user } = useAuth();
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<SearchMode>('All');
  const [billPage, setBillPage] = useState(0);
  const [legislatorPage, setLegislatorPage] = useState(0);

  const billsQuery = useBills(query);
  const legislatorsQuery = useLegislators(query);
  const trackedQuery = useTrackedBills(user?.id);
  const toggleTrackedBill = useToggleTrackedBill(user?.id);
  const trackedIds = useMemo(() => new Set((trackedQuery.data ?? []).map((bill) => bill.id)), [trackedQuery.data]);

  const showBills = mode === 'All' || mode === 'Bills';
  const showLegislators = mode === 'All' || mode === 'Legislators';
  const bills = billsQuery.data ?? [];
  const billPageCount = Math.max(1, Math.ceil(bills.length / BILLS_PAGE_SIZE));
  const safeBillPage = Math.min(billPage, billPageCount - 1);
  const pagedBills = bills.slice(
    safeBillPage * BILLS_PAGE_SIZE,
    safeBillPage * BILLS_PAGE_SIZE + BILLS_PAGE_SIZE
  );
  const legislators = legislatorsQuery.data ?? [];
  const legislatorPageCount = Math.max(1, Math.ceil(legislators.length / LEGISLATORS_PAGE_SIZE));
  const safeLegislatorPage = Math.min(legislatorPage, legislatorPageCount - 1);
  const pagedLegislators = legislators.slice(
    safeLegislatorPage * LEGISLATORS_PAGE_SIZE,
    safeLegislatorPage * LEGISLATORS_PAGE_SIZE + LEGISLATORS_PAGE_SIZE
  );

  return (
    <ScreenView
      hideHeader
    >
      <Card>
        <TextInput
          accessibilityLabel="Search bills and legislators"
          placeholder="Jobs omnibus, child welfare, housing, tax credits..."
          placeholderTextColor={theme.colors.mutedInk}
          style={styles.searchInput}
          value={query}
          onChangeText={(value) => {
            setQuery(value);
            setBillPage(0);
            setLegislatorPage(0);
          }}
        />
        <View style={styles.modeRow}>
          {(['All', 'Bills', 'Legislators'] as SearchMode[]).map((value) => (
            <Chip
              key={value}
              label={value}
              selected={mode === value}
              onPress={() => {
                setMode(value);
                setBillPage(0);
                setLegislatorPage(0);
              }}
            />
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
              {pagedBills.map((bill) => (
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
              {!billsQuery.isLoading && !billsQuery.error && bills.length > BILLS_PAGE_SIZE ? (
                <View style={styles.paginationRow}>
                  <Chip
                    label="Previous"
                    selected={false}
                    onPress={() => setBillPage((page) => Math.max(0, page - 1))}
                  />
                  <Text style={styles.pageText}>
                    {safeBillPage + 1} / {billPageCount}
                  </Text>
                  <Chip
                    label="Next"
                    selected={false}
                    onPress={() => setBillPage((page) => Math.min(billPageCount - 1, page + 1))}
                  />
                </View>
              ) : null}
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
              {pagedLegislators.map((legislator) => (
                <LegislatorCard
                  key={legislator.id}
                  legislator={legislator}
                  onPress={() =>
                    navigation.navigate('LegislatorProfile', { legislatorId: legislator.id })
                  }
                />
              ))}
              {!legislatorsQuery.isLoading && !legislatorsQuery.error && legislators.length > LEGISLATORS_PAGE_SIZE ? (
                <View style={styles.paginationRow}>
                  <Chip
                    label="Previous"
                    selected={false}
                    onPress={() => setLegislatorPage((page) => Math.max(0, page - 1))}
                  />
                  <Text style={styles.pageText}>
                    {safeLegislatorPage + 1} / {legislatorPageCount}
                  </Text>
                  <Chip
                    label="Next"
                    selected={false}
                    onPress={() => setLegislatorPage((page) => Math.min(legislatorPageCount - 1, page + 1))}
                  />
                </View>
              ) : null}
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
  paginationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  pageText: {
    color: theme.colors.mutedInk,
    fontFamily: theme.typography.mono,
    fontSize: 12,
    fontWeight: '700',
  },
});
