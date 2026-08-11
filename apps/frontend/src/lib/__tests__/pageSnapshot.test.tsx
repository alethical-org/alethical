import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import billFixture from './fixtures/bill-page-snapshot.json';
import legislatorFixture from './fixtures/legislator-page-snapshot.json';

/**
 * The one property release 2 of #1325 lives or dies on: **the text served in the
 * first response is text the app itself then draws.** There is no robot-only
 * wording to keep honest, so the check cannot be "someone was careful."
 *
 * For a bill it is mechanical. The Summary tab is a real component that renders
 * without a browser, so this file feeds one real production payload through the
 * app's own mapper into `<SummaryTab>`, feeds the *same* payload through the
 * snapshot builder, and asserts every line the snapshot serves appears in what
 * the component produced. Change either side alone and this fails.
 *
 * The legislator profile screen cannot be rendered the same way — it needs
 * navigation, auth and query providers — so its guarantee is structural instead:
 * the strings come from shared helpers, and a test below reads the two screen
 * files and fails if either stops calling them.
 */

// Icons carry no text, and their native entry point will not load outside a
// device. Stubbing them leaves every string this file compares untouched.
vi.mock('react-native-svg', () => {
  const stub = () => null;
  return {
    default: stub,
    Svg: stub,
    Circle: stub,
    Ellipse: stub,
    G: stub,
    Text: stub,
    TSpan: stub,
    TextPath: stub,
    Path: stub,
    Polygon: stub,
    Polyline: stub,
    Line: stub,
    Rect: stub,
    Use: stub,
    Image: stub,
    Symbol: stub,
    Defs: stub,
    LinearGradient: stub,
    RadialGradient: stub,
    Stop: stub,
    ClipPath: stub,
    Pattern: stub,
    Mask: stub,
    Marker: stub,
    ForeignObject: stub,
  };
});
// The Track button copies to the clipboard; the native module will not load here
// and nothing this file compares comes from it.
vi.mock('expo-clipboard', () => ({ setStringAsync: async () => true }));
// The Summary tab warms the suggested-answer cache on mount. It fetches nothing
// this test reads; without a query provider it would simply throw.
vi.mock('../../hooks/useAppQueries', () => ({
  usePrefetchSuggestedAnswer: () => () => {},
  useTrackedListState: () => ({ state: () => 'ready', recheck: () => {} }),
}));
vi.mock('../../providers/trackedBillWriteContext', () => ({
  useTrackedBillWrite: () => ({ failures: {}, retryTrackedBill: () => {} }),
}));

const { SummaryTab } = await import('../../components/billDetail/SummaryTab');
const { BillHeader } = await import('../../components/billDetail/BillHeader');
const { bienniumEyebrow } = await import('../billDetail');
const { buildBillShareContent } = await import('../share');
const { mapBillDetail } = await import('../../data/api');
const {
  billDirectoryPageSnapshot,
  billPageSnapshot,
  homePageSnapshot,
  injectPageSnapshot,
  legislatorDirectoryPageSnapshot,
  legislatorPageSnapshot,
  renderPageSnapshot,
  SNAPSHOT_MARKER_END,
  SNAPSHOT_MARKER_START,
} = await import('../pageSnapshot');
const { legislatorDisplayName, legislatorDistrictLine } = await import('../legislatorProfile');

const HERE = dirname(fileURLToPath(import.meta.url));

