import { useCallback, useMemo } from 'react';

import { useAuth } from '../providers/AuthProvider';
import { useSignInModal } from '../providers/signInModalContext';
import { trackSignInReturnTo } from '../navigation/webRoutes';
import { useToggleTrackedBill, useTrackedBills } from './useAppQueries';

// One place for the "track a bill" behavior every surface shares (bill header,
// search results, home feed, Ask answer card): tracking needs an account, so a
// signed-out tap opens the shared sign-in dialog and returns to the bill at
// ?track=1 to complete the track (grounded-answers rule 5); signed in, it toggles
// the bill on the watchlist. Keeps the sign-in-vs-toggle decision from being re-implemented
// per screen. The bill-detail ?track=1 auto-complete effect stays on those screens
// (it needs their route params), reading `trackedIds` from here.
export function useBillTracking() {
  const { isSignedIn, user } = useAuth();
  const { openSignIn } = useSignInModal();
  const trackedQuery = useTrackedBills(user?.id);
  const toggleTrackedBill = useToggleTrackedBill(user?.id);

  const trackedIds = useMemo(
    () => new Set((trackedQuery.data ?? []).map((item) => item.id)),
    [trackedQuery.data],
  );

  const isTracked = useCallback((billId: string) => trackedIds.has(billId), [trackedIds]);

  // `billCode` is the bill's identifier ("HF 4138"), passed so the sign-in dialog
  // can name the bill the person asked to track. Optional: a surface that only
  // holds the id still gets the dialog, worded generically.
  const toggleTrack = useCallback(
    (billId: string, billCode?: string) => {
      if (!isSignedIn) {
        openSignIn({ intent: 'track', returnTo: trackSignInReturnTo(billId), billCode });
        return;
      }
      toggleTrackedBill.mutate(billId);
    },
    [isSignedIn, openSignIn, toggleTrackedBill],
  );

  return {
    trackedIds,
    isTracked,
    toggleTrack,
    trackedLoading: trackedQuery.isLoading,
  };
}
