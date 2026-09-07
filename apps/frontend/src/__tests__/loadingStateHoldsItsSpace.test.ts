import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The pair this pins is the page shell's own style block and every loading
// state on a record address. Both exist for one reason: a reader must not have
// the page move under them while it loads (issue #1982).
const root = join(__dirname, '..', '..');
const shell = readFileSync(join(root, 'public', 'index.html'), 'utf8');
const helper = readFileSync(join(root, 'src', 'components', 'Skeleton.tsx'), 'utf8');
const shellFrame = readFileSync(
  join(root, 'src', 'components', 'search', 'searchPieces.tsx'),
  'utf8',
);
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

  it('keeps the header band\u2019s space when a failed page hands the frame none', () => {
    // The loading state hands over a placeholder band; the failed state hands
    // over nothing. Letting the band collapse dropped the whole page 207px in
    // the paint that says the load failed \u2014 0.1411 on a desktop bill page and
    // 0.1479 on a legislator profile, against a passing mark of 0.1 (#1998). The
    // frame remembers the last band it was handed and holds that height.
    expect(shellFrame).toContain('const [lastHeroHeight, setLastHeroHeight] = useState(0);');
    expect(shellFrame).toContain(
      'style={hero == null && lastHeroHeight > 0 ? { height: lastHeroHeight } : null}',
    );
    // Measured only while a band is actually there, so a page handed none can
    // never overwrite the height it is holding with zero.
    expect(shellFrame).toMatch(/if \(hero != null && height > 0 && height !== lastHeroHeight\)/);
  });

  it('lays the served text out in fonts the reader already has', () => {
    // Libre Franklin is fetched with display=swap, which paints the reader's own
    // system font first and swaps ours in when it arrives. The two set different
    // widths, so a long bill title fits on 2 lines in one and wraps to 3 in the
    // other: 0.0531 of movement on a bill page at 390x844, against a passing
    // mark of 0.1 for the whole page (#1997). Naming only fonts already on the
    // device means what paints first is what stays.
    const block = shell.match(/<style id="alethical-page-snapshot">[\s\S]*?<\/style>/)?.[0];
    expect(block).toBeTruthy();
    // Scoped to that one rule's own braces: the hidden marks below it name
    // Libre Franklin on purpose, and a greedier pattern would read them as this
    // rule's and pass either way.
    expect(block).toMatch(
      /\.page-snapshot \{[^}]*font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;/,
    );
    expect(block).not.toMatch(/\.page-snapshot \{[^}]*font-family: 'Libre Franklin'/);
  });

  it('still asks for the web font while the served text is on screen', () => {
    // Removing the only early mention of Libre Franklin also removes the reason
    // the browser fetches the file early: measured at 476ms with the old stack
    // and 9057ms without it, which moves the swap onto the app's own text rather
    // than removing it. Two hidden marks ask for it at the two weights the
    // served text used, and lay out nothing.
    const block = shell.match(/<style id="alethical-page-snapshot">[\s\S]*?<\/style>/)?.[0];
    expect(block).toMatch(/\.page-snapshot::before,\s*\n?\s*\.page-snapshot::after \{/);
    expect(block).toMatch(
      /\.page-snapshot::before,[\s\S]*?font-family: 'Libre Franklin';[\s\S]*?visibility: hidden;/,
    );
    // display: none would make the browser skip the font altogether.
    expect(block).not.toMatch(/\.page-snapshot::before,[\s\S]*?display: none;/);
  });

  it.each([
    ['bill, desktop', 'BillDetailWebScreen.tsx'],
    ['legislator, desktop', 'LegislatorProfileWebScreen.tsx'],
  ])('hands the frame a placeholder band while the %s page loads', (_name, file) => {
    // The held height above is only ever right because a band was handed over
    // first. A loading state that stopped doing that would leave nothing to hold.
    const source = readFileSync(join(root, 'src', 'screens', 'redesign', file), 'utf8');
    expect(source).toMatch(/isLoading\)\s*\{\s*return shell\([^;]*HeroSkeleton \/>\);/);
  });
});
