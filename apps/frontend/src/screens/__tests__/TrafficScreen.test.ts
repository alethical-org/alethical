import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(join(__dirname, '..', 'TrafficScreen.tsx'), 'utf8');

describe('public Traffic page', () => {
  it('shows only the 3 accurate page-view totals and explains their periods', () => {
    expect(SOURCE).not.toContain('Estimated visitors');
    expect(SOURCE.match(/label="Page views"/g)).toHaveLength(6);
    expect(SOURCE).toContain('LAST 24 HOURS');
    expect(SOURCE).toContain('LAST 7 DAYS');
    expect(SOURCE).toContain('LAST 30 DAYS');
  });

  it('has 1 top heading and the accepted loading and unavailable states', () => {
    expect(SOURCE.match(/aria-level=\{1\}/g)).toHaveLength(1);
    expect(SOURCE).toContain('Traffic totals are loading.');
    expect(SOURCE).toContain('Traffic data is temporarily unavailable.');
    expect(SOURCE).toContain('Counted by Vercel');
  });

  it('uses the shared shell and keeps the privacy link in the same tab', () => {
    expect(SOURCE).toContain('<TopNav');
    expect(SOURCE).toContain('<Footer');
    expect(SOURCE).toContain('routePath.privacy()');
    expect(SOURCE).toContain("navigation.navigate('Privacy')");
  });
});
