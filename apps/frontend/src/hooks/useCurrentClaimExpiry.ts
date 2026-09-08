import { useEffect, useState } from 'react';

import {
  currentClaimAgeMs,
  currentClaimIsWithheld,
  msUntilCurrentClaimExpires,
} from '../lib/currentClaimFreshness';

/**
 * Whether a claim about the state of the world right now is too old to draw, and
 * a wake-up at the exact moment it becomes so
 * (https://github.com/alethical-org/alethical/issues/2023).
 *
 * WHY A TIMER AT ALL. Nothing re-renders a page a reader has stopped touching, so
 * without this the deadline is only checked when something else happens to redraw
 * the screen. A reader who opens a committee page and leaves it open is exactly
 * the reader the deadline is for, and they are the one nothing would wake.
 *
 * WHY IT REFETCHES BEFORE WITHHOLDING. Withholding is the answer to a recheck we
 * could not get, never the goal: reaching the deadline asks the data service
 * again, and a reachable service replaces the claim and restarts the clock. Only a
 * reader whose recheck cannot complete sees anything withheld.
 *
 * THE AGE IS 2 TERMS AND BOTH ARE NEEDED. `servedAgeMs` is what the shared caches
 * added before the answer arrived, which the browser cannot otherwise know.
 * `dataUpdatedAt` is React Query's own stamp, which is when the answer arrived for
 * a fetched read and the validation moment itself for one embedded in the page's
 * first response. They never overlap, so adding them cannot double-count
 * (`data/types.ts`, `CurrentClaimFreshness`).
 */
export function useCurrentClaimExpiry(options: {
  servedAgeMs: number | undefined;
  dataUpdatedAt: number | undefined;
  refetch?: () => void;
}): boolean {
  const { servedAgeMs, dataUpdatedAt, refetch } = options;
  // Re-render at the deadline. The value is only a counter; the decision below is
  // recomputed from the clock, so a missed or early tick cannot make a stale claim
  // read as fresh.
  const [, setExpiryTick] = useState(0);

  const hasClaim = typeof servedAgeMs === 'number' && typeof dataUpdatedAt === 'number';
  const ageMs = hasClaim
    ? currentClaimAgeMs({ servedAgeMs, receivedAt: dataUpdatedAt, now: Date.now() })
    : 0;
  const withheld = hasClaim && currentClaimIsWithheld(ageMs);

  useEffect(() => {
    if (!hasClaim || withheld) return undefined;
    const timer = setTimeout(() => {
      // Ask again first, then let the recomputed age decide. A successful answer
      // moves `dataUpdatedAt` and this effect re-arms from the new one.
      refetch?.();
      setExpiryTick((tick) => tick + 1);
    }, msUntilCurrentClaimExpires(ageMs));
    return () => clearTimeout(timer);
    // `ageMs` is deliberately not a dependency. It is read from the clock, so it
    // differs on every render and would re-arm the timer on every render. Leaving
    // it out is safe rather than merely cheaper: the age only ever grows, so each
    // arming is for a shorter remaining time than the last, and the deadline can
    // only come closer. `dataUpdatedAt` is the one input that genuinely moves the
    // deadline, and it moves only when a real answer arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasClaim, withheld, dataUpdatedAt, servedAgeMs, refetch]);

  return withheld;
}
