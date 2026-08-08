import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const htmlTemplate = readFileSync(resolve(__dirname, '../../public/index.html'), 'utf8');

describe('exported HTML connection hints', () => {
  it('starts API connections and the font stylesheet before the website program', () => {
    const headEnd = htmlTemplate.indexOf('</head>');
    const firstScript = htmlTemplate.indexOf('<script');
    const apiHint = '<link rel="preconnect" href="https://api.alethical.com" crossorigin />';
    const cssFontHint = '<link rel="preconnect" href="https://fonts.googleapis.com" />';
    const fileFontHint = '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />';
    const fontStylesheet = 'id="alethical-fonts"';

    expect(headEnd).toBeGreaterThan(-1);
    expect(firstScript).toBeGreaterThan(headEnd);
    expect(htmlTemplate.indexOf(apiHint)).toBeGreaterThan(-1);
    expect(htmlTemplate.indexOf(cssFontHint)).toBeGreaterThan(-1);
    expect(htmlTemplate.indexOf(fileFontHint)).toBeGreaterThan(-1);
    expect(htmlTemplate.indexOf(fontStylesheet)).toBeGreaterThan(-1);
    expect(htmlTemplate.indexOf(apiHint)).toBeLessThan(headEnd);
    expect(htmlTemplate.indexOf(cssFontHint)).toBeLessThan(headEnd);
    expect(htmlTemplate.indexOf(fileFontHint)).toBeLessThan(headEnd);
    expect(htmlTemplate.indexOf(fontStylesheet)).toBeLessThan(headEnd);
    expect(htmlTemplate.indexOf(fontStylesheet)).toBeLessThan(firstScript);
  });

  it('does not keep late or unused font requests in the app program', () => {
    const app = readFileSync(resolve(__dirname, '../../App.tsx'), 'utf8');
    const tokens = readFileSync(resolve(__dirname, '../theme/tokens.ts'), 'utf8');

    expect(app).not.toContain("preconnect.href = 'https://fonts.gstatic.com'");
    expect(app).not.toContain('ensureFonts');
    expect(htmlTemplate).not.toContain('family=Sora');
    expect(htmlTemplate).not.toContain('300;400;500;600;700;800;900');
    expect(tokens).not.toContain('sora: webFont');
  });
});
