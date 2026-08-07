import { PropsWithChildren, useCallback, useEffect, useMemo, useState } from 'react';

import { useSetTrackedBill } from '../hooks/useAppQueries';
import { useAuth } from './AuthProvider';
import { TrackedBillWriteContext } from './trackedBillWriteContext';

// One write owner for every Track button. A failed PUT or DELETE is kept by bill
// id so every copy of that bill immediately takes the same honest failure form,
// and retry repeats the intended idempotent state rather than blindly toggling.
export function TrackedBillWriteProvider({ children }: PropsWithChildren) {
  const { user } = useAuth();
  const { mutateAsync } = useSetTrackedBill(user?.id);
  const [failures, setFailures] = useState<Record<string, boolean>>({});

  useEffect(() => setFailures({}), [user?.id]);

  const setTrackedBill = useCallback(
    (billId: string, tracked: boolean, onSaved?: () => void) => {
      setFailures((current) => {
        if (!(billId in current)) return current;
        const next = { ...current };
        delete next[billId];
        return next;
      });
      void mutateAsync({ billId, tracked })
        .then(() => onSaved?.())
        .catch(() => setFailures((current) => ({ ...current, [billId]: tracked })));
    },
    [mutateAsync],
  );

  const retryTrackedBill = useCallback(
    (billId: string) => {
      const intendedState = failures[billId];
      if (intendedState !== undefined) setTrackedBill(billId, intendedState);
    },
    [failures, setTrackedBill],
  );

  const retryFailedWrites = useCallback(() => {
    for (const [billId, tracked] of Object.entries(failures)) {
      setTrackedBill(billId, tracked);
    }
  }, [failures, setTrackedBill]);

  const value = useMemo(
    () => ({ failures, setTrackedBill, retryTrackedBill, retryFailedWrites }),
    [failures, retryFailedWrites, retryTrackedBill, setTrackedBill],
  );

  return (
    <TrackedBillWriteContext.Provider value={value}>{children}</TrackedBillWriteContext.Provider>
  );
}
