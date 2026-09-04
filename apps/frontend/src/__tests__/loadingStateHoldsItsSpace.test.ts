import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The pair this pins is the page shell's own style block and every loading
// state on a record address. Both exist for one reason: a reader must not have
// the page move under them while it loads (issue #1982).
const root = join(__dirname, '..', '..');
const shell = readFileSync(join(root, 'public', 'index.html'), 'utf8');
const helper = readFileSync(join(root, 'src', 'components', 'Skeleton.tsx'), 'utf8');
const screens = {
  'bill, phone': 'BillDetailScreen.tsx',
  'bill, desktop': 'BillDetailWebScreen.tsx',
  'legislator, phone': 'LegislatorProfileMobileScreen.tsx',
  'legislator, desktop': 'LegislatorProfileWebScreen.tsx',
  'committee money': 'CommitteeMoneyScreen.tsx',
} as const;

describe('a loading page holds its space', () => {
  it('states the page margin in the first response, so nothing lifts when the app arrives', () => {
    // The browser's default is 8px and react-native-web zeroes it once the
    // program runs. Saying 0 up front is what makes that a no-op rather than a
    // movement on every address.
    expect(shell).toMatch(/<style id="expo-reset">[\s\S]*?body \{\s*margin: 0;/);
  });

  it('measures the reservation from the window rather than a guessed number', () => {
    expect(helper).toContain('export function useOneScreenTall()');
    expect(helper).toContain('const { height } = useWindowDimensions();');
    expect(helper).toContain('minHeight: height');
  });

  it.each(Object.entries(screens))(
    'holds a screenful on the %s address, so the footer starts below the fold',
    (_name, file) => {
      const source = readFileSync(join(root, 'src', 'screens', 'redesign', file), 'utf8');
      expect(source).toContain(
        "import { Skeleton, useOneScreenTall } from '../../components/Skeleton'",
      );
      expect(source).toContain('const oneScreenTall = useOneScreenTall();');
      // Around EVERY state, never the loading one alone. Reserving only while
      // loading releases the space on a failed load and pulls the footer up into
      // view, which measured worse than the defect it was meant to fix.
      expect(source).toMatch(/style=\{\[?[^}]*oneScreenTall/);
      expect(source).not.toMatch(/accessibilityLabel="Loading [a-z]+" style=\{oneScreenTall\}/);
    },
  );
});
