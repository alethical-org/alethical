import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('privacy copy', () => {
  it('does not claim that district matching sends a reader location to LCC', () => {
    const source = readFileSync(join(__dirname, '..', '..', 'screens', 'LegalScreens.tsx'), 'utf8');

    expect(source).toContain('The United States Census Bureau');
    expect(source).toContain('The Minnesota Geospatial Information Office');
    expect(source).not.toContain('We send latitude and longitude to its public district service');
  });
});
