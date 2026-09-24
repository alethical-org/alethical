import { useQuery } from '@tanstack/react-query';

import { getCommitteeNotices } from '../data/committeeNotices';
import { committeeNoticesQueryKey } from '../lib/committeeMoneyQueryKeys';
import { committeeNoticesFromPayload } from '../lib/committeeNotices';
import { seededQuery } from '../lib/pageData';

/** The notices card's read. Seeded from the served page when the page function made it,
 *  so the card draws with the page instead of loading after it. */
export function useCommitteeNotices(registrationNumber: string | null, year: number) {
  const key = committeeNoticesQueryKey(registrationNumber, year);
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => getCommitteeNotices(registrationNumber ?? '', year, signal),
    ...seededQuery(key, (payload: unknown) => {
      const notices = committeeNoticesFromPayload(payload);
      if (!notices) throw new Error('unreadable seeded notices');
      return notices;
    }),
    enabled: Boolean(registrationNumber),
    retry: false,
  });
}
