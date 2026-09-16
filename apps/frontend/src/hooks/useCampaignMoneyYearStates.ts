import { useQuery } from '@tanstack/react-query';
import type { CampaignMoneyYearState } from '../data/campaignMoneyDetails';

/** How many year reads run side by side; the API answered 4 at once in 0.6 s. */
export const YEAR_STATE_READS_AT_ONCE = 3;

/**
 * Every year's state, in the order the years were asked for.
 *
 * A few at a time, never all at once and never one after another. One after another,
 * 11 years took about 7 seconds on the live site while the year buttons waited for
 * every one of them; all at once would crowd out the selected year's own payment
 * reads, which are what the reader is looking at.
 */
export async function readCampaignMoneyYearStates<State>(
  years: readonly number[],
  signal: AbortSignal | undefined,
  read: (year: number) => Promise<State>,
): Promise<State[]> {
  const states: State[] = [];
  let next = 0;
  async function worker() {
    while (next < years.length) {
      signal?.throwIfAborted();
      const index = next++;
      states[index] = await read(years[index]);
    }
  }
  await Promise.all(Array.from({ length: YEAR_STATE_READS_AT_ONCE }, worker));
  return states;
}

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
      return readCampaignMoneyYearStates(years, signal, (year) =>
        getCampaignMoneyYearState(legislatorId, year, signal),
      );
    },
    enabled: Boolean(legislatorId) && (options.enabled ?? true),
    retry: false,
  });
}
