import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(join(__dirname, '..', 'SearchLegislatorsScreen.tsx'), 'utf8');

describe('Search Legislators address link', () => {
  it('keeps one address-search link visible in both wide and narrow layouts', () => {
    expect(source).toContain('const addressLink = (');
    expect(source).toContain('<FindMyLegislatorLink');
    expect(source).toContain('{!isMobile ? addressLink : null}');
    expect(source).toContain('helper={isMobile ? addressLink : undefined}');
  });

  it('uses a real link to Find My Legislator with the approved words', () => {
    expect(source).toContain('...linkProps(routePath.findMyLegislator()');
    expect(source).toContain('Find your legislator by address');
    expect(source).toContain('aria-hidden');
  });
});
