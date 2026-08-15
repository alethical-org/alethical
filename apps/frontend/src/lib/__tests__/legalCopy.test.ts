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
    expect(source).toContain('When the private team list is configured');
    expect(source).not.toContain('Alethical also discards fixed action records');
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
});
