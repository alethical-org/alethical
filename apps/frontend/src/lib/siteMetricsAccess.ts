import { ApiError } from '../data/api';

export type SiteMetricsAccessIssue = 'denied' | 'unavailable';

export function accessIssueForSiteMetrics(error: unknown): SiteMetricsAccessIssue | null {
  if (!(error instanceof ApiError)) return null;
  if (error.status === 401 || error.status === 403) return 'denied';
  if (error.status === 503 && error.problem === 'service-unavailable') return 'unavailable';
  return null;
}
