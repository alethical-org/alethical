import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import billFixture from './fixtures/bill-page-snapshot.json';
import committeeFixture from './fixtures/committee-money-page-snapshot.json';
import committeeEmptyYearFixture from './fixtures/committee-empty-year-snapshot.json';
import committeePaymentsFixture from './fixtures/committee-payments-page-snapshot.json';
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
  committeeDirectoryPageSnapshot,
  committeePageSnapshot,
  committeePaymentsPageSnapshot,
  homePageSnapshot,
  injectPageSnapshot,
  legislatorDirectoryPageSnapshot,
  legislatorPageSnapshot,
  moneyLandingPageSnapshot,
  researchPageSnapshot,
  readPageSnapshot,
  renderPageSnapshot,
  SNAPSHOT_MARKER_END,
  SNAPSHOT_MARKER_START,
} = await import('../pageSnapshot');
const {
  committeeSlug,
  EMPTY_YEAR_MONEY_OUT_WHY,
  EMPTY_YEAR_VALUE,
  emptyYearMoneyInWhy,
  coveredPeriodLine,
  listLinkNote,
  MONEY_OUT_FIGURE_LABEL,
  MONEY_OUT_REPORTED_LABEL,
  moneyOutNote,
  receivedPaymentRow,
  showingLine,
  uncoveredPeriodLine,
  unnamedMoneyExplanation,
  whoseCommitteeText,
  ZERO_REPORTED_NOTE,
} = await import('../committeeMoney');
const { registerCountLine } = await import('../committeeList');
const { formatDay, formatMoney } = await import('../legislatorCampaignMoney');
const {
  centralDateLabel,
  FILES_LAST_COPIED_LABEL,
  FILES_LAST_COPIED_NOTE,
  LOBBYING_NOT_LOADED,
  MONEY_LANDING_HEADING,
  MONEY_LANDING_SUBTITLE,
  RECORD_DOES_NOT_COVER,
} = await import('../moneyLanding');
const {
  READ_PAGE_EMPTY_BODY,
  READ_PAGE_EMPTY_TITLE,
  READ_PAGE_HEADING,
  READ_PAGE_INTRO,
  READ_PAGE_NAME,
  isoDateCapsLabel,
  isoDateCommaCapsLabel,
  pieceCardMetaLine,
  pieceKindLabel,
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

  /**
   * Every outward address the piece stores, across both source shapes. Counted
   * from the piece rather than hard-coded, so adding or moving a source cannot
   * leave these checks quietly covering fewer links than the page carries.
   */
  const sourceAddresses: { href: string; text: string }[] = [
    ...piece.sources.flatMap((source) =>
      source.noteLink ? [{ href: source.noteLink.href, text: source.noteLink.text }] : [],
    ),
    ...(piece.sourceRuns ?? [])
      .flat()
      .filter((run) => run.kind === 'externalLink')
      .map((run) => ({ href: run.href, text: run.text })),
  ];

  /** Every string the piece itself stores, exactly as the screen draws it. */
  const storedStrings = new Set<string>([
    piece.title,
    piece.dek,
    researchDatesLine(piece),
    ...(piece.newerFilingsNote ? [piece.newerFilingsNote] : []),
    ...(piece.correction ? [piece.correction.datedLabel, piece.correction.note] : []),
    ...piece.sources.map((source) => researchSourceText(source)),
    ...piece.sources.flatMap((source) => (source.noteLink ? [source.noteLink.text] : [])),
    // A piece stores its sources in exactly 1 of the 2 shapes, so this set has to
    // know both or it silently stops covering whichever one the piece uses. This
    // one moved to runs when its lobbying entry gained a second link (#1802).
    ...(piece.sourceRuns ?? []).map((runs) => researchRunsText(runs)),
    ...(piece.sourceRuns ?? [])
      .flat()
      .filter((run) => run.kind === 'externalLink')
      .map((run) => run.text),
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
    expect(sourceAddresses.length).toBeGreaterThan(0);
    for (const { href, text } of sourceAddresses) {
      expect(html).toContain(`<a href="${href}">`);
      expect(html).toContain(text);
    }
  });

  it('links the records its largest figure is added up from', () => {
    // Rule 13, as amended 28 Aug 2026: a cross-member figure computed from records
    // we do NOT hold carries an inset, and the records behind it are named AND
    // LINKED, because "a reader must be able to reproduce the total from the linked
    // source". The $886 million lobbying total is exactly that figure, and this is
    // the only address it reproduces from: the historical-spending list beside it
    // lets a reader look up 1 organisation and can never produce a total.
    //
    // Pinned to the literal address rather than counted from the piece. Every other
    // check here compares the served page against what the piece stores, so all of
    // them stay green when the piece simply stops storing a link. Measured: deleting
    // this anchor failed 0 tests before this one existed, and the page had already
    // shipped for 2 hours carrying the address as unclickable text (#1802).
    const DOWNLOAD = 'https://cfb.mn.gov/reports-and-data/self-help/data-downloads/lobbying/';
    expect(sourceAddresses.map((source) => source.href)).toContain(DOWNLOAD);
    expect(renderPageSnapshot(snapshot)).toContain(`<a href="${DOWNLOAD}">`);
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
    expect(sourceAddresses.length).toBeGreaterThan(0);
    expect(html.match(/href="/g)).toHaveLength(1 + sourceAddresses.length);
    for (const { href } of sourceAddresses) {
      expect(html).toContain(`<a href="${href}">`);
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

/**
 * The money section's 4 snapshots (issue #1812). Every test below is one way a
 * served figure could become a published falsehood about a named organisation,
 * which is what `.claude/rules/grounded-answers.md` rule 12 exists to stop.
 *
 * The committee screens need navigation and cannot be rendered here, the same
 * limit the legislator profile and the piece screen hit above. So the guarantee
 * is the same 2-part one: every served sentence IS the output of the helper the
 * screen calls, and a drift alarm at the end fails if a screen stops calling it.
 */
describe('the money landing serves the section’s own words and a live count', () => {
  const snapshot = moneyLandingPageSnapshot({
    registerFilerCount: 1603,
    filesLastCopiedAt: '2026-08-12T02:54:22.402100Z',
  });
  const text = visibleText(renderPageSnapshot(snapshot));

  it('draws its heading and its one sentence from the shared wording', () => {
    expect(snapshot.heading).toBe(MONEY_LANDING_HEADING);
    expect(snapshot.body).toEqual([MONEY_LANDING_SUBTITLE]);
  });

  it('links the 2 lanes that lead somewhere, and only those', () => {
    expect(snapshot.records?.map((record) => record.href)).toEqual([
      '/legislators',
      '/money/committees',
    ]);
  });

  // A pasted count is how this page once said 1,336 filers on a day the register
  // held 1,603, so the number has to arrive from the request that drew it.
  it('counts the register from what was served, not from a constant', () => {
    expect(text).toContain('1,603 REGISTERED FILERS');
    const unserved = moneyLandingPageSnapshot({
      registerFilerCount: null,
      filesLastCopiedAt: null,
    });
    expect(visibleText(renderPageSnapshot(unserved))).not.toContain('REGISTERED FILERS');
  });

  it('carries the day we copied the files, labelled as the day we checked', () => {
    expect(text).toContain(FILES_LAST_COPIED_LABEL);
    expect(text).toContain(FILES_LAST_COPIED_NOTE);
    expect(text).toContain(centralDateLabel('2026-08-12T02:54:22.402100Z'));
  });

  it('says what the record does not cover, in the same words the page draws', () => {
    for (const line of [...RECORD_DOES_NOT_COVER, LOBBYING_NOT_LOADED]) {
      expect(text).toContain(line);
    }
  });

  // No lane counts money and the landing shows no amount at all (campaign money
  // IA §04). The $200 naming threshold in the gaps list is a rule, not a figure.
  it('prints no money amount anywhere', () => {
    expect(text).not.toMatch(/\$[\d,]+\.\d{2}/);
  });
});

describe('the register serves an ordinary link per filer, on numbered pages', () => {
  const rows = [
    {
      registration_number: '41326',
      name: 'Jane Fonda Climate PAC',
      kind: 'political_committee_or_fund',
      sub_type: 'PC',
      office: null,
      district: null,
      termination_date: null,
    },
    {
      registration_number: '18833',
      name: 'Smith, Andrew House Committee',
      kind: 'candidate_committee',
      sub_type: null,
      office: 'House',
      district: '12A',
      termination_date: '2026-07-28',
    },
  ];
  const snapshot = committeeDirectoryPageSnapshot(
    rows,
    { listTotal: 1603, registerTotal: 1603, asOf: '2026-08-12' },
    12,
    50,
  );
  const html = renderPageSnapshot(snapshot);

  // The whole defect this fixes: Google states it does not press buttons, so
  // behind the old "Show more" the other 1,553 filers had no link at all.
  it('gives every row on the page a real anchor at its own address', () => {
    expect(snapshot.records?.map((record) => record.href)).toEqual([
      '/money/committees/jane-fonda-climate-pac-41326',
      '/money/committees/smith-andrew-house-committee-18833',
    ]);
    expect(html).toContain('href="/money/committees/jane-fonda-climate-pac-41326"');
  });

  it('builds each address with the same slug rule the router reads', () => {
    for (const row of rows) {
      expect(
        snapshot.records?.some((record) =>
          record.href.endsWith(committeeSlug(row.name, row.registration_number)),
        ),
      ).toBe(true);
    }
  });

  it('carries previous, next and jump links so the whole register is walkable', () => {
    const hrefs = snapshot.links.map((link) => link.href);
    expect(hrefs).toContain('/money/committees?page=11');
    expect(hrefs).toContain('/money/committees?page=13');
    expect(hrefs).toContain('/money/committees');
    expect(hrefs).toContain('/money');
  });

  it('names which rows of the register this page holds', () => {
    expect(visibleText(html)).toContain('Showing 551–552 of 1,603 registered filers');
  });

  // No row carries an amount and nothing here sorts by one: these filers file to
  // different calendars, so 2 figures side by side would set one period against
  // another (rule 12; design doc §7).
  it('puts no money on a list of many committees', () => {
    expect(visibleText(html)).not.toMatch(/\$[\d,]+\.\d{2}/);
  });

  it('states the register’s own size and its own date', () => {
    expect(snapshot.subheading).toBe(registerCountLine(1603, '2026-08-12'));
  });
});

describe('a committee’s record in the first response', () => {
  const snapshot = committeePageSnapshot(committeeFixture, '41326');
  const html = renderPageSnapshot(snapshot);
  const text = visibleText(html);
  const split = committeeFixture.split;
  const moneyOut = committeeFixture.money_out;

  it('is headed by the register’s own name and its registration number', () => {
    expect(snapshot.heading).toBe('Jane Fonda Climate PAC');
    expect(snapshot.subheading).toBe('Political committee or fund · REG 41326');
  });

  // The drawn page puts the kind above the title and the registered-for line
  // below it. On one served line "Political committee or fund · Kind as
  // registered: political committee or fund" reads as a stutter.
  it('says the register’s kind once, and the seat when there is one', () => {
    expect(committeePageSnapshot(committeeEmptyYearFixture, '18173').subheading).toBe(
      'Candidate committee · REG 18173 · Registered for House District 49A',
    );
  });

  // Rule 12's first requirement: the total the committee reported and the
  // payments we can list are different figures, and both are shown.
  it('shows the reported total AND the named total, and never subtracts them', () => {
    expect(text).toContain(formatMoney(split.reported_total));
    expect(text).toContain(formatMoney(split.named_total));
    expect(text).toContain(formatMoney(split.unnamed_total));
    expect(text).toContain(unnamedMoneyExplanation(false));
  });

  it('labels money out as payments rather than as spending', () => {
    expect(text).toContain(MONEY_OUT_REPORTED_LABEL);
    expect(text).toContain(MONEY_OUT_FIGURE_LABEL);
    expect(text).not.toContain('spent');
    expect(text).toContain(
      moneyOutNote('reported', false, true, Number(moneyOut.reported_total) === 0),
    );
  });

  // Every page carrying a money figure carries one clearly labelled date for it.
  it('carries the period the figures cover and the day we copied the files', () => {
    expect(text).toContain(coveredPeriodLine(split.reported_through, '2026-01-01'));
    expect(text).toContain(centralDateLabel(committeeFixture.fetched_at));
  });

  it('says whose committee this is in the shared sentence, never inferring a person', () => {
    expect(snapshot.body).toEqual([whoseCommitteeText('political_committee_or_fund', 'PC', null)]);
  });

  it('links its own payments list and the register it came from', () => {
    const hrefs = snapshot.links.map((link) => link.href);
    expect(hrefs).toContain('/money/committees/jane-fonda-climate-pac-41326/payments');
    expect(hrefs).toContain('/money/committees');
  });

  /**
   * The crossing from a committee record to its confirmed member has to be in the
   * FIRST response, not only once the app runs: a search engine, a reader with a
   * broken script and a shared link all see this one and nothing else (#1809's
   * finding, that 1,553 of 1,603 committee pages had no link anywhere on the site).
   */
  it('serves the confirmed member’s sentence and a real link to their money', () => {
    const confirmed = committeePageSnapshot(
      {
        ...committeeFixture,
        confirmed_for: { slug: 'melissa-hortman', full_name: 'Melissa Hortman' },
      },
      '41326',
    );
    expect(confirmed.body).toEqual([
      whoseCommitteeText('political_committee_or_fund', 'PC', {
        slug: 'melissa-hortman',
        fullName: 'Melissa Hortman',
      }),
    ]);
    // Asserted on the served prose specifically, not on the whole page: the link
    // label below also carries her name, so a body check that only looked for the
    // name would pass with the sentence gone.
    expect(visibleText(renderPageSnapshot(confirmed))).toContain(
      'Someone at Alethical read Minnesota’s own records',
    );
    expect(confirmed.links[0]).toEqual({
      label: 'See Melissa Hortman’s campaign money',
      href: '/legislators/melissa-hortman?tab=money',
    });
    expect(renderPageSnapshot(confirmed)).toContain(
      'href="/legislators/melissa-hortman?tab=money"',
    );
  });

  it('adds no member link when nobody has confirmed one', () => {
    expect(snapshot.links.some((link) => (link.href ?? '').startsWith('/legislators/'))).toBe(
      false,
    );
  });

  /**
   * Rule 11's arithmetic guard, the same one the published-piece snapshot gets:
   * a figure the layout worked out for itself reads to a reader as a filed fact.
   * Every amount in the served HTML has to be one the payload carries.
   */
  it('invents no money figure — every amount served is one the filing carries', () => {
    const servedAmounts = [...text.matchAll(/\$[\d,]+\.\d{2}/g)].map((match) => match[0]);
    const filed = new Set(
      [
        split.reported_total,
        split.named_total,
        split.unnamed_total,
        split.named_in_kind_total,
        moneyOut.reported_total,
        moneyOut.itemized_payment_total,
        ...moneyOut.by_type.map((entry) => entry.total),
      ].map((value) => formatMoney(value)),
    );
    expect(servedAmounts.length).toBeGreaterThan(0);
    for (const amount of servedAmounts) expect(filed.has(amount)).toBe(true);
  });
});

describe('a committee-year with nothing filed', () => {
  const snapshot = committeePageSnapshot(committeeEmptyYearFixture, '18173');
  const text = visibleText(renderPageSnapshot(snapshot));

  // Missing is "Not reported"; a verified zero is "0". Collapsing the two would
  // invent a fact about a named organisation (rule 12).
  it('reads "Not reported" and never prints a figure it does not hold', () => {
    expect(text).toContain(EMPTY_YEAR_VALUE);
    expect(text).not.toContain('$0.00');
    expect(text).toContain(uncoveredPeriodLine(2026));
  });

  it('still says what the record holds rather than serving an empty shell', () => {
    expect(snapshot.heading).toBe('Jackson, Carolyn C House Committee');
    expect(text).toContain(emptyYearMoneyInWhy(2026));
    expect(text).toContain(EMPTY_YEAR_MONEY_OUT_WHY);
  });
});

describe('a filed zero is a number, not a gap', () => {
  const zeroed = {
    ...committeeFixture,
    split: {
      ...committeeFixture.split,
      reported_total: '0.0000',
      named_total: null,
      named_payments: null,
      named_cash_total: null,
      named_in_kind_total: '0.0000',
      unnamed_total: null,
    },
    money_in: { ...committeeFixture.money_in, state: 'not_reported' },
  };
  const text = visibleText(renderPageSnapshot(committeePageSnapshot(zeroed, '41326')));

  it('draws $0.00 and the filing’s own sentence for it', () => {
    expect(text).toContain('$0.00');
    expect(text).toContain(ZERO_REPORTED_NOTE);
  });

  it('never turns a missing total into a zero', () => {
    const missing = {
      ...committeeFixture,
      split: { ...committeeFixture.split, state: 'no_reported_total', reported_total: null },
      money_in: { ...committeeFixture.money_in, state: 'not_reported' },
      money_out: { ...committeeFixture.money_out, reported_total: null },
    };
    const missingText = visibleText(renderPageSnapshot(committeePageSnapshot(missing, '41326')));
    expect(missingText).toContain('Not reported');
  });
});

describe('a committee’s full payments list in the first response', () => {
  const linkable = new Set<string>(committeePaymentsFixture.linkable_registration_numbers ?? []);
  // The same field mapping api/page.ts does, so the rows under test are the rows
  // the first response actually carries.
  const rows = committeePaymentsFixture.payments.map((row) =>
    receivedPaymentRow(
      {
        contributor: row.contributor,
        contributorRegistrationNumber: row.contributor_registration_number,
        contributorType: row.contributor_type,
        amount: row.amount,
        receivedOn: row.received_on,
        receiptType: row.receipt_type,
        inKind: row.in_kind,
      },
      linkable,
    ),
  );
  const snapshot = committeePaymentsPageSnapshot(committeeFixture, '41326', {
    state: committeePaymentsFixture.state,
    rows,
    totalPayments: committeePaymentsFixture.page.total_payments,
  });
  const html = renderPageSnapshot(snapshot);
  const text = visibleText(html);

  it('serves every named payment the request returned', () => {
    expect(snapshot.sections?.[1]?.items).toHaveLength(committeePaymentsFixture.payments.length);
    for (const payment of committeePaymentsFixture.payments) {
      expect(text).toContain(payment.contributor);
      expect(text).toContain(formatMoney(payment.amount));
    }
  });

  it('gives each payment its own date, as the row draws it', () => {
    for (const payment of committeePaymentsFixture.payments) {
      expect(text).toContain(formatDay(payment.received_on));
    }
  });

  it('counts the list from what was served and says the naming rule', () => {
    expect(text).toContain(showingLine(rows.length, committeePaymentsFixture.page.total_payments));
    expect(text).toContain(listLinkNote('gave', false));
  });

  it('links back to the committee whose payments these are', () => {
    expect(snapshot.links.map((link) => link.href)).toContain(
      '/money/committees/jane-fonda-climate-pac-41326',
    );
  });

  // Only a name carrying a registration number this release holds opens a page: a
  // private donor's name is not a profile and never becomes one here.
  it('opens a page only for a payer the register can identify', () => {
    const withCommittee = receivedPaymentRow(
      {
        contributor: 'Some Party Unit',
        contributorRegistrationNumber: '20982',
        contributorType: 'Committee',
        amount: '500.0000',
        receivedOn: '2026-07-09',
        receiptType: 'Contribution',
        inKind: 'No',
      },
      new Set(['20982']),
    );
    const linked = committeePaymentsPageSnapshot(committeeFixture, '41326', {
      state: 'reported',
      rows: [withCommittee],
      totalPayments: 1,
    });
    expect(linked.sections?.[1]?.items?.[0].href).toBe('/money/committees/some-party-unit-20982');
    // The individual donors in the fixture carry no registration number at all.
    expect(snapshot.sections?.[1]?.items?.every((item) => item.href === undefined)).toBe(true);
  });
});

describe('the money screens keep reading the helpers the server reads', () => {
  // The 3 screens need navigation and cannot be rendered here, so this is the
  // drift alarm in their place: the moment one grows its own copy of a sentence,
  // the served page and the drawn page can disagree and nothing else would
  // notice. Same guard the profile and piece screens get above.
  it('the committee page draws the same money sentences the snapshot serves', () => {
    const source = readFileSync(
      join(HERE, '../../..', 'src/screens/redesign/CommitteeMoneyScreen.tsx'),
      'utf8',
    );
    for (const call of [
      'yearDisplayState',
      'whoseCommitteeText',
      'confirmedMemberLinkLabel',
      'committeeEyebrow',
      'registeredForLine',
      'unnamedMoneyExplanation',
      'moneyOutNote',
      'coveredPeriodDetail',
      'recordCoverageLines',
      'MONEY_OUT_REPORTED_LABEL',
      'MONEY_OUT_FIGURE_LABEL',
      'centralDateLabel',
    ]) {
      expect(source).toContain(call);
    }
  });

  it('the payments page shapes its rows with the shared shapers', () => {
    const source = readFileSync(
      join(HERE, '../../..', 'src/screens/redesign/CommitteePaymentsScreen.tsx'),
      'utf8',
    );
    expect(source).toContain('receivedPaymentRow');
    expect(source).toContain('madePaymentRow');
    // A literal copy of the stand-in name is the regression this catches.
    expect(source).not.toContain("'Name not given in the filing'");
  });

  it('the register list and the landing draw the shared wording', () => {
    const list = readFileSync(
      join(HERE, '../../..', 'src/screens/redesign/CommitteeListScreen.tsx'),
      'utf8',
    );
    for (const call of ['committeeRowMeta', 'registerCountLine', 'committeeShowingLine']) {
      expect(list).toContain(call);
    }
    // Numbered pages, never a button Google will not press (§20.5 rule 2).
    expect(list).toContain('Pagination');
    expect(list).not.toContain('Show the next');

    const landing = readFileSync(
      join(HERE, '../../..', 'src/screens/redesign/MoneyLandingScreen.tsx'),
      'utf8',
    );
    for (const constant of [
      'MONEY_LANDING_HEADING',
      'MONEY_LANDING_SUBTITLE',
      'MONEY_LANE_COMMITTEES',
      'MONEY_LANE_LEGISLATORS',
      'FILES_LAST_COPIED_NOTE',
    ]) {
      expect(landing).toContain(constant);
    }
    expect(landing).not.toContain('Follow the money<');
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

/**
 * Every posted guide, not just the first one. A guide's page is served before any
 * JavaScript runs, and that first response is what a search engine and a reader on
 * a slow connection get: `.claude/rules/grounded-answers.md` rule 1 needs its
 * citations present and rule 5 needs each one reachable by address. Guide 1 has its
 * own block above checking the shape; this checks the promise, on all of them, so
 * publishing a guide without its sentences or its links fails here.
 */
describe('every posted guide is served whole, before the app runs', () => {
  const guides = publishedResearch().filter((piece) => pieceKindLabel(piece) === 'Guide');

  it('posts more than one, or this block is checking nothing', () => {
    expect(guides.length).toBeGreaterThan(1);
  });

  it.each(guides.map((guide) => ({ slug: guide.slug, guide })))(
    'serves every sentence of $slug verbatim',
    ({ guide }) => {
      const snapshot = researchPageSnapshot(guide);
      const stored = [
        ...(guide.intro ?? []),
        ...guide.sections.flatMap((section) => section.blocks),
      ].flatMap((block) => {
        if (block.kind === 'paragraph') return [researchRunsText(block.runs)];
        if (block.kind === 'bullets') return block.items.map((item) => researchRunsText(item));
        return [];
      });
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
      // Its own headings are served too, in the piece's own order.
      expect((snapshot.sections ?? []).map((section) => section.heading)).toEqual(
        expect.arrayContaining(guide.sections.map((section) => section.heading)),
      );
    },
  );

  it.each(guides.map((guide) => ({ slug: guide.slug, guide })))(
    'serves every source address of $slug as a real anchor',
    ({ guide }) => {
      const html = renderPageSnapshot(researchPageSnapshot(guide));
      const sourceHrefs = (guide.sourceRuns ?? [])
        .flat()
        .filter((run) => run.kind === 'externalLink')
        .map((run) => (run as { href: string }).href);
      expect(sourceHrefs.length).toBeGreaterThan(0);
      for (const href of sourceHrefs) {
        expect(html).toContain(`<a href="${href}">`);
      }
      // A link to our own writing is a citation too, and rule 5 binds it the same
      // way, so it is served as an anchor rather than waiting for the app.
      const internal = [...(guide.intro ?? []), ...guide.sections.flatMap((s) => s.blocks)]
        .flatMap((block) =>
          block.kind === 'paragraph'
            ? block.runs
            : block.kind === 'bullets'
              ? block.items.flat()
              : [],
        )
        .filter((run) => run.kind === 'internalLink');
      for (const run of internal) {
        const href = (run as { href: string }).href;
        expect(html).toContain(`<a href="${href}">`);
        // And it resolves: every inward link points at a piece the registry holds.
        expect(publishedResearch().map(piecePath)).toContain(href);
      }
    },
  );

  it.each(guides.map((guide) => ({ slug: guide.slug, guide, position: guide.set?.position })))(
    'prints no piece number on the served page for $slug',
    ({ guide, position }) => {
      const html = renderPageSnapshot(researchPageSnapshot(guide));
      for (const banned of [`piece ${position}`, `Piece ${position}`, `${position} of 5`]) {
        expect(html).not.toContain(banned);
      }
    },
  );
});
