import { pathToFileURL } from 'node:url';

const REQUIRED_TRAFFIC_ENV = [
  'VERCEL_ANALYTICS_ACCESS_TOKEN',
  'VERCEL_ANALYTICS_PROJECT_ID',
  'VERCEL_ANALYTICS_TEAM_ID',
  'TRAFFIC_COUNTING_STARTED_AT',
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
