import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

/** Apply a shared bill-section address once after the loaded page has painted.
 * A cancelled effect has not made the jump: a refreshed bill object or React's
 * setup/cleanup replay must not consume the address before it is applied.
 */
export function useInitialBillSectionJump<T extends string>(
  billId: string | undefined,
  section: T | null,
  jumpTo: (section: T) => void,
) {
  const applied = useRef<string | null>(null);
  useEffect(() => {
    if (!billId || !section) return;
    const address = JSON.stringify([billId, section]);
    if (applied.current === address) return;
    const jump = () => {
      jumpTo(section);
      applied.current = address;
    };
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      // Keep the page's existing after-paint deferral. Readiness is keyed by
      // bill identity, not the freshly combined bill-and-votes object.
      const timer = window.setTimeout(jump, 180);
      return () => window.clearTimeout(timer);
    }
    jump();
  }, [billId, section, jumpTo]);
}
