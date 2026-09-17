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

  it('lays the served text out in the app’s own typeface, which the head asks for first', () => {
    // The served text used to name only fonts already on the device, because
    // Libre Franklin came from Google after the first paint and the swap moved a
    // long title by a line (0.0531 on a bill page at 390x844, #1997). The font
    // now comes from this address and is asked for in the head before anything
    // else, so it is in place for the first paint, and the text the app replaces
    // it with is set in the same typeface at the same sizes: nothing moves at
    // the handoff, and nothing reads as an old design giving way to a new one.
    const block = shell.match(/<style id="alethical-page-snapshot">[\s\S]*?<\/style>/)?.[0];
    expect(block).toBeTruthy();
    expect(block).toMatch(
      /\.page-snapshot \{[^}]*font-family: 'Libre Franklin', Helvetica, Arial, sans-serif;/,
    );
    expect(shell).toMatch(
      /<link\s+rel="preload"\s+as="font"\s+type="font\/woff2"\s+crossorigin\s+href="\/fonts\/libre-franklin-latin\.woff2"/,
    );
    // The hidden marks that once warmed the font are gone: the preload does that job.
    expect(block).not.toContain('.page-snapshot::before');
  });

  it.each([
    ['bills', 'SearchBillsScreen.tsx'],
    ['legislators', 'SearchLegislatorsScreen.tsx'],
  ])(
    'holds a screenful around every state of the %s list, so the footer stays below the fold',
    (_name, file) => {
      // A failed list read swaps the placeholder rows for one sentence. Without a
      // reservation the page lost ~690px and the footer was pulled 449px up into
      // view: 0.1491 of unexpected movement on a desktop /bills read and 0.1082 on
      // /legislators, against a passing mark of 0.1 (#2011).
      const source = readFileSync(join(root, 'src', 'screens', 'redesign', file), 'utf8');
      expect(source).toContain(
        "import { Skeleton, useOneScreenTall } from '../../components/Skeleton'",
      );
      expect(source).toContain('const oneScreenTall = useOneScreenTall();');
      // Around EVERY state, never the loading one alone, exactly as the detail
      // pages above do it. Reserving only while loading releases the space at the
      // moment the read fails, which is the defect itself.
      expect(source).toContain('<View style={oneScreenTall}>');
    },
  );

  it.each([
    ['bills', 'SearchBillsScreen.tsx'],
    ['legislators', 'SearchLegislatorsScreen.tsx'],
  ])('gives the %s failure box the same top margin the list above it uses', (_name, file) => {
    // React reuses one div for the list branch and the failure branch, so a
    // failure box with no top margin reads to the browser as that div sliding
    // 22px up the page (#2011). The two numbers stay equal or it moves again.
    const source = readFileSync(join(root, 'src', 'screens', 'redesign', file), 'utf8');
    const listMargin = source.match(/\n {2}(?:list|grid): \{[^}]*marginTop: (\d+)/)?.[1];
    const stateMargin = source.match(/\n {2}stateBox: \{[\s\S]*?marginTop: (\d+)/)?.[1];
    expect(listMargin).toBeTruthy();
    expect(stateMargin).toBe(listMargin);
  });

  it.each([
    ['bills', 'SearchBillsScreen.tsx'],
    ['legislators', 'SearchLegislatorsScreen.tsx'],
  ])('keeps the %s heading, search box and filters in every state', (_name, file) => {
    // The first thing #2011 asks for: a reader whose list failed can still
    // retype their search. The hero is handed over unconditionally, so no branch
    // can take the box away.
    const source = readFileSync(join(root, 'src', 'screens', 'redesign', file), 'utf8');
    expect(source).toMatch(/hero=\{\s*<SearchHero/);
    expect(source).not.toMatch(/hero=\{null\}/);
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
