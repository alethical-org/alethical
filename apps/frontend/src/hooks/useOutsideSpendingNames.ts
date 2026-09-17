import { useQuery } from '@tanstack/react-query';
import { getOutsideSpendingNamesFromApi } from '../data/api';
import type { OutsideSpendingBrowseMode } from '../lib/outsideSpendingBrowse';

export function useOutsideSpendingNames(options: {
  browse: OutsideSpendingBrowseMode;
  year: number | null;
  q: string;
  page: number;
  snapshotId: string | null;
  enabled: boolean;
}) {
  return useQuery({
    queryKey: [
      'outside-spending-names',
      options.snapshotId,
      options.browse,
      options.year,
      options.q,
      options.page,
    ],
    queryFn: () => getOutsideSpendingNamesFromApi({ ...options, snapshotId: options.snapshotId! }),
    enabled: options.enabled && Boolean(options.snapshotId),
    retry: false,
  });
}
