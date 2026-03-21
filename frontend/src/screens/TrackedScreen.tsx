import { StyleSheet, Text, View } from 'react-native';

import { BillCard } from '../components/BillCard';
import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenView } from '../components/ScreenView';
import { useToggleTrackedBill, useTrackedBills } from '../hooks/useAppQueries';
import { MainTabScreenProps } from '../navigation/types';
import { useAuth } from '../providers/AuthProvider';
import { theme } from '../theme/tokens';

type Props = MainTabScreenProps<'Tracked'>;

export function TrackedScreen({ navigation }: Props) {
  const { isSignedIn, user, signInDemo } = useAuth();
  const trackedQuery = useTrackedBills(user?.id);
  const toggleTrackedBill = useToggleTrackedBill(user?.id);

  if (!isSignedIn) {
    return (
      <ScreenView title="Tracked Bills" subtitle="Tracking is a signed-in feature so your alerts and context persist across devices.">
        <Card>
          <Text style={styles.bodyText}>Sign in to track bills, save places, and receive updates that matter to you.</Text>
          <PrimaryButton label="Use Demo Sign-In" onPress={signInDemo} />
        </Card>
      </ScreenView>
    );
  }

  return (
    <ScreenView title="Tracked Bills" subtitle="Keep a smaller, more manageable watchlist instead of checking everything all the time.">
      {(trackedQuery.data ?? []).length === 0 ? (
        <Card>
          <Text style={styles.bodyText}>You are not tracking any bills yet.</Text>
        </Card>
      ) : (
        <View style={styles.stack}>
          {(trackedQuery.data ?? []).map((bill) => (
            <BillCard
              key={bill.id}
              bill={bill}
              tracked
              onPress={() => navigation.navigate('BillDetail', { billId: bill.id })}
              onToggleTrack={() => toggleTrackedBill.mutate(bill.id)}
            />
          ))}
        </View>
      )}
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
});
