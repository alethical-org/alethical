import { createContext, useContext } from 'react';

export interface TrackedBillWriteValue {
  failures: Record<string, boolean>;
  setTrackedBill: (billId: string, tracked: boolean, onSaved?: () => void) => void;
  retryTrackedBill: (billId: string) => void;
  retryFailedWrites: () => void;
}

export const TrackedBillWriteContext = createContext<TrackedBillWriteValue | null>(null);

export function useTrackedBillWrite(): TrackedBillWriteValue {
  const context = useContext(TrackedBillWriteContext);
  if (!context) {
    throw new Error('useTrackedBillWrite must be used within TrackedBillWriteProvider');
  }
  return context;
}
