import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const htmlTemplate = readFileSync(resolve(__dirname, '../../public/index.html'), 'utf8');

describe('exported HTML connection hints', () => {
  it('starts the API connection and asks for our own font files before the website program', () => {
    const headEnd = htmlTemplate.indexOf('</head>');
    // Executable scripts only. The head also carries `application/ld+json` blocks
    // describing the page to search engines (#1325); a browser never fetches or
    // runs those, so they cannot delay a connection the way a program does.
    const firstScript = htmlTemplate.search(/<script(?![^>]*application\/ld\+json)/);
    const apiHint = '<link rel="preconnect" href="https://api.alethical.com" crossorigin />';
    // The 2 typefaces the first paint needs: every word, and the wordmark.
    const bodyFont = 'href="/fonts/libre-franklin-latin.woff2"';
    const wordmarkFont = 'href="/fonts/space-grotesk-latin.woff2"';
    const fontDeclarations = 'id="alethical-fonts"';

    expect(headEnd).toBeGreaterThan(-1);
    expect(firstScript).toBeGreaterThan(headEnd);
    for (const marker of [apiHint, bodyFont, wordmarkFont, fontDeclarations]) {
      expect(htmlTemplate.indexOf(marker), marker).toBeGreaterThan(-1);
      expect(htmlTemplate.indexOf(marker), marker).toBeLessThan(headEnd);
    }
    expect(htmlTemplate.indexOf(fontDeclarations)).toBeLessThan(firstScript);
    // A preload is only honoured with the same crossorigin mode the font request uses.
    expect(htmlTemplate).toMatch(
      /<link\s+rel="preload"\s+as="font"\s+type="font\/woff2"\s+crossorigin\s+href="\/fonts\/libre-franklin-latin\.woff2"/,
    );
  });

  it('serves every typeface from this address, none from Google', () => {
    expect(htmlTemplate).not.toContain('fonts.googleapis.com');
    expect(htmlTemplate).not.toContain('fonts.gstatic.com');
    const faces = htmlTemplate.match(/@font-face \{[^}]*\}/g) ?? [];
    // 3 families, each in 2 character sets, each 1 variable file for every weight the app uses.
    expect(faces).toHaveLength(6);
    for (const face of faces) {
      expect(face).toMatch(/src: url\(\/fonts\/[a-z-]+\.woff2\) format\('woff2'\)/);
      expect(face).toContain('font-display: swap');
    }
    expect(faces.filter((face) => face.includes("'Libre Franklin'"))).toHaveLength(2);
    expect(faces.filter((face) => face.includes("'JetBrains Mono'"))).toHaveLength(2);
    expect(faces.filter((face) => face.includes("'Space Grotesk'"))).toHaveLength(2);
    // The footer uses weight 300 and headings use 800, so the range has to reach both.
    expect(faces.find((face) => face.includes("'Libre Franklin'"))).toContain(
      'font-weight: 300 800',
    );
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
