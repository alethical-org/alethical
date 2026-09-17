import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHUNKS = readFileSync(join(HERE, '..', 'screenChunks.ts'), 'utf8');
const SCREEN = readFileSync(
  join(HERE, '..', '..', 'screens', 'redesign', 'CommitteeMoneyScreen.tsx'),
  'utf8',
);
const PROFILE = readFileSync(
  join(HERE, '..', '..', 'screens', 'LegislatorProfileScreen.tsx'),
  'utf8',
);

/**
 * The committee money screen draws a chart in its first frame only if the chart's
 * code has arrived with the screen. Fetched after the screen mounted, the card drew
 * "Loading the contribution breakdown…" and then the chart about 90 ms later, which
 * read as an old page being replaced by a new one (measured live 17 Sep 2026).
 */
describe('the committee money screen arrives with its chart code', () => {
  it('waits for the screen’s pieces before handing the screen to the router', () => {
    expect(CHUNKS).toMatch(
      /CommitteeMoney: \(\) =>\s*import\('\.\.\/screens\/redesign\/CommitteeMoneyScreen'\)\.then\(\(m\) =>\s*m\.committeeMoneyScreenPieces\(\)\.then\(/,
    );
  });

  it('downloads the chart piece and the payment reads together, not one after the other', () => {
    const pieces = SCREEN.match(
      /export function committeeMoneyScreenPieces\(\): Promise<void> \{([\s\S]*?)\n\}/,
    )?.[1];
    expect(pieces).toBeDefined();
    expect(pieces).toContain('Promise.all([');
    expect(pieces).toContain('preloadMoneyDetails()');
    expect(pieces).toContain("import('../../data/campaignMoneyDetails')");
    // Neither optional piece may hold the screen back.
    expect(pieces?.match(/\.catch\(\(\) => undefined\)/g)).toHaveLength(2);
  });
});

/**
 * A money-tab profile address drew its header, then filled the band under the tab
 * strip about 100 ms later when the tab's code landed (live, 17 Sep 2026). The tab's
 * pieces now download with the screen when the address names the tab.
 */
describe('a money-tab profile address arrives with its tab code', () => {
  it('waits for the profile’s pieces before handing the screen to the router', () => {
    expect(CHUNKS).toMatch(
      /LegislatorProfile: \(\) =>\s*import\('\.\.\/screens\/LegislatorProfileScreen'\)\.then\(\(m\) =>\s*m\.legislatorProfileScreenPieces\(\)\.then\(/,
    );
  });

  it('fetches the tab only when the address names it, and never holds the profile back', () => {
    const pieces = PROFILE.match(
      /export function legislatorProfileScreenPieces\([\s\S]*?\n\}/,
    )?.[0];
    expect(pieces).toBeDefined();
    expect(pieces).toContain("new URLSearchParams(search).get('tab') === 'money'");
    expect(pieces).toContain('prefetchCampaignMoneyTab()');
    expect(pieces).toContain('.catch(() => undefined)');
  });
});
