import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..', '..');

const legacyTextArrowLimits: Record<string, number> = {
  'components/ChangeBlock.tsx': 1,
  'components/billDetail/ActionsTab.tsx': 1,
  'components/billDetail/BillNotFound.tsx': 2,
  'components/billDetail/CitationCard.tsx': 1,
  'components/billDetail/FactsRail.tsx': 5,
  'components/billDetail/VersionsTab.tsx': 1,
  'components/billDetail/VotesTab.tsx': 1,
  'components/home/SessionWatchCard.tsx': 1,
  'components/search/BillResultCard.tsx': 1,
  'screens/redesign/AskAnswerScreen.tsx': 11,
  'screens/redesign/BillDetailScreen.tsx': 6,
  'screens/redesign/HomeSignedOutScreen.tsx': 4,
  'screens/redesign/LegislatorProfileMobileScreen.tsx': 2,
  'screens/redesign/LegislatorProfileWebScreen.tsx': 1,
  'screens/redesign/SearchLegislatorsScreen.tsx': 1,
};

function tsxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : tsxFiles(path);
    return entry.name.endsWith('.tsx') ? [path] : [];
  });
}

function visibleTextArrowCount(source: string) {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  return withoutComments.match(/→/g)?.length ?? 0;
}

describe('mobile link arrows', () => {
  it('blocks new text arrows so phone links use the shared, consistently drawn arrow', () => {
    for (const path of tsxFiles(SRC)) {
      const file = relative(SRC, path);
      const arrowCount = visibleTextArrowCount(readFileSync(path, 'utf8'));
      expect(arrowCount, `${file} added a phone-dependent text arrow`).toBeLessThanOrEqual(
        legacyTextArrowLimits[file] ?? 0,
      );
    }
  });
});
