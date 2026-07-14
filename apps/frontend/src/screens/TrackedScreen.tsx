import { StyleSheet, Text, View } from 'react-native';

import { BillCard } from '../components/BillCard';
import { AuthRequiredCard } from '../components/AuthRequiredCard';
import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenView } from '../components/ScreenView';
import { useToggleTrackedBill, useTrackedBills } from '../hooks/useAppQueries';
import { MainTabScreenProps } from '../navigation/types';
import { useAuth } from '../providers/AuthProvider';
import { theme } from '../theme/tokens';

type Props = MainTabScreenProps<'Tracked'>;

export function TrackedScreen({ navigation }: Props) {
  const { isSignedIn, user } = useAuth();
  const trackedQuery = useTrackedBills(user?.id);
  const toggleTrackedBill = useToggleTrackedBill(user?.id);
  const bills = trackedQuery.data ?? [];
  const ready = !trackedQuery.isLoading && !trackedQuery.error;

  if (!isSignedIn) {
    return (
      <ScreenView
        title="Tracked Bills"
        subtitle="Tracking is a signed-in feature so your alerts and context persist across devices."
      >
        <AuthRequiredCard
          title="Track the bills you care about"
          message="Sign in to build a watchlist and keep it in sync across devices, so the bills you care about and their current status stay in one place. You can browse and search everything without an account."
          returnTo="/tracked"
        />
      </ScreenView>
    );
  }

  return (
    <ScreenView
      title="Tracked Bills"
      subtitle="Keep a smaller, more manageable watchlist instead of checking everything all the time."
    >
      {trackedQuery.isLoading ? (
        <Card>
          <Text style={styles.bodyText}>Loading tracked bills from the backend.</Text>
        </Card>
      ) : null}
      {trackedQuery.error ? (
        <Card>
          <Text style={styles.bodyText}>
            {trackedQuery.error instanceof Error
              ? trackedQuery.error.message
              : 'Tracked bills could not be loaded.'}
          </Text>
        </Card>
      ) : null}
      {ready && bills.length === 0 ? (
        <Card>
          <Text style={styles.bodyText}>
            You are not tracking any bills yet. Find a bill in search and tap Track to add it to
            your watchlist.
          </Text>
          <PrimaryButton label="Browse bills" onPress={() => navigation.navigate('Search')} />
        </Card>
      ) : null}
      {ready && bills.length > 0 ? (
        <View style={styles.stack}>
          <Text style={styles.summaryText}>
            Tracking {bills.length} {bills.length === 1 ? 'bill' : 'bills'}
          </Text>
          {bills.map((bill) => (
            <BillCard
              key={bill.id}
              bill={bill}
              tracked
              onPress={() => navigation.navigate('BillDetail', { billId: bill.id })}
              onSponsorPress={(legislatorId) =>
                navigation.navigate('LegislatorProfile', { legislatorId })
              }
              onToggleTrack={() => toggleTrackedBill.mutate(bill.id)}
            />
          ))}
        </View>
      ) : null}
    </ScreenView>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: theme.spacing.md,
  },
  bodyText: {
    color: theme.colors.ink,
    fontFamily: theme.typography.body,
    fontSize: 15,
    lineHeight: 23,
  },
  summaryText: {
    color: theme.colors.mutedInk,
    fontFamily: theme.typography.body,
    fontSize: 14,
    lineHeight: 21,
  },
});
