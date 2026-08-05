import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { theme as t } from '../../theme/tokens';
import { IaItem, MenuKey } from '../../navigation/ia';
import { useAuth } from '../../providers/AuthProvider';
import { useSignInModal } from '../../providers/signInModalContext';
import { useResponsive } from '../../hooks/useResponsive';
import { useTrackedBills } from '../../hooks/useAppQueries';
import { useBillTracking } from '../../hooks/useBillTracking';
import { SearchPageShell } from '../../components/search/searchPieces';
import { BillResultCard } from '../../components/search/BillResultCard';
import { Skeleton } from '../../components/Skeleton';
import { isWeb, useHover } from '../../components/billDetail/interactions';

const SKELETON_ROWS = [0, 1, 2];

// Tracked page, rebuilt in the redesign (green chrome, top nav) so it matches the
// rest of the web app — the old sidebar-rail TrackedScreen was the last surface on
// the pre-redesign shell (#976, part 2). Same shell + BillResultCard as Search, so
// the now-live Track button toggles a bill straight off this list.
export function TrackedBillsScreen() {
  const navigation = useNavigation<any>();
  const { isSignedIn, user } = useAuth();
  const { openSignIn } = useSignInModal();
  const { isTracked, toggleTrack } = useBillTracking();
  const { isMobile } = useResponsive();
  const [openMenu, setOpenMenu] = useState<MenuKey | null>(null);

  const trackedQuery = useTrackedBills(user?.id);
  const bills = trackedQuery.data ?? [];

  const handleNavigate = (item: IaItem) => {
    switch (item.id) {
      case 'search-bills':
        navigation.navigate('Bills');
        return;
      case 'search-legislators':
        navigation.navigate('Legislators');
        return;
      case 'search-find-my-legislator':
        navigation.navigate('FindMyLegislator');
        return;
      case 'track-bills':
        navigation.navigate('Tracked');
        return;
      default:
        return;
    }
  };

  const hero = (
    <View>
      <Text accessibilityRole="header" style={[styles.h1, isMobile && styles.h1Mobile]}>
        Tracked bills
      </Text>
      <Text style={styles.subhead}>
        The bills you’re following, in one place. Tap Track on any bill to add or remove it.
      </Text>
    </View>
  );

  let body: React.ReactNode;
  if (!isSignedIn) {
    // Tracking needs an account — the value-prop card, with sign-in returning here.
    body = (
      <EmptyCard
        heading="Track the bills you care about"
        body="Sign in to build a watchlist that stays in sync across devices, so the bills you’re following and their current status stay in one place. You can browse and search everything without an account."
        ctaLabel="Sign in"
        onPress={() => openSignIn({ intent: 'nav', returnTo: '/tracked' })}
      />
    );
  } else if (trackedQuery.isLoading) {
    body = (
      <View style={styles.list} accessible accessibilityLabel="Loading tracked bills">
        {SKELETON_ROWS.map((i) => (
          <Skeleton key={i} width="100%" height={148} radius={t.radii.card} />
        ))}
      </View>
    );
  } else if (trackedQuery.error) {
    body = (
      <View style={styles.stateBox}>
        <Text style={styles.stateText}>
          We couldn’t load your tracked bills right now. Please try again in a moment.
        </Text>
      </View>
    );
  } else if (bills.length === 0) {
    body = (
      <EmptyCard
        heading="You’re not tracking any bills yet"
        body="Find a bill in search and tap Track to add it to your watchlist."
        ctaLabel="Browse bills"
        onPress={() => navigation.navigate('Bills')}
      />
    );
  } else {
    body = (
      <>
        <Text style={styles.count}>
          Tracking {bills.length} {bills.length === 1 ? 'bill' : 'bills'}
        </Text>
        <View style={styles.list}>
          {bills.map((bill) => (
            <BillResultCard
              key={bill.id}
              bill={bill}
              tracked={isTracked(bill.id)}
              onToggleTrack={() => toggleTrack(bill.id)}
              onPress={() => navigation.navigate('BillDetail', { billId: bill.id })}
              onSponsorPress={(legislatorId) =>
                navigation.navigate('LegislatorProfile', { legislatorId })
              }
              onRollCalls={() =>
                navigation.navigate('BillDetail', { billId: bill.id, tab: 'votes' })
              }
            />
          ))}
        </View>
      </>
    );
  }

  return (
    <SearchPageShell
      openMenu={openMenu}
      onOpenMenuChange={setOpenMenu}
      onNavigate={handleNavigate}
      onHome={() => navigation.navigate('Tabs', { screen: 'Home' })}
      onAsk={() => navigation.navigate('Ask')}
      onPrivacy={() => navigation.navigate('Privacy')}
      onTerms={() => navigation.navigate('Terms')}
      hero={hero}
    >
      {body}
    </SearchPageShell>
  );
}

// Dashed value-prop / empty card with a single green CTA, matching Search's
// NoResults treatment so the Tracked page's empty and signed-out states read as
// the same family.
function EmptyCard({
  heading,
  body,
  ctaLabel,
  onPress,
}: {
  heading: string;
  body: string;
  ctaLabel: string;
  onPress: () => void;
}) {
  const [hovered, hover] = useHover();
  return (
    <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.cardHeading}>
        {heading}
      </Text>
      <Text style={styles.cardBody}>{body}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={ctaLabel}
        onPress={onPress}
        {...hover}
        style={[styles.cta, hovered && styles.ctaHover]}
      >
        <Text style={styles.ctaText}>{ctaLabel}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  h1: {
    fontFamily: t.typography.title,
    fontSize: 58,
    lineHeight: 58,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -1.16,
    color: t.colors.text.primary,
  },
  h1Mobile: { fontSize: 40, lineHeight: 42, letterSpacing: -0.8 },
  subhead: {
    marginTop: 16,
    maxWidth: 640,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.lg,
    lineHeight: 26,
    color: t.colors.text.muted,
  },
  count: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.meta,
    fontWeight: t.fontWeights.semibold,
    letterSpacing: 0.2,
    color: t.colors.text.muted,
  },
  list: { marginTop: 22, gap: 18 },
  stateBox: {
    paddingVertical: 64,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  stateText: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.lg,
    color: t.colors.text.muted,
    textAlign: 'center',
  },
  card: {
    maxWidth: 860,
    width: '100%',
    alignSelf: 'center',
    marginTop: 34,
    alignItems: 'center',
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: t.colors.alpha.ink20,
    borderRadius: 20,
    paddingVertical: 56,
    paddingHorizontal: 48,
  },
  cardHeading: {
    fontFamily: t.typography.title,
    fontSize: t.fontSizes.h1,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.28,
    color: t.colors.text.primary,
    textAlign: 'center',
  },
  cardBody: {
    marginTop: 12,
    maxWidth: 560,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.lg,
    lineHeight: 25,
    color: t.colors.text.muted,
    textAlign: 'center',
  },
  cta: {
    marginTop: 24,
    backgroundColor: t.colors.brand.base,
    borderRadius: t.radii.md,
    paddingVertical: 12,
    paddingHorizontal: 22,
    ...(isWeb
      ? ({ transitionProperty: 'background-color', transitionDuration: '0.15s' } as object)
      : null),
  },
  ctaHover: { backgroundColor: t.colors.brand.deep },
  ctaText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.bodyLg,
    fontWeight: t.fontWeights.semibold,
    color: t.colors.text.onGreen,
  },
});
