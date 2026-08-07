import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const htmlTemplate = readFileSync(resolve(__dirname, '../../public/index.html'), 'utf8');

describe('exported HTML connection hints', () => {
  it('starts API and font connections before the website program', () => {
    const headEnd = htmlTemplate.indexOf('</head>');
    const firstScript = htmlTemplate.indexOf('<script');
    const apiHint = '<link rel="preconnect" href="https://api.alethical.com" crossorigin />';
    const cssFontHint = '<link rel="preconnect" href="https://fonts.googleapis.com" />';
    const fileFontHint = '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />';

    expect(headEnd).toBeGreaterThan(-1);
    expect(firstScript).toBeGreaterThan(headEnd);
    expect(htmlTemplate.indexOf(apiHint)).toBeGreaterThan(-1);
    expect(htmlTemplate.indexOf(cssFontHint)).toBeGreaterThan(-1);
    expect(htmlTemplate.indexOf(fileFontHint)).toBeGreaterThan(-1);
    expect(htmlTemplate.indexOf(apiHint)).toBeLessThan(headEnd);
    expect(htmlTemplate.indexOf(cssFontHint)).toBeLessThan(headEnd);
    expect(htmlTemplate.indexOf(fileFontHint)).toBeLessThan(headEnd);
  });

  it('does not keep the late font preconnect in the app program', () => {
    const app = readFileSync(resolve(__dirname, '../../App.tsx'), 'utf8');

    expect(app).not.toContain("preconnect.href = 'https://fonts.gstatic.com'");
  });
});
