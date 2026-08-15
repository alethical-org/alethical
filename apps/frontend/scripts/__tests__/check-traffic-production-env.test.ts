import { describe, expect, it } from 'vitest';

import { assertTrafficProductionEnv } from '../check-traffic-production-env.mjs';

const completeProductionEnv = {
  VERCEL_ENV: 'production',
  VERCEL_ANALYTICS_ACCESS_TOKEN: 'private-token',
  VERCEL_ANALYTICS_PROJECT_ID: 'prj_test',
  VERCEL_ANALYTICS_TEAM_ID: 'team_test',
  TRAFFIC_COUNTING_STARTED_AT: '2026-08-15T02:01:44.000Z',
  GOOGLE_SEARCH_CONSOLE_GCP_PROJECT_NUMBER: '492188995407',
  GOOGLE_SEARCH_CONSOLE_SERVICE_ACCOUNT_EMAIL: 'traffic@example.iam.gserviceaccount.com',
  GOOGLE_SEARCH_CONSOLE_WORKLOAD_IDENTITY_POOL_ID: 'vercel',
  GOOGLE_SEARCH_CONSOLE_WORKLOAD_IDENTITY_PROVIDER_ID: 'vercel',
  GOOGLE_SEARCH_CONSOLE_SITE_URL: 'sc-domain:alethical.com',
  BING_WEBMASTER_API_KEY: 'bing-key',
  BING_WEBMASTER_SITE_URL: 'https://alethical.com/',
  CHECKLY_API_KEY: 'checkly-key',
  CHECKLY_ACCOUNT_ID: 'checkly-account',
  CHECKLY_WEB_CHECK_ID: 'web-check',
  CHECKLY_TRAFFIC_CHECK_ID: 'traffic-check',
  CHECKLY_API_READY_CHECK_ID: 'api-check',
  CLOUDFLARE_ANALYTICS_API_TOKEN: 'cloudflare-key',
  CLOUDFLARE_ACCOUNT_ID: 'cloudflare-account',
};

describe('Traffic production settings', () => {
  it('blocks a Production build when the totals-reading key is missing', () => {
    const { VERCEL_ANALYTICS_ACCESS_TOKEN: _missing, ...withoutToken } = completeProductionEnv;

    expect(() => assertTrafficProductionEnv(withoutToken)).toThrow('VERCEL_ANALYTICS_ACCESS_TOKEN');
  });

  it('allows a Production build when every required setting is present', () => {
    expect(() => assertTrafficProductionEnv(completeProductionEnv)).not.toThrow();
  });

  it('blocks a Production build when any new source is not connected', () => {
    const { CHECKLY_API_KEY: _missing, ...withoutCheckly } = completeProductionEnv;

    expect(() => assertTrafficProductionEnv(withoutCheckly)).toThrow('CHECKLY_API_KEY');
  });

  it('does not require Production-only settings for previews or local builds', () => {
    expect(() => assertTrafficProductionEnv({ VERCEL_ENV: 'preview' })).not.toThrow();
    expect(() => assertTrafficProductionEnv({})).not.toThrow();
  });
});
