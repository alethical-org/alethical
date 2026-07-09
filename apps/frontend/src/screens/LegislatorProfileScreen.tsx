import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';

import { BillCard } from '../components/BillCard';
import { Card } from '../components/Card';
import { Chip } from '../components/Chip';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenView } from '../components/ScreenView';
import { SectionCard } from '../components/SectionCard';
import {
  useLegislator,
  useLegislatorBills,
  useToggleTrackedBill,
  useTrackedBills,
} from '../hooks/useAppQueries';
import { RootStackParamList } from '../navigation/types';
import { useAuth } from '../providers/AuthProvider';
import { theme } from '../theme/tokens';
import { useResponsive } from '../hooks/useResponsive';

type Props = NativeStackScreenProps<RootStackParamList, 'LegislatorProfile'>;
const SPONSORED_BILLS_PAGE_SIZE = 20;

export function LegislatorProfileScreen({ route, navigation }: Props) {
  const { isDesktop } = useResponsive();
  const { isSignedIn, signInWithGoogle, user } = useAuth();
  const [billPage, setBillPage] = useState(0);
  const legislatorQuery = useLegislator(route.params.legislatorId);
  const billsQuery = useLegislatorBills(route.params.legislatorId, {
    limit: SPONSORED_BILLS_PAGE_SIZE,
    offset: billPage * SPONSORED_BILLS_PAGE_SIZE,
  });
  const trackedQuery = useTrackedBills(user?.id);
  const toggleTrackedBill = useToggleTrackedBill(user?.id);

  const legislator = legislatorQuery.data;
  const trackedIds = new Set((trackedQuery.data ?? []).map((item) => item.id));
  const hasBiography = Boolean(
    legislator?.bio && legislator.bio !== 'Live legislator profile loaded from the backend.',
  );
  const sponsoredBills = billsQuery.data?.data ?? [];
  const hasMoreSponsoredBills = billsQuery.data?.page.hasMore ?? false;

  if (legislatorQuery.isLoading) {
    return (
      <ScreenView
        title="Loading legislator"
        subtitle="Fetching the latest profile from the backend."
      >
        <Card>
          <Text style={styles.bodyText}>
            Loading current service, committees, stats, and authored bills.
          </Text>
        </Card>
      </ScreenView>
    );
  }

  if (!legislator) {
    return (
      <ScreenView
        title="Legislator not found"
        subtitle="This profile could not be loaded from the backend."
      >
        <Card>
          <Text style={styles.bodyText}>
            {legislatorQuery.error instanceof Error
              ? legislatorQuery.error.message
              : 'Try returning to search.'}
          </Text>
        </Card>
      </ScreenView>
    );
  }

  return (
    <ScreenView
      title={legislator.name}
      subtitle={`${legislator.chamber} | District ${legislator.district} | ${legislator.party}`}
    >
      <Card style={styles.metaCard}>
        <View style={styles.metaCell}>
          <Text style={styles.metaLabel}>Current Role</Text>
          <Text style={styles.metaValue}>{legislator.role}</Text>
        </View>
        <View style={styles.metaCell}>
          <Text style={styles.metaLabel}>District</Text>
          <Text style={styles.metaValue}>{legislator.district}</Text>
        </View>
        <View style={styles.metaCell}>
          <Text style={styles.metaLabel}>Party</Text>
          <Text style={styles.metaValue}>{legislator.party}</Text>
        </View>
        <View style={styles.metaCell}>
          <Text style={styles.metaLabel}>Committees</Text>
          <Text style={styles.metaValue}>{legislator.committees.length}</Text>
        </View>
      </Card>
      <View style={[styles.grid, isDesktop && styles.gridDesktop]}>
        <View style={styles.mainColumn}>
          {hasBiography ? (
            <SectionCard title="Profile">
              <Text style={styles.bodyText}>{legislator.bio}</Text>
            </SectionCard>
          ) : null}
          <SectionCard title="Contact">
            <View style={styles.contactStack}>
              {legislator.email ? (
                <PrimaryButton
                  label={legislator.email}
                  tone="secondary"
                  onPress={() => void Linking.openURL(`mailto:${legislator.email}`)}
                />
              ) : null}
              {legislator.phone ? (
                <PrimaryButton
                  label={legislator.phone}
                  tone="secondary"
                  onPress={() => void Linking.openURL(`tel:${legislator.phone}`)}
                />
              ) : null}
              {legislator.officeAddress ? (
                <Text style={styles.bodyText}>{legislator.officeAddress}</Text>
              ) : null}
              {legislator.profileUrl ? (
                <PrimaryButton
                  label="Official Profile"
                  tone="secondary"
                  onPress={() => void Linking.openURL(legislator.profileUrl!)}
                />
              ) : null}
              {!legislator.email &&
              !legislator.phone &&
              !legislator.officeAddress &&
              !legislator.profileUrl ? (
                <Text style={styles.bodyText}>No contact details are available yet.</Text>
              ) : null}
            </View>
          </SectionCard>
          <SectionCard title="Committees">
            {legislator.committees.length > 0 ? (
              legislator.committees.map((committee) => (
                <Text key={committee} style={styles.listItem}>
                  • {committee}
                </Text>
              ))
            ) : (
              <Text style={styles.bodyText}>No committee memberships are available yet.</Text>
            )}
          </SectionCard>
          <SectionCard title="Authored Bills">
            <View style={styles.stack}>
              {billsQuery.isLoading ? (
                <Card>
                  <Text style={styles.bodyText}>Loading authored bills.</Text>
                </Card>
              ) : null}
              {billsQuery.error ? (
                <Card>
                  <Text style={styles.bodyText}>
                    {billsQuery.error instanceof Error
                      ? billsQuery.error.message
                      : 'Authored bills could not be loaded.'}
                  </Text>
                </Card>
              ) : null}
              {!billsQuery.isLoading && !billsQuery.error && sponsoredBills.length === 0 ? (
                <Card>
                  <Text style={styles.bodyText}>No authored bills are available yet.</Text>
                </Card>
              ) : null}
              {sponsoredBills.map((bill) => (
                <BillCard
                  key={bill.id}
                  bill={bill}
                  tracked={trackedIds.has(bill.id)}
                  onPress={() => navigation.navigate('BillDetail', { billId: bill.id })}
                  onSponsorPress={(legislatorId) =>
                    navigation.navigate('LegislatorProfile', { legislatorId })
                  }
                  onToggleTrack={() => {
                    if (!isSignedIn) {
                      void signInWithGoogle();
                      return;
                    }
                    toggleTrackedBill.mutate(bill.id);
                  }}
                />
              ))}
              {!billsQuery.isLoading &&
              !billsQuery.error &&
              (billPage > 0 || hasMoreSponsoredBills) ? (
                <View style={styles.paginationRow}>
                  <Chip
                    label="Previous"
                    selected={false}
                    disabled={billPage === 0}
                    onPress={() => setBillPage((page) => Math.max(0, page - 1))}
                  />
                  <Text style={styles.pageText}>Page {billPage + 1}</Text>
                  <Chip
                    label="Next"
                    selected={false}
                    disabled={!hasMoreSponsoredBills}
                    onPress={() => setBillPage((page) => page + 1)}
                  />
                </View>
              ) : null}
            </View>
          </SectionCard>
        </View>

        <View style={[styles.sideColumn, isDesktop && styles.sideColumnDesktop]}>
          <Card>
            <Text style={styles.cardTitle}>Current Service</Text>
            <Text style={styles.bodyText}>{legislator.role}</Text>
            <Text style={styles.bodyText}>
              Focus areas: {legislator.focusAreas.join(', ') || 'Unavailable'}
            </Text>
          </Card>
          <Card>
            <Text style={styles.cardTitle}>Service History</Text>
            {legislator.serviceHistory.map((service) => (
              <Text key={service.id} style={styles.listItem}>
                • {service.startYear}-{service.endYear ?? 'present'} {service.chamber} District{' '}
                {service.district} ({service.party})
              </Text>
            ))}
            {legislator.serviceHistory.length === 0 ? (
              <Text style={styles.bodyText}>No service history is available yet.</Text>
            ) : null}
          </Card>
        </View>
      </View>
    </ScreenView>
  );
}

