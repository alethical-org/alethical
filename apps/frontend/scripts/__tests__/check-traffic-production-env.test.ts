import { describe, expect, it } from 'vitest';

import { assertTrafficProductionEnv } from '../check-traffic-production-env.mjs';

const completeProductionEnv = {
  VERCEL_ENV: 'production',
  VERCEL_ANALYTICS_ACCESS_TOKEN: 'private-token',
  VERCEL_ANALYTICS_PROJECT_ID: 'prj_test',
  VERCEL_ANALYTICS_TEAM_ID: 'team_test',
  TRAFFIC_COUNTING_STARTED_AT: '2026-08-15T02:01:44.000Z',
};

describe('Traffic production settings', () => {
  it('blocks a Production build when the totals-reading key is missing', () => {
    const { VERCEL_ANALYTICS_ACCESS_TOKEN: _missing, ...withoutToken } = completeProductionEnv;

    expect(() => assertTrafficProductionEnv(withoutToken)).toThrow('VERCEL_ANALYTICS_ACCESS_TOKEN');
  });

  it('allows a Production build when every required setting is present', () => {
    expect(() => assertTrafficProductionEnv(completeProductionEnv)).not.toThrow();
  });

  it('does not require Production-only settings for previews or local builds', () => {
    expect(() => assertTrafficProductionEnv({ VERCEL_ENV: 'preview' })).not.toThrow();
    expect(() => assertTrafficProductionEnv({})).not.toThrow();
  });
});
