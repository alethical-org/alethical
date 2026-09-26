import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { IA } from '../../navigation/ia';
import { MONEY_PROMO_CTA, MONEY_PROMO_HEADING } from '../homepage';
import { MONEY_LANDING_HEADING } from '../moneyLanding';
import { MONEY_SECTION_NAME } from '../moneySectionName';
import { STATIC_PAGE_METADATA } from '../staticPageMetadata';
import { LOBBYING_DIRECTORY_COPY } from '../lobbyingDirectoryCopy';

describe('one name for the /money destination', () => {
  it('matches the menu, homepage button, heading, browser title, and share title', () => {
    expect(MONEY_SECTION_NAME).toBe('Money in politics');
    expect(IA.find((item) => item.path === '/money')?.label).toBe(MONEY_SECTION_NAME);
    expect(MONEY_PROMO_CTA).toBe(MONEY_SECTION_NAME);
    expect(MONEY_LANDING_HEADING).toBe(MONEY_SECTION_NAME);
    expect(STATIC_PAGE_METADATA['/money'].title).toBe('Money in politics in Minnesota | Alethical');
    expect(STATIC_PAGE_METADATA['/money'].socialTitle).toBe(MONEY_SECTION_NAME);
    expect(LOBBYING_DIRECTORY_COPY.landingLabel).toBe('MONEY IN POLITICS');
  });

  it('keeps the homepage invitation distinct from the destination name', () => {
    expect(MONEY_PROMO_HEADING).toBe('Follow the money');
  });

  it.each([
    'CommitteeListScreen',
    'MoneyByRaceScreen',
    'MoneySearchScreen',
    'CommitteeMoneyScreen',
    'LobbyingLandingScreen',
    'OutsideSpendingScreen',
  ])('uses the shared name on %s return links', (screen) => {
    const source = readFileSync(
      new URL(`../../screens/redesign/${screen}.tsx`, import.meta.url),
      'utf8',
    );
    expect(source).toMatch(/style=\{styles\.back(?:Label|Text)\}>\{MONEY_SECTION_NAME\}/);
    expect(source).not.toContain('Follow the money');
  });

  it('names the committee empty-state exit without changing campaign-money tabs', () => {
    const source = readFileSync(
      new URL('../../screens/redesign/CommitteeMoneyScreen.tsx', import.meta.url),
      'utf8',
    );
    expect(source).toContain('style={styles.primaryButtonLabel}>{MONEY_SECTION_NAME}');
    const tabs = readFileSync(
      new URL('../../components/campaignMoney/LegislatorProfileTabs.tsx', import.meta.url),
      'utf8',
    );
    expect(tabs).toContain("{ key: 'money', label: 'Campaign money' }");
  });
});
