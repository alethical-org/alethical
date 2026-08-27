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
  researchPageSnapshot,
  readPageSnapshot,
  renderPageSnapshot,
  SNAPSHOT_MARKER_END,
  SNAPSHOT_MARKER_START,
} = await import('../pageSnapshot');
const {
  READ_PAGE_EMPTY_BODY,
  READ_PAGE_EMPTY_TITLE,
  READ_PAGE_HEADING,
  READ_PAGE_INTRO,
  READ_PAGE_NAME,
  isoDateCapsLabel,
  isoDateCommaCapsLabel,
  pieceCardMetaLine,
  pieceMastheadLine,
  pieceReadingMinutes,
  piecePath,
  publishedResearch,
  researchDatesLine,
  researchRunsText,
  researchSourceText,
} = await import('../research');
const { MONEY_ONLY_GOES_ONE_WAY } = await import('../researchPieces/moneyOnlyGoesOneWay');
const { WHO_HAS_TO_REPORT_THEIR_MONEY } =
  await import('../researchPieces/whoHasToReportTheirMoney');
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
        onCitationPress={() => {}}
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

    const citedSections = snapshot.sections?.find(
      (section) => section.heading === 'Cited sections',
    );
    expect(citedSections?.items?.[0]).toEqual({
      label: 'Art. 1, Sec. 1 · Capital improvement appropriations',
      href: '/bills/94-2025-HF719?tab=text#ft-laws.1.1.0-1',
    });
    expect(drawnHtml).toContain(citedSections!.items![0].href!);

    expect(rendered).toContain('href="/bills"');
  });

  it('names an unresolved cited section without linking to a guess', () => {
    const unresolvedPayload = {
      ...billFixture,
      ai_analysis: {
        ...billFixture.ai_analysis,
        citations: [
          {
            ...billFixture.ai_analysis.citations[0],
            section_order: null,
          },
        ],
      },
    };
    const unresolved = billPageSnapshot(unresolvedPayload as never);
    const item = unresolved.sections?.find((section) => section.heading === 'Cited sections')
      ?.items?.[0];
    expect(item).toEqual({
      label: 'Art. 1, Sec. 1 · Capital improvement appropriations',
    });
    const html = renderPageSnapshot(unresolved);
    expect(html).toContain(item!.label);
    expect(html).not.toContain('?tab=text#ft-laws.1.1.0');
    expect(appHtml(unresolvedPayload)).not.toContain('?tab=text#ft-laws.1.1.0');
  });

  it('keeps every exact source on an unusually citation-heavy bill without a large response', () => {
    const citations = Array.from({ length: 59 }, (_, index) => ({
      ...billFixture.ai_analysis.citations[0],
      id: `citation-${index + 1}`,
      label: `Sec. ${index + 1}`,
      section_id: 'laws.0.1.0',
      section_order: index + 1,
    }));
    const heavy = billPageSnapshot({
      ...billFixture,
      ai_analysis: { ...billFixture.ai_analysis, citations },
    } as never);
    const html = renderPageSnapshot(heavy);

    expect(heavy.sections?.[0].items).toHaveLength(59);
    expect(html.match(/\?tab=text#ft-/g)).toHaveLength(59);
    expect(Buffer.byteLength(html, 'utf8')).toBeLessThan(32_000);
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

  it('carries the stored biography and the same formatted service history as the profile', () => {
    const biography = snapshot.sections?.find((section) => section.heading === 'Biography');
    expect(biography?.body).toEqual([legislatorFixture.biography]);

    const service = snapshot.sections?.find((section) => section.heading === 'Legislative Service');
    expect(service?.body).toEqual(['Elected to the House: 2018', 'Term: 4th']);
  });

  it('adds no empty biography or service section when the record has neither', () => {
    const sparse = legislatorPageSnapshot({
      full_name: 'Pat Doe',
      current_service: { chamber: 'senate' },
    });
    expect(sparse.sections).toBeUndefined();
    expect(renderPageSnapshot(sparse)).not.toContain('Biography');
    expect(renderPageSnapshot(sparse)).not.toContain('Legislative Service');
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

/**
 * A published piece is the one snapshot whose words are not a database record
 * but a person's writing, so "the served text is the drawn text" has to be
 * checked differently: the piece screen needs navigation and cannot be
 * rendered here (the same limit the legislator profile hits above), and rule 13
 * of `.claude/rules/grounded-answers.md` forbids editing that writing at all.
 *
 * So the check is that every served line IS one of the piece's own stored
 * strings, produced by the very helper the screen's paragraph renderer uses.
 * A snapshot that re-punctuated, trimmed or summarised a sentence fails, and so
 * does one that invented a figure. The drift alarm at the bottom of this file
 * fails if either screen stops reading those same fields.
 */
describe('the piece snapshot serves the piece’s own writing, unchanged', () => {
  const piece = MONEY_ONLY_GOES_ONE_WAY;
  const snapshot = researchPageSnapshot(piece);
  const html = renderPageSnapshot(snapshot);

  /** Every string the piece itself stores, exactly as the screen draws it. */
  const storedStrings = new Set<string>([
    piece.title,
    piece.dek,
    researchDatesLine(piece),
    ...(piece.newerFilingsNote ? [piece.newerFilingsNote] : []),
    ...(piece.correction ? [piece.correction.datedLabel, piece.correction.note] : []),
    ...piece.sources.map((source) => researchSourceText(source)),
    ...piece.sources.flatMap((source) => (source.noteLink ? [source.noteLink.text] : [])),
    ...[piece.shortVersion, ...piece.sections.map((section) => section.blocks)]
      .flat()
      .flatMap((block) => {
        if (block.kind === 'paragraph') return [researchRunsText(block.runs)];
        if (block.kind === 'bullets') return block.items.map((item) => researchRunsText(item));
        if (block.kind === 'note') return [block.text];
        return [...block.columns, ...block.rows.flat()];
      }),
    ...piece.sections.flatMap((section) =>
      section.methodologyInset
        ? [section.methodologyInset.title, section.methodologyInset.body]
        : [],
    ),
  ]);

  it('heads the page with the piece’s title and its two dates, nothing else', () => {
    expect(snapshot.heading).toBe(piece.title);
    expect(snapshot.subheading).toBe(researchDatesLine(piece));
    expect(snapshot.body).toEqual([piece.dek]);
    expect(snapshot.facts).toEqual([]);
  });

  it('keeps every section in the piece’s own order, under the piece’s own heading', () => {
    const headings = (snapshot.sections ?? []).map((section) => section.heading);
    expect(headings).toEqual([
      'Short version',
      ...piece.sections.map((section) => section.heading),
      'Where these numbers come from',
    ]);
  });

  it('serves each source address as a real anchor, not just its words', () => {
    const html = renderPageSnapshot(snapshot);
    const linked = piece.sources.filter((source) => source.noteLink);
    expect(linked.length).toBeGreaterThan(0);
    for (const source of linked) {
      expect(html).toContain(`<a href="${source.noteLink!.href}">`);
      expect(html).toContain(source.noteLink!.text);
    }
  });

  it('serves every sentence, bullet and table cell verbatim', () => {
    const served: string[] = [];
    for (const section of snapshot.sections ?? []) {
      for (const block of section.blocks ?? []) {
        if (block.kind === 'prose') served.push(...block.lines);
        else if (block.kind === 'bullets') served.push(...block.items);
        else if (block.kind === 'links') served.push(...block.items.map((item) => item.label));
        else served.push(...block.columns, ...block.rows.flat());
      }
    }

    // Enough of the piece to be the piece, not a teaser.
    expect(served.length).toBeGreaterThan(40);
    for (const line of served) {
      expect(storedStrings.has(line)).toBe(true);
    }

    // And nothing the piece holds is left behind.
    const proseAndBullets = [piece.shortVersion, ...piece.sections.map((s) => s.blocks)]
      .flat()
      .flatMap((block) => {
        if (block.kind === 'paragraph') return [researchRunsText(block.runs)];
        if (block.kind === 'bullets') return block.items.map((item) => researchRunsText(item));
        return [];
      });
    for (const line of proseAndBullets) {
      expect(served).toContain(line);
    }
  });

  it('states no figure of its own', () => {
    // grounded-answers rule 11, as the bill snapshot check below it: a number the
    // layout worked out for itself reads to a reader as a filed fact. Both sides
    // are read by the same tokeniser, so "$25.9M" is compared with "$25.9M" and
    // not with a boundary rule that a unit suffix would fail.
    const figures = (text: string) => text.match(/\d[\d,.]*/g) ?? [];
    const stored = new Set(figures([...storedStrings].join(' ')));
    const served = figures(visibleText(html));
    expect(served.length).toBeGreaterThan(20);
    for (const number of served) {
      expect(stored.has(number)).toBe(true);
    }
  });

  it('links back to the list, out to each source, and nowhere the site cannot honour', () => {
    expect(snapshot.links).toEqual([{ label: READ_PAGE_HEADING, href: '/read' }]);
    // One anchor back to the list, plus exactly one per source that stores an
    // address, and no others. Rule 13 requires a filing body to be named AND
    // linked at its source, and a link the reader only gets after the app runs is
    // not a link at all to anything reading the first response.
    const linked = piece.sources.filter((source) => source.noteLink);
    expect(linked.length).toBeGreaterThan(0);
    expect(html.match(/href="/g)).toHaveLength(1 + linked.length);
    for (const source of linked) {
      expect(html).toContain(`<a href="${source.noteLink!.href}">`);
    }
  });

  it('marks a table up as a table, so a figure is announced with its column', () => {
    expect(html).toContain('<table class="ps-table">');
    expect(html).toContain('<th>Principal</th>');
    expect(html).toContain('<td>Enbridge Energy</td>');
  });

  it('escapes the piece’s own punctuation rather than breaking the markup', () => {
    const hostile = researchPageSnapshot({
      ...piece,
      title: 'Money & <script>alert("x")</script>',
      dek: "It's 5 < 6",
      sections: [
        {
          heading: 'Tables & quotes',
          railLabel: 'Tables',
          blocks: [{ kind: 'table', columns: ['A & B'], rows: [['<b>c</b>']] }],
        },
      ],
    });
    const rendered = renderPageSnapshot(hostile);
    expect(rendered).not.toContain('<script>');
    expect(rendered).not.toContain('<b>c</b>');
    expect(rendered).toContain('Money &amp; &lt;script&gt;');
    expect(rendered).toContain('It&#39;s 5 &lt; 6');
  });

  it('carries a correction banner and a newer-filings banner when the piece has them', () => {
    const withBanners = researchPageSnapshot({
      ...piece,
      correction: { datedLabel: 'CORRECTED SEP 2 2026', note: 'The ratio moved from 20 to 19.' },
      newerFilingsNote: 'The Board has accepted filings since this ran.',
    });
    const headings = (withBanners.sections ?? []).map((section) => section.heading);
    expect(headings[0]).toBe('Newer filings exist');
    expect(headings[1]).toBe('CORRECTED SEP 2 2026');
    const rendered = renderPageSnapshot(withBanners);
    expect(rendered).toContain('The ratio moved from 20 to 19.');
    expect(rendered).toContain('The Board has accepted filings since this ran.');
  });
});

/**
 * The guide is the first piece served whose sources sentences each hold several
 * links, and the first with no standfirst and no short version. So this checks
 * the 3 things that differ from the research piece and nothing that does not.
 */
describe('the guide snapshot serves the guide\u2019s own writing, unchanged', () => {
  const guide = WHO_HAS_TO_REPORT_THEIR_MONEY;
  const snapshot = researchPageSnapshot(guide);
  const html = renderPageSnapshot(snapshot);

  it('heads the page with the title and the guide masthead line', () => {
    expect(snapshot.heading).toBe(guide.title);
    expect(snapshot.subheading).toBe(pieceMastheadLine(guide));
    expect(snapshot.subheading).toBe('GUIDE \u00b7 5 MIN \u00b7 WRITTEN AUGUST 2026');
  });

  it('opens with the set\u2019s name and the prose above the first heading', () => {
    // No standfirst to print, so nothing is invented to fill the slot.
    expect(guide.dek).toBe('');
    expect(snapshot.body[0]).toBe('How the Money Works');
    expect(snapshot.body.slice(1)).toEqual(
      (guide.intro ?? []).map((block) =>
        block.kind === 'paragraph' ? researchRunsText(block.runs) : '',
      ),
    );
  });

  it('draws no short-version box for a piece that has none', () => {
    const headings = (snapshot.sections ?? []).map((section) => section.heading);
    expect(headings).not.toContain('Short version');
    // 'Also on Alethical' appears because guide 1 now carries an internal link, the
    // forward link to guide 2 that its own closing paragraph promised. The snapshot
    // builder collects a piece's internal links into that section so they are reachable
    // by address before the app runs (rule 5). It is served writing the piece did not
    // author, which is why it is asserted here rather than derived from the piece.
    expect(headings).toEqual([
      ...guide.sections.map((section) => section.heading),
      'Where this comes from',
      'Also on Alethical',
    ]);
  });

  it('serves every sentence and bullet verbatim', () => {
    const stored = new Set<string>(
      [...(guide.intro ?? []), ...guide.sections.flatMap((section) => section.blocks)].flatMap(
        (block) => {
          if (block.kind === 'paragraph') return [researchRunsText(block.runs)];
          if (block.kind === 'bullets') return block.items.map(researchRunsText);
          return [];
        },
      ),
    );
    // The prose above the first heading is served in the page's body, the rest
    // inside its sections, so both are collected.
    const served: string[] = [...snapshot.body];
    for (const section of snapshot.sections ?? []) {
      for (const block of section.blocks ?? []) {
        if (block.kind === 'prose') served.push(...block.lines);
        else if (block.kind === 'bullets') served.push(...block.items);
      }
    }
    for (const line of stored) {
      expect(served).toContain(line);
    }
  });

  it('serves each of the 11 source addresses as a real anchor', () => {
    // Rule 13 requires a filing body to be named AND linked at its source, and
    // rule 5 requires a citation to be reachable by address. A link that only
    // appears once the app has run is neither.
    const hrefs = (guide.sourceRuns ?? [])
      .flat()
      .filter((run) => run.kind === 'externalLink')
      .map((run) => (run as { href: string }).href);
    expect(hrefs).toHaveLength(11);
    for (const href of hrefs) {
      expect(html).toContain(`<a href="${href}">`);
    }
    // Every internal link is served as a real anchor too, for the same reason: guide 1's
    // forward link to guide 2 is a citation of our own writing and rule 5 binds it the
    // same way. Counted from the piece rather than hard-coded, so adding a link to a
    // later guide does not need this number edited.
    const internal = [...(guide.intro ?? []), ...guide.sections.flatMap((s) => s.blocks)]
      .flatMap((block) => (block.kind === 'paragraph' ? block.runs : []))
      .filter((run) => run.kind === 'internalLink');
    expect(internal).toHaveLength(1);
    for (const run of internal) {
      expect(html).toContain(`<a href="${(run as { href: string }).href}">`);
    }
    // One anchor back to the list, plus one per source address and one per internal
    // link, and no others.
    expect(html.match(/href="/g)).toHaveLength(1 + hrefs.length + internal.length);
    expect(snapshot.links).toEqual([{ label: READ_PAGE_HEADING, href: '/read' }]);
  });

  it('prints no piece number anywhere in the served page', () => {
    for (const banned of ['piece 1', 'Piece 1', 'PIECE 1', '1 of 5']) {
      expect(html).not.toContain(banned);
    }
  });

  it('states no figure of its own', () => {
    // Trailing punctuation is trimmed on both sides: a statute cite reads
    // "10A.105." in the sentence and "10A.105" as the anchor's own words, and the
    // full stop between them is not a figure.
    const figures = (text: string) =>
      (text.match(/\d[\d,.]*/g) ?? []).map((token) => token.replace(/[.,]+$/, ''));
    const storedText = [
      guide.title,
      pieceMastheadLine(guide),
      guide.set!.name,
      ...(guide.intro ?? []).map((block) =>
        block.kind === 'paragraph' ? researchRunsText(block.runs) : '',
      ),
      ...guide.sections.flatMap((section) => [
        section.heading,
        ...section.blocks.flatMap((block) => {
          if (block.kind === 'paragraph') return [researchRunsText(block.runs)];
          if (block.kind === 'bullets') return block.items.map(researchRunsText);
          return [];
        }),
      ]),
      ...(guide.sourceRuns ?? []).map(researchRunsText),
    ].join(' ');
    const stored = new Set(figures(storedText));
    const served = figures(visibleText(html));
    expect(served.length).toBeGreaterThan(20);
    expect(served.filter((number) => !stored.has(number))).toEqual([]);
  });
});

describe('the /read page snapshot links to every posted piece', () => {
  const pieces = publishedResearch();
  const snapshot = readPageSnapshot(pieces);
  const html = renderPageSnapshot(snapshot);

  it('names the page the way the loaded page names it, then its note', () => {
    // The loaded page shows no title and carries its name on a visually hidden
    // `h1`; the served document has to say the same thing, or a crawler reads a
    // heading no reader ever sees.
    expect(snapshot.heading).toBe(READ_PAGE_NAME);
    expect(snapshot.body).toEqual([READ_PAGE_INTRO]);
  });

  it('gives every posted piece a real link a crawler can follow', () => {
    expect(pieces.length).toBeGreaterThan(1);
    expect(snapshot.records).toHaveLength(pieces.length);
    for (const piece of pieces) {
      // Each piece's own folder, from the one function that decides it.
      expect(html).toContain(`href="${piecePath(piece)}"`);
      expect(html).toContain(piece.title);
      if (piece.dek) expect(html).toContain(piece.dek.replace(/'/g, '&#39;'));
    }
  });

  it('lists both kinds, each with the quiet line its card draws', () => {
    const research = pieces.find((piece) => piece.traits.research)!;
    const guide = pieces.find((piece) => !piece.traits.research)!;
    // One card shape: minutes for both, then the day a research piece was
    // published or the month a guide was written.
    expect(html).toContain(pieceCardMetaLine(research));
    expect(html).toContain(pieceCardMetaLine(guide));
    expect(pieceCardMetaLine(research)).toContain(
      `PUBLISHED ${isoDateCommaCapsLabel(research.publishedOn)}`,
    );
    expect(pieceCardMetaLine(guide)).toContain(`${pieceReadingMinutes(guide)} MIN`);
    expect(html).toContain(`href="/read/guides/${guide.slug}"`);
  });

  it('names a guide\u2019s set on its row, the way the card does', () => {
    const guide = pieces.find((piece) => piece.set && !piece.traits.research)!;
    expect(html).toContain(guide.set!.name);
    // The set's name and never its position in it (\u00a72.12).
    expect(html).not.toContain(`piece ${guide.set!.position}`);
  });

  it('says what the /read page says when nothing is posted yet', () => {
    const empty = readPageSnapshot([]);
    expect(empty.records).toEqual([]);
    expect(empty.body).toEqual([READ_PAGE_INTRO, READ_PAGE_EMPTY_TITLE, READ_PAGE_EMPTY_BODY]);
  });
});

describe('both screens keep reading the same registry the server reads', () => {
  // The screens need navigation and cannot be rendered here, so this is the
  // drift alarm in their place: the moment either grows its own copy of a
  // sentence, the served page and the drawn page can disagree and nothing else
  // would notice. It is the same guard the profile screens get above.
  it('the piece screen draws the piece’s stored runs, dek, dates and sources', () => {
    const source = readFileSync(
      join(HERE, '../../..', 'src/screens/redesign/ResearchScreen.tsx'),
      'utf8',
    );
    for (const call of [
      'InlineRuns',
      'piece.dek',
      'pieceMastheadLine(piece)',
      'piece.sources',
      'piece.sourceRuns',
      'piece.shortVersion',
      'piece.intro',
      'piece.set',
      'section.blocks',
    ]) {
      expect(source).toContain(call);
    }
  });

  it('the /read page screen draws the shared wording', () => {
    const source = readFileSync(
      join(HERE, '../../..', 'src/screens/redesign/ReadScreen.tsx'),
      'utf8',
    );
    for (const constant of [
      'READ_PAGE_NAME',
      'READ_PAGE_INTRO',
      'READ_PAGE_EMPTY_TITLE',
      'READ_PAGE_EMPTY_BODY',
    ]) {
      expect(source).toContain(constant);
    }
    // The wording lives in one place now, so a literal copy is the regression.
    expect(source).not.toContain('Our own research, in plain language');
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
