import { useCallback, useMemo, useState } from 'react';

import { useAuth } from '../providers/AuthProvider';
import { useSetTrackedCommittee, useTrackedCommittees } from './useAppQueries';

// The one place "follow a committee" lives (#1943), the committee twin of
// `useBillTracking`. Two deliberate differences from the bill hook:
//
//   * Signed out, there is nothing to do. Following a committee while signed out
//     (open the sign-in panel, finish the saved request afterwards) is deliberately
//     not built, so the control on a committee page does not render for a visitor,
//     and `toggleTrack` is never reached signed out. `isSignedIn` is exposed so a
//     surface can make that decision from the same truth.
//   * A failed write is remembered per committee here rather than in a provider:
//     one page draws one control, so there is no second copy to keep in step.
//
// Nothing here notifies anybody. A follow is a bookmark, and the Tracked page says
// only that the committee stays on the list.
export function useCommitteeTracking() {
  const { isSignedIn, user } = useAuth();
  const trackedQuery = useTrackedCommittees(user?.id);
  const { mutateAsync } = useSetTrackedCommittee(user?.id);
  const [failures, setFailures] = useState<Record<string, boolean>>({});

  const trackedNumbers = useMemo(
    () => new Set((trackedQuery.data ?? []).map((item) => item.registrationNumber)),
    [trackedQuery.data],
  );

  const isTracked = useCallback(
    (registrationNumber: string) => trackedNumbers.has(registrationNumber),
    [trackedNumbers],
  );

  const setTracked = useCallback(
    (registrationNumber: string, tracked: boolean) => {
      setFailures((current) => {
        if (!(registrationNumber in current)) return current;
        const next = { ...current };
        delete next[registrationNumber];
        return next;
      });
      void mutateAsync({ registrationNumber, tracked }).catch(() =>
        setFailures((current) => ({ ...current, [registrationNumber]: tracked })),
      );
    },
    [mutateAsync],
  );

  const toggleTrack = useCallback(
    (registrationNumber: string) => {
      if (!isSignedIn) return;
      setTracked(registrationNumber, !trackedNumbers.has(registrationNumber));
    },
    [isSignedIn, setTracked, trackedNumbers],
  );

  // Repeat the state the reader asked for, never a blind toggle: the same rule the
  // bill write provider follows, so a retry after a failed follow still follows.
  const retry = useCallback(
    (registrationNumber: string) => {
      const intended = failures[registrationNumber];
      if (intended !== undefined) setTracked(registrationNumber, intended);
    },
    [failures, setTracked],
  );

  return {
    isSignedIn,
    /** The list has arrived. Until it has, a control must not claim a state. */
    hasList: trackedQuery.data !== undefined,
    /** The list failed to load, with nothing to fall back on. */
    listUnavailable: isSignedIn && trackedQuery.data === undefined && trackedQuery.isError,
    isTracked,
    toggleTrack,
    writeFailed: (registrationNumber: string) => failures[registrationNumber] !== undefined,
    retry,
    recheck: () => void trackedQuery.refetch(),
  };
}
