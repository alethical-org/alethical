// These reads belong to the lazily loaded metrics screens, not every page.
import { apiRequest, publicApiRequest } from './api';
import type { SiteMetricRecordTotals } from '../lib/traffic';
import { isAccountSignupTotals, type AccountSignupTotals } from '../lib/accountSignupMetrics';
import { isLeadershipMetrics, type LeadershipMetrics } from '../lib/leadershipMetrics';

interface DetailResponse<T> {
  data: T;
}

export async function getAccountSignupTotalsFromApi(): Promise<AccountSignupTotals> {
  const response = await publicApiRequest<unknown>('/site-metrics/accounts');
  if (!isAccountSignupTotals(response)) throw new Error('Account creation totals are unavailable.');
  return response;
}

export async function getSiteMetricRecordTotalsFromApi(): Promise<SiteMetricRecordTotals> {
  const response =
    await publicApiRequest<DetailResponse<SiteMetricRecordTotals>>('/site-metrics?version=2');
  return response.data;
}

export async function getLeadershipMetricsFromApi(
  accessToken: string,
  signal?: AbortSignal,
): Promise<LeadershipMetrics> {
  const response = await apiRequest<unknown>(
    '/admin/site-metrics?version=2',
    { method: 'GET', cache: 'no-store', signal },
    accessToken,
  );
  if (!isLeadershipMetrics(response)) throw new Error('Admin metrics are unavailable.');
  return response;
}
