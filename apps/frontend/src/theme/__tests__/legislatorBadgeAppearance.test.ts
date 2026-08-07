import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { profilePartyBadgeAppearance } from '../legislatorBadgeAppearance';

const here = dirname(fileURLToPath(import.meta.url));
const webProfile = readFileSync(
  resolve(here, '../../screens/redesign/LegislatorProfileWebScreen.tsx'),
  'utf8',
);
const phoneProfile = readFileSync(
  resolve(here, '../../screens/redesign/LegislatorProfileMobileScreen.tsx'),
  'utf8',
);

describe('legislator badge appearance', () => {
  it('keeps party identity neutral on large screens and phones', () => {
    expect(profilePartyBadgeAppearance.web.container).toEqual({
      paddingVertical: 6,
      paddingHorizontal: 14,
      backgroundColor: '#f1f1f4',
      borderRadius: 999,
      flexShrink: 0,
    });
    expect(profilePartyBadgeAppearance.web.text).toEqual({
      fontFamily: expect.any(String),
      fontSize: 14,
      fontWeight: '700',
      letterSpacing: 0.84,
      color: '#4f5651',
    });

    expect(profilePartyBadgeAppearance.phone.container).toEqual({
      paddingVertical: 5,
      paddingHorizontal: 12,
      backgroundColor: '#f1f1f4',
      borderRadius: 999,
      flexShrink: 0,
    });
    expect(profilePartyBadgeAppearance.phone.text).toEqual({
      fontFamily: expect.any(String),
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 0.72,
      color: '#4f5651',
    });
  });

  it('uses the shared non-wrapping party badge on both profile layouts', () => {
    expect(webProfile).toContain('partyPill: profilePartyBadgeAppearance.web.container');
    expect(webProfile).toContain('partyPillText: profilePartyBadgeAppearance.web.text');
    expect(phoneProfile).toContain('partyPill: profilePartyBadgeAppearance.phone.container');
    expect(phoneProfile).toContain('partyPillText: profilePartyBadgeAppearance.phone.text');

    for (const profile of [webProfile, phoneProfile]) {
      expect(profile).toContain('<Text numberOfLines={1} style={styles.partyPillText}>');
    }
  });
});
