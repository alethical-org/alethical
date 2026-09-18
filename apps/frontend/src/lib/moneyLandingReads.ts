/**
 * The /money landing's 2 campaign reads: the filed-reports payload and its shaper,
 * and the keys both reads are stored under.
 *
 * `data/api.ts` and `hooks/useAppQueries.ts` are in the program every page downloads
 * before anything draws, and they need only these names from the landing.
 * Importing them from `lib/moneyLanding.ts` put every sentence the landing prints
 * into that first download. This module imports only types.
 * `lib/moneyLanding.ts` re-exports every name here, so the screen, its tests and
 * `api/page.ts` import them from where they always did.
 */

import type { MoneyFilingsFeed } from '../data/types';

interface ApiMoneyFilingPayload {
  registration_number?: string | null;
  filer_name: string;
  report_name: string;
  period_start?: string | null;
  period_end?: string | null;
  filed_date?: string | null;
}

export interface ApiCampaignFinanceFilingsPayload {
  state?: string;
  ordered_by?: string;
  filings?: ApiMoneyFilingPayload[] | null;
  newest_period?: { period_end?: string | null; filing_count?: number | null } | null;
}

/** The same filed-report mapping serves the app and the first HTML response. */
export function campaignFinanceFilingsFromPayload(
  payload: ApiCampaignFinanceFilingsPayload,
): MoneyFilingsFeed {
  return {
    state: payload.state === 'reported' ? 'reported' : 'unavailable',
    orderedBy: payload.ordered_by ?? '',
    filings:
      payload.state === 'reported'
        ? (payload.filings ?? []).map((filing) => ({
            registrationNumber: filing.registration_number ?? null,
            filerName: filing.filer_name,
            reportName: filing.report_name,
            periodStart: filing.period_start ?? null,
            periodEnd: filing.period_end ?? null,
            filedDate: filing.filed_date ?? null,
          }))
        : [],
    // Absent counts remain absent, never an invented zero.
    newestPeriod:
      payload.state === 'reported' && typeof payload.newest_period?.filing_count === 'number'
        ? {
            periodEnd: payload.newest_period.period_end ?? null,
            filingCount: payload.newest_period.filing_count,
          }
        : null,
  };
}

/**
 * The React Query keys for the /money landing's 2 campaign reads. Shared with
 * `api/page.ts` so the payloads it already read are labelled with the keys the
 * app asks for (issue #1966).
 */
export function campaignFinanceSummaryQueryKey(): readonly unknown[] {
  return ['campaign-finance-summary'];
}

export function campaignFinanceFilingsQueryKey(limit: number): readonly unknown[] {
  return ['campaign-finance-filings', limit];
}
