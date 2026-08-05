import { useCallback, useMemo } from 'react';

import { useAuth } from '../providers/AuthProvider';
import { useSignInModal } from '../providers/signInModalContext';
import { trackSignInReturnTo } from '../navigation/webRoutes';
import { useToggleTrackedBill, useTrackedBills, useTrackedListState } from './useAppQueries';

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

  // The four-way state and the way out of a failed check, derived in ONE place
  // (`lib/trackedState.ts`) and surfaced here so a page can render the failure notice
  // from the same truth the buttons render from. `listUnavailable` is true only for a
  // signed-in reader with no list to fall back on — a signed-out visitor has nothing
  // missing, so no page should tell them their saved list failed to load (#1021).
  const { isError: listUnavailable, recheck } = useTrackedListState();

  const trackedIds = useMemo(
    () => new Set((trackedQuery.data ?? []).map((item) => item.id)),
    [trackedQuery.data],
  );

  const isTracked = useCallback((billId: string) => trackedIds.has(billId), [trackedIds]);

  // `billCode` is the bill's identifier ("HF 4138"), passed so the sign-in dialog
  // can name the bill the person asked to track. Optional: a surface that only
  // holds the id still gets the dialog, worded generically.
  const toggleTrack = useCallback(
    (billId: string, billCode?: string, onSaved?: () => void) => {
      if (!isSignedIn) {
        openSignIn({ intent: 'track', returnTo: trackSignInReturnTo(billId), billCode });
        return;
      }
      // `onSaved` runs only once the server has confirmed it, so a caller can
      // say "Now tracking HF 4138" without the risk of announcing a save that
      // never happened (grounded-answers.md rule 6).
      toggleTrackedBill.mutate(billId, onSaved ? { onSuccess: () => onSaved() } : undefined);
    },
    [isSignedIn, openSignIn, toggleTrackedBill],
  );

  return {
    trackedIds,
    isTracked,
    toggleTrack,
    trackedLoading: trackedQuery.isLoading,
    listUnavailable,
    recheck,
  };
}
