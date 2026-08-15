import { describe, expect, it } from 'vitest';

import { trafficTokenExpiryState } from '../traffic-token-expiry.mjs';

const EXPIRY = '2027-08-15T00:00:00.000Z';
const DAY_MS = 24 * 60 * 60 * 1000;

function daysBeforeExpiry(days: number) {
  return Date.parse(EXPIRY) - days * DAY_MS;
}

describe('Traffic token expiry warning', () => {
  it('stays quiet more than 60 days before expiry', () => {
    expect(trafficTokenExpiryState(daysBeforeExpiry(61), EXPIRY)).toMatchObject({
      status: 'healthy',
      daysRemaining: 61,
    });
  });

  it('starts the warning 60 days before expiry', () => {
    expect(trafficTokenExpiryState(daysBeforeExpiry(60), EXPIRY)).toMatchObject({
      status: 'warning',
      daysRemaining: 60,
    });
  });

  it('marks the warning urgent 14 days before expiry', () => {
    expect(trafficTokenExpiryState(daysBeforeExpiry(14), EXPIRY)).toMatchObject({
      status: 'urgent',
      daysRemaining: 14,
    });
  });

  it('marks the key expired on its expiry date', () => {
    expect(trafficTokenExpiryState(Date.parse(EXPIRY), EXPIRY)).toMatchObject({
      status: 'expired',
      daysRemaining: 0,
    });
  });
});
