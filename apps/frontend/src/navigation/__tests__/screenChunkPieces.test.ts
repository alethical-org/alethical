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
