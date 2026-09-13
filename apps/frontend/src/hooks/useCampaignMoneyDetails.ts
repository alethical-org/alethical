import { useQuery } from '@tanstack/react-query';
import { MoneyDetailsReadError } from '../data/moneyDetailsReadError';

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
  options: { enabled?: boolean; history?: boolean } = {},
) {
  const enabled = Boolean(registrationNumber) && (options.enabled ?? true);
  const received = useQuery({
    queryKey: ['campaign-money-details', registrationNumber, year, 'received'],
    queryFn: async ({ signal }) =>
      (await import('../data/campaignMoneyDetails')).getCompleteCampaignMoneyPayments(
        registrationNumber,
        year,
        'received',
        signal,
      ),
    enabled,
    retry: retryCompleteRead,
  });
  const made = useQuery({
    queryKey: ['campaign-money-details', registrationNumber, year, 'made'],
    queryFn: async ({ signal }) =>
      (await import('../data/campaignMoneyDetails')).getCompleteCampaignMoneyPayments(
        registrationNumber,
        year,
        'made',
        signal,
      ),
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
    queryFn: async ({ signal }) => {
      if (!received.data) throw new MoneyDetailsReadError('selected_year_not_ready');
      return (await import('../data/campaignMoneyDetails')).getCampaignMoneyHistory(
        registrationNumber,
        CAMPAIGN_MONEY_HISTORY_YEARS,
        received.data,
        signal,
      );
    },
    enabled: enabled && selectedComplete && (options.history ?? true),
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