const styles = StyleSheet.create({
  metaCard: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 0,
  },
  metaCell: {
    minWidth: 180,
    flex: 1,
    padding: theme.spacing.md,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: theme.colors.border,
    gap: theme.spacing.xs,
  },
  metaLabel: {
    color: theme.colors.accent,
    fontFamily: theme.typography.ui,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.4,
  },
  metaValue: {
    color: theme.colors.ink,
    fontFamily: theme.typography.mono,
    fontSize: 12,
    textTransform: 'uppercase',
  },
  grid: {
    gap: theme.spacing.md,
  },
  gridDesktop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  mainColumn: {
    flex: 1.7,
    gap: theme.spacing.md,
  },
  sideColumn: {
    flex: 1,
    gap: theme.spacing.md,
  },
  sideColumnDesktop: {
    borderLeftWidth: 1,
    borderLeftColor: theme.colors.border,
    paddingLeft: theme.spacing.md,
  },
  stack: {
    gap: theme.spacing.md,
  },
  paginationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
  },
  pageText: {
    color: theme.colors.mutedInk,
    fontFamily: theme.typography.ui,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  contactStack: {
    gap: theme.spacing.sm,
    alignItems: 'flex-start',
  },
  bodyText: {
    color: theme.colors.ink,
    fontFamily: theme.typography.body,
    fontSize: 15,
    lineHeight: 23,
  },
  listItem: {
    color: theme.colors.ink,
    fontFamily: theme.typography.body,
    fontSize: 15,
    lineHeight: 24,
  },
  cardTitle: {
    color: theme.colors.ink,
    fontFamily: theme.typography.title,
    fontSize: 22,
  },
});
