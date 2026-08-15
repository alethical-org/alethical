import { pathToFileURL } from 'node:url';

const REQUIRED_TRAFFIC_ENV = [
  'VERCEL_ANALYTICS_ACCESS_TOKEN',
  'VERCEL_ANALYTICS_PROJECT_ID',
  'VERCEL_ANALYTICS_TEAM_ID',
  'TRAFFIC_COUNTING_STARTED_AT',
  'EXPO_PUBLIC_CHECKLY_STATUS_URL',
  'GOOGLE_SEARCH_CONSOLE_GCP_PROJECT_NUMBER',
  'GOOGLE_SEARCH_CONSOLE_SERVICE_ACCOUNT_EMAIL',
  'GOOGLE_SEARCH_CONSOLE_WORKLOAD_IDENTITY_POOL_ID',
  'GOOGLE_SEARCH_CONSOLE_WORKLOAD_IDENTITY_PROVIDER_ID',
  'GOOGLE_SEARCH_CONSOLE_SITE_URL',
  'BING_WEBMASTER_API_KEY',
  'BING_WEBMASTER_SITE_URL',
  'CHECKLY_API_KEY',
  'CHECKLY_ACCOUNT_ID',
  'CHECKLY_WEB_CHECK_ID',
  'CHECKLY_TRAFFIC_CHECK_ID',
  'CHECKLY_API_READY_CHECK_ID',
  'CLOUDFLARE_ANALYTICS_API_TOKEN',
  'CLOUDFLARE_ACCOUNT_ID',
];

/** @param {Record<string, string | undefined>} [env] */
export function assertTrafficProductionEnv(env = process.env) {
  if (env.VERCEL_ENV !== 'production') return;

  const missing = REQUIRED_TRAFFIC_ENV.filter(
    (name) => typeof env[name] !== 'string' || env[name].trim().length === 0,
  );
  if (missing.length === 0) return;

  throw new Error(`Production traffic totals are missing required settings: ${missing.join(', ')}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assertTrafficProductionEnv();
}
