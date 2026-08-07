import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '../..');
const PRIMARY_SEARCH_AND_FIND_FIELDS = [
  'components/home/HomeLegislatorFinder.tsx',
  'components/search/searchPieces.tsx',
  'components/billDetail/VotesTab.tsx',
  'screens/FindMyLegislatorScreen.tsx',
  'screens/redesign/BillDetailScreen.tsx',
];

describe('site-wide search and find field focus', () => {
  it.each(PRIMARY_SEARCH_AND_FIND_FIELDS)(
    '%s uses the shared light-purple focus treatment',
    (file) => {
      const source = readFileSync(join(SRC, file), 'utf8');

      expect(source).toContain('fieldFocusRing(');
      expect(source).toContain('fieldOutlineReset');
      expect(source).not.toContain('autoFocus');
    },
  );

  it('does not focus the Find My Legislator field from page-opening code', () => {
    const source = readFileSync(join(SRC, 'screens/FindMyLegislatorScreen.tsx'), 'utf8');

    expect(source).not.toContain('.focus()');
  });
});
