import { pathToFileURL } from 'node:url';

export const TRAFFIC_TOKEN_EXPIRES_AT = '2027-08-15T00:00:00.000Z';

const DAY_MS = 24 * 60 * 60 * 1000;

/** @param {number} [now] @param {string} [expiresAt] */
export function trafficTokenExpiryState(now = Date.now(), expiresAt = TRAFFIC_TOKEN_EXPIRES_AT) {
  const expiry = Date.parse(expiresAt);
  if (!Number.isFinite(now) || !Number.isFinite(expiry)) {
    throw new Error('Traffic token expiry check received an invalid date.');
  }

  const daysRemaining = Math.max(0, Math.ceil((expiry - now) / DAY_MS));
  const status =
    now >= expiry
      ? 'expired'
      : daysRemaining <= 14
        ? 'urgent'
        : daysRemaining <= 60
          ? 'warning'
          : 'healthy';

  return { status, daysRemaining, expiresAt };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const state = trafficTokenExpiryState();
  console.log(`status=${state.status}`);
  console.log(`days_remaining=${state.daysRemaining}`);
  console.log(`expires_on=${state.expiresAt.slice(0, 10)}`);
}
