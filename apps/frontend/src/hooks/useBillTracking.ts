import { useCallback, useMemo } from 'react';
import { Platform } from 'react-native';

import { useAuth } from '../providers/AuthProvider';
import { useSignInModal } from '../providers/signInModalContext';
import { useTrackedBillWrite } from '../providers/trackedBillWriteContext';
import { trackSignInRequest } from '../lib/trackIntent';
import { useTrackedBills, useTrackedListState } from './useAppQueries';

// One place for the "track a bill" behavior every surface shares (bill header,
// search results, home feed, Ask answer card): tracking needs an account, so a
// signed-out tap opens the shared sign-in dialog, returns to the exact page, and
// finishes the saved request; signed in, it toggles the bill on the watchlist.
// Keeps the sign-in-vs-toggle decision from being re-implemented per screen. The
// old bill-detail ?track=1 effects stay for incoming-link compatibility.
export function useBillTracking() {
  const { isSignedIn, user } = useAuth();
  const { openSignIn } = useSignInModal();
  const { failures, setTrackedBill, retryFailedWrites } = useTrackedBillWrite();
  const trackedQuery = useTrackedBills(user?.id);

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

  // Keep the optional billCode argument while existing callers are migrated; the
  // approved Track copy no longer names a specific bill.
  const toggleTrack = useCallback(
    (billId: string, _billCode?: string, onSaved?: () => void) => {
      if (!isSignedIn) {
        const page =
          Platform.OS === 'web' && typeof window !== 'undefined'
            ? {
                pathname: window.location.pathname,
                search: window.location.search,
                hash: window.location.hash,
                scrollY: window.scrollY,
              }
            : undefined;
        openSignIn(trackSignInRequest(billId, page));
        return;
      }
      // `onSaved` runs only once the server has confirmed it, so a caller can
      // say "Now tracking HF 4138" without the risk of announcing a save that
      // never happened (grounded-answers.md rule 6).
      setTrackedBill(billId, !trackedIds.has(billId), onSaved);
    },
    [isSignedIn, openSignIn, setTrackedBill, trackedIds],
  );

  return {
    trackedIds,
    isTracked,
    toggleTrack,
    trackedLoading: trackedQuery.isLoading,
    listUnavailable,
    writeUnavailable: Object.keys(failures).length > 0,
    retryFailedWrites,
    recheck,
  };
}
