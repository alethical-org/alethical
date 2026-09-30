import { describe, expect, it } from 'vitest';

import { apiErrorFromBody } from '../../data/api';
import { accessIssueForSiteMetrics } from '../siteMetricsAccess';

describe('Site Metrics access errors', () => {
  it('keeps a single failed measurement separate from an access outage', () => {
    const sourceUnavailable = apiErrorFromBody(
      503,
      JSON.stringify({ error: 'Account creation totals are temporarily unavailable.' }),
    );
    expect(accessIssueForSiteMetrics(sourceUnavailable)).toBeNull();

    const accessUnavailable = apiErrorFromBody(
      503,
      JSON.stringify({ type: 'https://api.alethical.com/problems/service-unavailable' }),
    );
    expect(accessIssueForSiteMetrics(accessUnavailable)).toBe('unavailable');
  });

  it('hides the report when a session is refused', () => {
    expect(accessIssueForSiteMetrics(apiErrorFromBody(401, '{}'))).toBe('denied');
    expect(accessIssueForSiteMetrics(apiErrorFromBody(403, '{}'))).toBe('denied');
    expect(accessIssueForSiteMetrics(apiErrorFromBody(500, '{}'))).toBeNull();
  });
});
