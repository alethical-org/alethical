import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('privacy copy', () => {
  it('uses the same top bar and footer as the home page', () => {
    const source = readFileSync(join(__dirname, '..', '..', 'screens', 'LegalScreens.tsx'), 'utf8');

    expect(source).toContain('<TopNav');
    expect(source).toContain('<Footer');
    expect(source).not.toContain('<ScreenView');
  });

  it('does not claim that district matching sends a reader location to LCC', () => {
    const source = readFileSync(join(__dirname, '..', '..', 'screens', 'LegalScreens.tsx'), 'utf8');

    expect(source).toContain('The United States Census Bureau');
    expect(source).toContain('The Minnesota Geospatial Information Office');
    expect(source).toContain('while we show Minnesota address suggestions');
    expect(source).toContain('house number and street name entered so far');
    expect(source).not.toContain('We send latitude and longitude to its public district service');
  });

  it('explains where Contact us messages go', () => {
    const source = readFileSync(join(__dirname, '..', '..', 'screens', 'LegalScreens.tsx'), 'utf8');

    expect(source).toContain('Contact messages');
    expect(source).toContain('Resend, when you use Contact us');
    expect(source).toContain('Google Workspace inbox');
    expect(source).toContain('does not store the form in its database');
  });

  it('names the anonymous page counter and its privacy limits', () => {
    const source = readFileSync(join(__dirname, '..', '..', 'screens', 'LegalScreens.tsx'), 'utf8');

    expect(source).toContain('Vercel Web Analytics receives the page path');
    expect(source).toContain('anything following “?” or “#” is removed');
    expect(source).toContain('uses no analytics cookies');
    expect(source).toContain('account identifier is not sent to Vercel');
    expect(source).toContain('before each page-use event');
    expect(source).toContain('current signed-in account');
    expect(source).toContain('Team and test accounts');
  });

  it('distinguishes anonymous history from surviving account records', () => {
    const source = readFileSync(join(__dirname, '..', '..', 'screens', 'LegalScreens.tsx'), 'utf8');

    expect(source).toContain('bill, legislator, or money search returns results');
    expect(source).toContain('random retry key for that action');
    expect(source).toContain('not used to recognize you across visits');
    expect(source).toContain('first signed-in use');
    expect(source).toContain('bill or committee follows');
    expect(source).toContain('including accounts awaiting email confirmation');
    expect(source).toContain('totals can decrease');
    expect(source).not.toContain('New bill-watch totals come from the existing watch records');
  });

  it('states the speed population and the separate observation floor for each score', () => {
    const source = readFileSync(join(__dirname, '..', '..', 'screens', 'LegalScreens.tsx'), 'utf8');

    expect(source).toContain('50 actual measurements for that score');
    expect(source).toContain('30 complete UTC days');
    expect(source).toContain('known bots');
    expect(source).toContain('Team visits may remain');
    expect(source).not.toContain('50 measured visits');
  });

  it('names every new public Traffic source and the detail it receives', () => {
    const source = readFileSync(join(__dirname, '..', '..', 'screens', 'LegalScreens.tsx'), 'utf8');

    expect(source).toContain('Google Search Console');
    expect(source).toContain('Bing Webmaster Tools');
    expect(source).toContain('Checkly');
    expect(source).toContain('Cloudflare Web Analytics');
    expect(source).toContain('does not publish search phrases');
    expect(source).toContain('public Alethical addresses');
    expect(source).toContain('uses no cookies, local storage, or fingerprinting');
  });

  it('keeps the operating instructions aligned with collection and source boundaries', () => {
    const guide = readFileSync(
      join(__dirname, '../../../../../docs/product-onboarding/traffic-guide.md'),
      'utf8',
    );

    expect(guide).toContain('GET /api/v1/site-metrics/collection');
    expect(guide).toContain('5 fixed action names');
    expect(guide).toContain('optional UUID v4');
    expect(guide).toContain('not an exact deletion deadline');
    expect(guide).toContain('Total user accounts on the public `/site-metrics` page');
    expect(guide).toContain('Accounts first used counts first signed-in use, not sign-ups.');
    expect(guide).toContain('11 known team mailboxes');
    expect(guide).toContain('4 exact administrator mailboxes');
    expect(guide).toContain('`CHECKLY_ACCOUNT_ID`, required to match');
    expect(guide).toContain('confidence `sampleSize`');
    expect(guide).toContain('`documentLoads`, not `firstLoad`');
    expect(guide).toContain('Legislator');
    expect(guide).toContain('those tabs from other legislator-page visits');
    expect(guide).not.toContain('50 measured visits');
    expect(guide).not.toContain('currently holding 3 of the 4');
    expect(guide).not.toContain('7,857 real first-load measurements');
    expect(guide).not.toContain('keeps that period unsampled');
  });
});
