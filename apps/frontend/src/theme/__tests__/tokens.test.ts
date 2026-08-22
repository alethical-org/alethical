import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { theme } from '../tokens';

describe('green text and green graphics use different roles', () => {
  it('uses the AA green for text while leaving the brighter graphic green available', () => {
    expect(theme.colors.text.green).toBe('#0f7a45');
    expect(theme.colors.brand.graphics).toBe('#149d5b');
  });
});

describe('cyan panels use one shared surface', () => {
  it('uses the About page cyan pair everywhere', () => {
    expect(theme.colors.cyan).toEqual({
      surface: '#f4fafc',
      border: '#dbeef4',
      ink: '#2b6377',
    });
  });
});

describe('editable fields use the approved web focus ring', () => {
  it('uses the narrower stronger web ring without changing the native shadow', () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'tokens.ts'),
      'utf8',
    );
    const focusPurple = source.slice(
      source.indexOf('focusPurple: Platform.select({'),
      source.indexOf('glowGreen: Platform.select({'),
    );

    expect(theme.shadows.focusPurple).toEqual({
      boxShadow: '0 0 0 3px rgba(91,48,214,0.22)',
    });
    expect(focusPurple).toContain("shadowColor: '#5b30d6'");
    expect(focusPurple).toContain('shadowOpacity: 0.14');
    expect(focusPurple).toContain('shadowRadius: 4');
    expect(focusPurple).toContain('elevation: 0');
  });
});
