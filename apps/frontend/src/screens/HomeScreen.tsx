import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BookmarkCheck, MapPin, MessageSquareText, Search } from 'lucide-react-native';

import { BillCard } from '../components/BillCard';
import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenView } from '../components/ScreenView';
import { useBills, useToggleTrackedBill, useTrackedBills } from '../hooks/useAppQueries';
import { MainTabScreenProps } from '../navigation/types';
import { useAuth } from '../providers/AuthProvider';
import { theme } from '../theme/tokens';

type Props = MainTabScreenProps<'Home'>;

export function HomeScreen({ navigation }: Props) {
  const { isSignedIn, signInWithGoogle, user } = useAuth();
  const billsQuery = useBills();
  const trackedQuery = useTrackedBills(user?.id);
  const toggleTrackedBill = useToggleTrackedBill(user?.id);
  const trackedIds = useMemo(() => new Set((trackedQuery.data ?? []).map((bill) => bill.id)), [trackedQuery.data]);
  const recentBills = (billsQuery.data?.data ?? []).slice(0, 4);

  return (
    <ScreenView title="Alethical" subtitle="Minnesota legislative intelligence for search, tracking, and grounded bill questions.">
      <View style={styles.quickGrid}>
        <QuickAction
          label="Search Bills"
          caption="Browse bills and legislators"
          Icon={Search}
          onPress={() => navigation.navigate('Search')}
        />
        <QuickAction
          label="Find My Rep"
          caption="Address or map lookup"
          Icon={MapPin}
          onPress={() => navigation.navigate('FindMyLegislator')}
        />
        <QuickAction
          label="Tracked Bills"
          caption="Signed-in watchlist"
          Icon={BookmarkCheck}
          onPress={() => navigation.navigate('Tracked')}
        />
        <QuickAction
          label="Chat"
          caption="Ask cited questions"
          Icon={MessageSquareText}
          onPress={() => navigation.navigate('Chat')}
        />
      </View>

      {!isSignedIn ? (
        <Card>
          <Text style={styles.cardTitle}>Prototype account flow</Text>
          <Text style={styles.bodyText}>
            Public search and representative lookup work without an account. Sign in when you want tracking, saved history, and bill chat.
          </Text>
          <PrimaryButton label="Continue With Google" onPress={() => void signInWithGoogle()} />
        </Card>
      ) : null}

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Recent Bills</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open search"
          onPress={() => navigation.navigate('Search')}
          style={({ pressed }) => [styles.linkButton, pressed && styles.pressed]}
        >
          <Text style={styles.linkText}>View all</Text>
        </Pressable>
      </View>

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
        {!billsQuery.isLoading && !billsQuery.error && recentBills.length === 0 ? (
          <Card>
            <Text style={styles.bodyText}>No bills are available yet.</Text>
          </Card>
        ) : null}
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

      <View style={styles.legalLinks}>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="Open Privacy Policy"
          onPress={() => navigation.navigate('Privacy')}
          style={({ pressed }) => [styles.legalLink, pressed && styles.pressed]}
        >
          <Text style={styles.legalLinkText}>Privacy Policy</Text>
        </Pressable>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="Open Terms of Service"
          onPress={() => navigation.navigate('Terms')}
          style={({ pressed }) => [styles.legalLink, pressed && styles.pressed]}
        >
          <Text style={styles.legalLinkText}>Terms of Service</Text>
        </Pressable>
      </View>
    </ScreenView>
  );
}

function QuickAction({
  label,
  caption,
  Icon,
  onPress,
}: {
  label: string;
  caption: string;
  Icon: typeof Search;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.quickAction, pressed && styles.pressed]}
    >
      <View style={styles.quickIcon}>
        <Icon color={theme.colors.ink} size={22} strokeWidth={2.1} />
      </View>
      <View style={styles.quickCopy}>
        <Text style={styles.quickTitle}>{label}</Text>
        <Text style={styles.quickCaption}>{caption}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  quickGrid: {
    gap: theme.spacing.sm,
  },
  quickAction: {
    minHeight: 70,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.sm,
  },
  quickIcon: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceAlt,
  },
  quickCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  quickTitle: {
    color: theme.colors.ink,
    fontFamily: theme.typography.ui,
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  quickCaption: {
    color: theme.colors.mutedInk,
    fontFamily: theme.typography.body,
    fontSize: 13,
    lineHeight: 18,
  },
  cardTitle: {
    color: theme.colors.ink,
    fontFamily: theme.typography.title,
    fontSize: 22,
  },
  bodyText: {
    color: theme.colors.ink,
    fontFamily: theme.typography.body,
    fontSize: 14,
    lineHeight: 21,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
    borderBottomWidth: 4,
    borderBottomColor: theme.colors.border,
    paddingBottom: theme.spacing.sm,
  },
  sectionTitle: {
    color: theme.colors.ink,
    fontFamily: theme.typography.title,
    fontSize: 26,
  },
  linkButton: {
    minHeight: 44,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing.md,
  },
  linkText: {
    color: theme.colors.ink,
    fontFamily: theme.typography.ui,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1.1,
  },
  stack: {
    gap: theme.spacing.md,
  },
  legalLinks: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingTop: theme.spacing.md,
  },
  legalLink: {
    minHeight: 44,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing.md,
  },
  legalLinkText: {
    color: theme.colors.ink,
    fontFamily: theme.typography.ui,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  pressed: {
    opacity: 0.78,
  },
});
