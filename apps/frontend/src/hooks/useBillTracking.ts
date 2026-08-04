import { useCallback, useMemo } from 'react';

import { useAuth } from '../providers/AuthProvider';
import { trackSignInReturnTo } from '../navigation/webRoutes';
import { useToggleTrackedBill, useTrackedBills } from './useAppQueries';

// One place for the "track a bill" behavior every surface shares (bill header,
// search results, home feed, Ask answer card): tracking needs an account, so a
// signed-out tap routes through sign-in and returns to the bill at ?track=1 to
// complete the track (grounded-answers rule 5); signed in, it toggles the bill on
// the watchlist. Keeps the sign-in-vs-toggle decision from being re-implemented
// per screen. The bill-detail ?track=1 auto-complete effect stays on those screens
// (it needs their route params), reading `trackedIds` from here.
export function useBillTracking() {
  const { isSignedIn, user, signInWithGoogle } = useAuth();
  const trackedQuery = useTrackedBills(user?.id);
  const toggleTrackedBill = useToggleTrackedBill(user?.id);

  const trackedIds = useMemo(
    () => new Set((trackedQuery.data ?? []).map((item) => item.id)),
    [trackedQuery.data],
  );

  const isTracked = useCallback((billId: string) => trackedIds.has(billId), [trackedIds]);

  const toggleTrack = useCallback(
    (billId: string) => {
      if (!isSignedIn) {
        void signInWithGoogle(trackSignInReturnTo(billId));
        return;
      }
      toggleTrackedBill.mutate(billId);
    },
    [isSignedIn, signInWithGoogle, toggleTrackedBill],
  );

  return {
    trackedIds,
    isTracked,
    toggleTrack,
    trackedLoading: trackedQuery.isLoading,
  };
}
