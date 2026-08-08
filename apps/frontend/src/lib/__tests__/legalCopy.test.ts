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
});
