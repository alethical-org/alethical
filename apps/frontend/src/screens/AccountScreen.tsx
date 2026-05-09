import { StyleSheet, Text, View } from 'react-native';

import { AuthRequiredCard } from '../components/AuthRequiredCard';
import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenView } from '../components/ScreenView';
import {
  useCurrentUser,
  useNotificationPreference,
  useSavedPlaces,
  useUpdateNotificationPreference,
} from '../hooks/useAppQueries';
import { MainTabScreenProps } from '../navigation/types';
import { useAuth } from '../providers/AuthProvider';
import { theme } from '../theme/tokens';

type Props = MainTabScreenProps<'Account'>;

export function AccountScreen(_: Props) {
  const { isSignedIn, user, signOut } = useAuth();
  const currentUserQuery = useCurrentUser();
  const notificationPreferenceQuery = useNotificationPreference(user?.id);
  const savedPlacesQuery = useSavedPlaces(user?.id);
  const updateNotificationPreference = useUpdateNotificationPreference(user?.id);

  if (!isSignedIn) {
    return (
      <ScreenView title="Account" subtitle="Account settings are available after sign-in.">
        <AuthRequiredCard message="Sign in with Google to manage your Alethical account." />
      </ScreenView>
    );
  }

  return (
    <ScreenView title="Account" subtitle="Manage your profile, saved places, and notification preferences.">
      <Card>
        <Text style={styles.cardTitle}>Authentication</Text>
        <Text style={styles.bodyText}>{`Signed in as ${currentUserQuery.data?.name ?? user?.name}`}</Text>
        <Text style={styles.bodyText}>{currentUserQuery.data?.email ?? user?.email ?? ''}</Text>
        <View style={styles.actionRow}>
          <PrimaryButton label="Sign Out" tone="secondary" onPress={() => void signOut()} />
        </View>
      </Card>

      <Card>
        <Text style={styles.cardTitle}>Saved Places</Text>
        {(savedPlacesQuery.data ?? []).map((place) => (
          <View key={place.id} style={styles.placeBlock}>
            <Text style={styles.placeLabel}>{place.label}</Text>
            <Text style={styles.bodyText}>{place.address}</Text>
            <Text style={styles.bodyText}>{place.districtSummary}</Text>
          </View>
        ))}
      </Card>

      <Card>
        <Text style={styles.cardTitle}>Notifications</Text>
        {notificationPreferenceQuery.data ? (
          <View style={styles.stack}>
            <View style={styles.preferenceRow}>
              <View style={styles.preferenceText}>
                <Text style={styles.placeLabel}>Bill updates</Text>
                <Text style={styles.bodyText}>Changes to bills you track.</Text>
              </View>
              <PrimaryButton
                label={notificationPreferenceQuery.data.billUpdates ? 'On' : 'Off'}
                tone="secondary"
                onPress={() =>
                  updateNotificationPreference.mutate({
                    key: 'billUpdates',
                    value: !notificationPreferenceQuery.data?.billUpdates,
                  })
                }
              />
            </View>
            <View style={styles.preferenceRow}>
              <View style={styles.preferenceText}>
                <Text style={styles.placeLabel}>Weekly digest</Text>
                <Text style={styles.bodyText}>A smaller roundup of tracked bills and new activity.</Text>
              </View>
              <PrimaryButton
                label={notificationPreferenceQuery.data.weeklyDigest ? 'On' : 'Off'}
                tone="secondary"
                onPress={() =>
                  updateNotificationPreference.mutate({
                    key: 'weeklyDigest',
                    value: !notificationPreferenceQuery.data?.weeklyDigest,
                  })
                }
              />
            </View>
            <View style={styles.preferenceRow}>
              <View style={styles.preferenceText}>
                <Text style={styles.placeLabel}>Hearing alerts</Text>
                <Text style={styles.bodyText}>Get notified when tracked bills are scheduled.</Text>
              </View>
              <PrimaryButton
                label={notificationPreferenceQuery.data.hearingAlerts ? 'On' : 'Off'}
                tone="secondary"
                onPress={() =>
                  updateNotificationPreference.mutate({
                    key: 'hearingAlerts',
                    value: !notificationPreferenceQuery.data?.hearingAlerts,
                  })
                }
              />
            </View>
          </View>
        ) : (
          <Text style={styles.bodyText}>Sign in to manage notification preferences.</Text>
        )}
      </Card>
    </ScreenView>
  );
}

const styles = StyleSheet.create({
  cardTitle: {
    color: theme.colors.ink,
    fontFamily: theme.typography.title,
    fontSize: 24,
  },
  bodyText: {
    color: theme.colors.ink,
    fontFamily: theme.typography.body,
    fontSize: 15,
    lineHeight: 23,
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  placeBlock: {
    gap: theme.spacing.xs,
    paddingTop: theme.spacing.sm,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  placeLabel: {
    color: theme.colors.accent,
    fontFamily: theme.typography.ui,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  stack: {
    gap: theme.spacing.md,
  },
  preferenceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
    alignItems: 'center',
  },
  preferenceText: {
    flex: 1,
    gap: theme.spacing.xs,
  },
});
