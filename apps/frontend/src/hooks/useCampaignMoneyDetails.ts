import { useQuery } from '@tanstack/react-query';
import {
  getCampaignMoneyHistory,
  getCampaignMoneyYearState,
  getCompleteCampaignMoneyPayments,
  MoneyDetailsReadError,
  type CampaignMoneyYearState,
} from '../data/campaignMoneyDetails';

export function campaignMoneyHistoryYears(today: Date = new Date()) {
  return Array.from(
    { length: Math.max(0, today.getFullYear() - 2015 + 1) },
    (_, index) => 2015 + index,
  );
}
export const CAMPAIGN_MONEY_HISTORY_YEARS = campaignMoneyHistoryYears();

/** A retry starts at offset 0; never append a new release to a partial old one. */
const retryCompleteRead = (attempt: number, error: Error) =>
  attempt < 1 && error instanceof MoneyDetailsReadError && error.reason === 'release_changed';

export function useCampaignMoneyDetails(
  registrationNumber: string,
  year: number,
  options: { enabled?: boolean } = {},
) {
  const enabled = Boolean(registrationNumber) && (options.enabled ?? true);
  const received = useQuery({
    queryKey: ['campaign-money-details', registrationNumber, year, 'received'],
    queryFn: ({ signal }) =>
      getCompleteCampaignMoneyPayments(registrationNumber, year, 'received', signal),
    enabled,
    retry: retryCompleteRead,
  });
  const made = useQuery({
    queryKey: ['campaign-money-details', registrationNumber, year, 'made'],
    queryFn: ({ signal }) =>
      getCompleteCampaignMoneyPayments(registrationNumber, year, 'made', signal),
    enabled,
    retry: retryCompleteRead,
  });
  const selectedComplete =
    received.isSuccess &&
    made.isSuccess &&
    received.data.state !== 'unavailable' &&
    made.data.state !== 'unavailable' &&
    received.data.releaseId === made.data.releaseId;
  const history = useQuery({
    queryKey: ['campaign-money-history', registrationNumber, received.data?.releaseId],
    queryFn: ({ signal }) => {
      if (!received.data) throw new MoneyDetailsReadError('selected_year_not_ready');
      return getCampaignMoneyHistory(
        registrationNumber,
        CAMPAIGN_MONEY_HISTORY_YEARS,
        received.data,
        signal,
      );
    },
    enabled: enabled && selectedComplete,
    retry: false,
  });
  return {
    received,
    made,
    history,
    selectedComplete,
    historyComplete:
      selectedComplete &&
      history.isSuccess &&
      history.data.years.length === CAMPAIGN_MONEY_HISTORY_YEARS.length &&
      history.data.releaseId === received.data?.releaseId,
    releaseMismatch:
      received.isSuccess && made.isSuccess && received.data.releaseId !== made.data.releaseId,
  };
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