/** Visible text only, with runs of whitespace flattened, the way a reader sees it. */
function visibleText(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Every string the app renders as a text of its own, decoded and trimmed. Membership
 * here is an equality test, not a containment one: a served line that has been
 * shortened, re-punctuated or re-worded is no longer one of these, even though the
 * app's full text still contains it.
 */
function drawnTextNodes(html: string): string[] {
  return html
    .split(/<[^>]+>/)
    .map((piece) => visibleText(piece))
    .filter(Boolean);
}

/**
 * Does `needle` appear in `haystack` as its own run of characters? Plain
 * `toContain` is too generous for a short value: the app draws `12B` as a
 * district, which contains a `12` nobody wrote. That is exactly how a
 * layout-invented count would slip through.
 */
function containsWhole(haystack: string, needle: string): boolean {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^0-9A-Za-z])${escaped}([^0-9A-Za-z]|$)`).test(haystack);
}

/**
 * The bill page as the app draws it: the header (H1 + session eyebrow) and the
 * Summary tab (key points, facts rail, source line). The props mirror what
 * `screens/redesign/BillDetailWebScreen.tsx` passes, so the comparison is against
 * the real components with the real payload, not against a description of them.
 */
function appHtml(payload: unknown = billFixture): string {
  const bill = mapBillDetail(payload as never, []);
  return (
    renderToStaticMarkup(
      <BillHeader
        title={bill.aiAnalysis?.shortTitle ?? bill.title}
        fullTitle={bill.title}
        eyebrow={bienniumEyebrow(bill.id, bill.session ?? bill.sessionLabel)}
        omnibus={!!bill.isOmnibus}
        shareContent={buildBillShareContent({
          identifier: bill.identifier,
          billId: bill.id,
          url: '/',
        })}
        billId={bill.id}
        tracked={false}
        onTrack={() => {}}
        activeTab="summary"
        onSelectTab={() => {}}
        onAllBills={() => {}}
      />,
    ) +
    renderToStaticMarkup(
      <SummaryTab
        bill={bill}
        showAsk={false}
        onAsk={() => {}}
        onOpenUrl={() => {}}
        onOpenLegislator={() => {}}
        onOpenBill={() => {}}
        isDesktop
        updatedLabel="Updated"
        onJumpToActions={() => {}}
      />,
    )
  );
}

function appText(payload: unknown = billFixture): string {
  return visibleText(appHtml(payload));
}

/** The same bill with its bullets removed — the app then shows the prose summary. */
const withoutKeyPoints = {
  ...billFixture,
  ai_analysis: { ...billFixture.ai_analysis, key_points: [] },
};

describe('the bill snapshot says only what the app then draws', () => {
  const snapshot = billPageSnapshot(billFixture as never);

  it('serves the heading, summary bullets and facts the Summary tab renders', () => {
    const drawn = appText();

    // The heading is the app's own H1 — its plain-language short title.
    expect(snapshot.heading).toBe(billFixture.ai_analysis.short_title);
    // The bill code is the amber badge in the facts rail.
    expect(drawn).toContain('HF 719');
    expect(snapshot.subheading).toContain('HF 719');

    const nodes = drawnTextNodes(appHtml());
    expect(snapshot.body.length).toBeGreaterThan(0);
    for (const line of snapshot.body) {
      expect(nodes).toContain(line);
    }
    for (const item of snapshot.facts) {
      for (const line of item.lines) {
        expect(containsWhole(drawn, line)).toBe(true);
      }
      // Labels are layout chrome, so only their wording has to agree, not their case.
      expect(drawn.toLowerCase()).toContain(item.label.toLowerCase());
    }
  });

  it('falls back to the prose summary exactly where the Summary tab does', () => {
    const prose = billPageSnapshot(withoutKeyPoints as never);
    expect(prose.bodyIsList).toBe(false);
    expect(prose.body).toHaveLength(1);
    expect(drawnTextNodes(appHtml(withoutKeyPoints))).toContain(prose.body[0]);
  });

  it('links only where the app links, to the same address', () => {
    const rendered = renderPageSnapshot(snapshot);
    const drawnHtml = appHtml();

    const overview = snapshot.links.find((link) => link.label === 'Bill overview');
    expect(overview?.href).toBe('https://www.revisor.mn.gov/bills/94/2025/0/HF/719/');
    expect(drawnHtml).toContain(overview!.href);

    const author = snapshot.links.find((link) => link.href.startsWith('/legislators/'));
    expect(author?.href).toBe('/legislators/mary-franson');
    expect(drawnHtml).toContain('/legislators/mary-franson');

    expect(rendered).toContain('href="/bills"');
  });

  it('never prints the bill‘s statutory title, and names an un-summarised bill by its number', () => {
    expect(renderPageSnapshot(snapshot)).not.toContain(billFixture.title.slice(0, 60));

    // The real payload with its plain-language analysis taken away — the case an
    // un-enriched bill produces, and the one where the app's own heading falls back
    // to the 400-character statutory title that rule 10 keeps off the page.
    const unenriched = billPageSnapshot({ ...billFixture, ai_analysis: null } as never);
    expect(unenriched.heading).toBe('HF 719');
    expect(unenriched.body).toEqual([]);
    expect(renderPageSnapshot(unenriched)).not.toContain(billFixture.title.slice(0, 40));

    const bare = billPageSnapshot({ id: '94-2025-HF719' });
    expect(bare.heading).toBe('HF 719');
    expect(renderPageSnapshot(bare)).not.toContain('undefined');
  });

  it('states no count or total of its own', () => {
    // grounded-answers rule 11: a number the layout worked out for itself reads as
    // a fact about the record. Every number here belongs to a line the app draws.
    const drawn = appText();
    const numbers = visibleText(renderPageSnapshot(snapshot)).match(/\d[\d,.]*/g) ?? [];
    expect(numbers.length).toBeGreaterThan(0);
    for (const number of numbers) {
      expect(containsWhole(drawn, number)).toBe(true);
    }
  });
});

describe('the legislator snapshot says only what the profile draws', () => {
  const snapshot = legislatorPageSnapshot(legislatorFixture as never);

  it('reads its name and district from the helper both profile screens use', () => {
    expect(snapshot.heading).toBe(legislatorDisplayName(legislatorFixture.full_name, 'House'));
    expect(snapshot.heading).toBe('Rep. Aisha Gomez');
    expect(snapshot.subheading).toContain(legislatorDistrictLine('House', '62A'));
    expect(snapshot.subheading).toBe('House District 62A · Democratic-Farmer-Labor');
  });

  it('lists the committees the profile lists, with their roles', () => {
    expect(snapshot.body).toContain('Ways and Means');
    expect(snapshot.body).toContain('Taxes (Co-Chair)');

    const none = legislatorPageSnapshot({
      full_name: 'Pat Doe',
      current_service: { chamber: 'senate' },
    });
    expect(none.body).toEqual(['No current committee assignments on record.']);
    expect(none.heading).toBe('Sen. Pat Doe');
  });

  it('carries the contact rows and the official profile link', () => {
    const phone = snapshot.facts.find((item) => item.label === 'Phone');
    expect(phone?.lines).toEqual([legislatorFixture.current_service.phone]);

    const office = snapshot.facts.find((item) => item.label === 'Capitol office');
    expect(office?.lines).toEqual(legislatorFixture.current_service.office_address.split('\n'));

    const official = snapshot.links.find((link) => link.label === 'Official House profile');
    expect(official?.href).toBe(legislatorFixture.current_service.profile_url);
    expect(snapshot.links.some((link) => link.href === '/legislators')).toBe(true);
  });
});

describe('directory rows never guess missing facts', () => {
  it('uses a bill status when no plain title is ready', () => {
    const snapshot = billDirectoryPageSnapshot(
      [{ id: '94-2025-HF5', status_key: 'in_committee' }],
      1,
      1,
      10,
    );

    expect(snapshot.records?.[0]).toMatchObject({ label: 'HF 5', detail: 'In Committee' });
  });

  it('shows a district but never guesses Senate when chamber data is missing', () => {
    const snapshot = legislatorDirectoryPageSnapshot(
      [
        {
          id: 'member-1',
          full_name: 'Pat Doe',
          current_service: { district: { code: '12A' } },
        },
      ],
      1,
      1,
      12,
    );

    expect(snapshot.records?.[0]).toMatchObject({ label: 'Pat Doe', detail: 'District 12A' });
    expect(snapshot.records?.[0].detail).not.toContain('Senate');
  });
});

describe('both profile screens keep reading the shared name helper', () => {
  // The screens cannot be rendered here, so this is the drift alarm in their place:
  // if either grows its own copy of the name or district format again, the served
  // heading and the drawn heading can disagree and nothing else would notice.
  it.each([
    'src/screens/redesign/LegislatorProfileWebScreen.tsx',
    'src/screens/redesign/LegislatorProfileMobileScreen.tsx',
  ])('%s calls legislatorDisplayName', (path) => {
    const source = readFileSync(join(HERE, '../../..', path), 'utf8');
    expect(source).toContain('legislatorDisplayName');
    expect(source).not.toMatch(/function (officialName|honorificName)\s*\(/);
  });
});

describe('rendering', () => {
  it('escapes every stored string it prints', () => {
    const hostile = billPageSnapshot({
      id: '94-2025-HF1',
      ai_analysis: {
        short_title: 'Guns & <script>alert("x")</script> Reform',
        summary: "It's a 5 < 6 rule",
      },
      official_url: 'https://example.test/?a=1&b="2"',
    });
    const html = renderPageSnapshot(hostile);
    expect(html).not.toContain('<script>');
    expect(html).toContain('Guns &amp; &lt;script&gt;');
    expect(html).toContain('It&#39;s a 5 &lt; 6 rule');
    expect(html).toContain('href="https://example.test/?a=1&amp;b=&quot;2&quot;"');
  });

  it('drops into the shell between its markers, leaving the rest untouched', () => {
    const shell = `<body><div id="root">${SNAPSHOT_MARKER_START}${SNAPSHOT_MARKER_END}</div></body>`;
    const filled = injectPageSnapshot(shell, '<p>hello</p>');
    expect(filled).toBe(
      `<body><div id="root">${SNAPSHOT_MARKER_START}<p>hello</p>${SNAPSHOT_MARKER_END}</div></body>`,
    );
    expect(() => injectPageSnapshot('<body></body>', '<p>hi</p>')).toThrow();
  });

  it('is inside the app’s mount point in the shipped shell, so React clears it on render', () => {
    const shell = readFileSync(join(HERE, '../../../public/index.html'), 'utf8');
    expect(shell).toContain(
      `<div id="root">${SNAPSHOT_MARKER_START}${renderPageSnapshot(homePageSnapshot())}${SNAPSHOT_MARKER_END}</div>`,
    );
    // The look ships with the shell, so no address pays for CSS of its own.
    expect(shell).toContain('id="alethical-page-snapshot"');
    expect(shell).toContain('.page-snapshot');
  });
});
