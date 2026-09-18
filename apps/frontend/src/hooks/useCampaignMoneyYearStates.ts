import { useQuery } from '@tanstack/react-query';
import type { CampaignMoneyYearState } from '../data/campaignMoneyDetails';

// The reading itself lives with the other money reads, in the piece that arrives
// with the money tab rather than in every reader's first download.
export {
  readCampaignMoneyYearStates,
  YEAR_STATE_READS_AT_ONCE,
} from '../data/campaignMoneyDetails';

/**
 * Only year-button styling. These reads never establish a committee's
 * confirmation; an absent committee is unknown, and callers must not infer a
 * missing official total.
 *
 * One request for the whole span (`/campaign-finance/years`), falling back to the
 * per-year reads only where the data service does not serve the route yet
 * (`getCampaignMoneyYearStates`).
 */
export function useCampaignMoneyYearStates(
  legislatorId: string,
  years: readonly number[],
  options: { enabled?: boolean } = {},
) {
  return useQuery<CampaignMoneyYearState[]>({
    queryKey: ['campaign-money-year-states', legislatorId, [...years]],
    queryFn: async ({ signal }) => {
      const { getCampaignMoneyYearStates } = await import('../data/campaignMoneyDetails');
      return getCampaignMoneyYearStates(legislatorId, years, signal);
    },
    enabled: Boolean(legislatorId) && (options.enabled ?? true),
    retry: false,
  });
}
