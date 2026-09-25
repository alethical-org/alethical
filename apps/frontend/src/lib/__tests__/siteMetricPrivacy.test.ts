import { describe, expect, it } from 'vitest';

import { isPrivateMetricUrl } from '../siteMetricPrivacy';

describe('private email pages', () => {
  it.each([
    'https://www.alethical.com/email-preferences',
    'https://www.alethical.com/unsubscribe#private-token',
    'https://www.alethical.com/%75nsubscribe',
  ])('never sends a visit from %s to site metrics', (address) => {
    expect(isPrivateMetricUrl(address)).toBe(true);
  });

  it('still counts a public money visit', () => {
    expect(isPrivateMetricUrl('https://www.alethical.com/money')).toBe(false);
  });
});
