import { useQuery } from '@tanstack/react-query';
import type { CampaignMoneyYearState } from '../data/campaignMoneyDetails';

/** Only year-button styling. These reads never establish a committee's confirmation.
 * An absent committee is unknown; callers must not infer a missing official total. */
export function useCampaignMoneyYearStates(
  legislatorId: string,
  years: readonly number[],
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: ['campaign-money-year-states', legislatorId, [...years]],
    queryFn: async ({ signal }) => {
      const { getCampaignMoneyYearState } = await import('../data/campaignMoneyDetails');
      const states: CampaignMoneyYearState[] = [];
      // Deliberately sequential. The selected year's actual card takes priority.
      for (const year of years) {
        signal.throwIfAborted();
        states.push(await getCampaignMoneyYearState(legislatorId, year, signal));
      }
      return states;
    },
    enabled: Boolean(legislatorId) && (options.enabled ?? true),
    retry: false,
  });
}
