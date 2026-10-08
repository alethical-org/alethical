import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../billDetail/SharePopover', () => ({ SharePopover: () => null }));
vi.mock('react-native-svg', () => ({
  default: () => null,
  Path: () => null,
  Circle: () => null,
  Polygon: () => null,
}));

import type { ResearchPiece } from '../../../lib/research';
import { renderPageSnapshot, shortPostPageSnapshot } from '../../../lib/pageSnapshot';
import { chartDescription } from '../../../lib/shortPostCalculations';
import {
  SHORT_POST_AI_NOTE,
  shortPostArticleSnapshotBlocks,
  type ShortPostEvidence,
  type ShortPostGraphic,
} from '../../../lib/shortPosts';
import { ShortPostChart } from '../ShortPostChart';
import { ShortPostArticle, ShortPostRelatedReading } from '../ShortPostArticle';
import { LOBBYIST_GIVING } from '../../../lib/researchPieces/lobbyistGiving';
import { WHO_HAS_TO_REPORT_THEIR_MONEY } from '../../../lib/researchPieces/whoHasToReportTheirMoney';
import { ORGANIZATIONS_BOTH_PARTIES } from '../../../lib/researchPieces/organizationsBothParties';
import { TWO_RECORDS_NOT_TWO_DONATIONS } from '../../../lib/researchPieces/twoRecordsNotTwoDonations';

const period = { from: '2025-01-01', through: '2025-12-31', label: '2025 filings' };
const evidence: ShortPostEvidence = {
  id: 'source',
  title: 'Official 2025 records',
  url: 'https://example.gov/records',
  kind: 'official-source',
  period,
  method: 'Count the named rows.',
  limitations: '2025 only.',
  version: 'final',
};
const graphic: ShortPostGraphic = {
  id: 'share',
  claimIds: ['finding'],
  input: {
    kind: 'parts',
    total: { value: 109, unit: 'records', period },
    parts: [{ label: 'Named', value: 40, unit: 'records', period }],
    remainderLabel: 'Other records',
  },
  altDescription: '',
};
graphic.altDescription = chartDescription(graphic.input);

describe('Short post article and charts', () => {
  it('keeps each published table’s exact figures and accessible headers with 1 hidden spacer per row', () => {
    for (const piece of [
      LOBBYIST_GIVING,
      ORGANIZATIONS_BOTH_PARTIES,
      TWO_RECORDS_NOT_TWO_DONATIONS,
    ]) {
      const document = new JSDOM(renderToStaticMarkup(<ShortPostArticle piece={piece} />)).window
        .document;
      expect(document.querySelector('h1')?.textContent).toBe(piece.title);
      for (const table of document.querySelectorAll('table')) {
        for (const cell of table.querySelectorAll('thead th'))
          expect(cell.getAttribute('scope')).toBe('col');
        for (const row of table.querySelectorAll('tr')) {
          expect(row.querySelectorAll('.sp-table-spacer')).toHaveLength(1);
          expect(row.lastElementChild?.getAttribute('aria-hidden')).toBe('true');
          expect(row.lastElementChild?.textContent).toBe('');
          expect(
            document.defaultView!.getComputedStyle(row.lastElementChild!).borderBottomWidth,
          ).toBe('0px');
        }
        expect(
          document.defaultView!.getComputedStyle(table.querySelector('thead th')!)
            .borderBottomWidth,
        ).toBe('1px');
        for (const row of table.querySelectorAll('tbody tr'))
          expect(row.firstElementChild?.getAttribute('scope')).toBe('row');
      }
      const proseTables = piece.shortPost?.body?.filter((block) => block.kind === 'table') ?? [];
      expect(
        [...document.querySelectorAll('.sp-prose-table tbody')].map((body) =>
          [...body.querySelectorAll('tr')].map((row) =>
            [...row.children]
              .filter((cell) => cell.getAttribute('aria-hidden') !== 'true')
              .map((cell) => cell.textContent),
          ),
        ),
      ).toEqual(proseTables.map((block) => block.rows));
    }
  });

  it('ends chart table dividers at the real columns while retaining their padding', () => {
    const document = new JSDOM(
      renderToStaticMarkup(
        <ShortPostChart
          graphic={graphic}
          display={{
            graphicId: graphic.id,
            title: 'Named records',
            sourceEvidenceId: evidence.id,
            limitation: evidence.limitations,
            treatment: 'table',
          }}
          evidence={evidence}
          articleId="table-divider-check"
        />,
      ),
    ).window.document;
    const table = document.querySelector('table')!;
    for (const row of table.querySelectorAll('tr')) {
      expect(document.defaultView!.getComputedStyle(row.lastElementChild!).borderBottomWidth).toBe(
        '0px',
      );
    }
    const header = document.defaultView!.getComputedStyle(table.querySelector('thead th')!);
    expect(header.borderBottomWidth).toBe('1px');
    expect(header.paddingRight).toBe('12px');
    const finalValue = table.querySelector('tbody tr')!.children[2];
    expect(document.defaultView!.getComputedStyle(finalValue).paddingRight).toBe('0px');
    expect(
      document.defaultView!.getComputedStyle(table.querySelector('.sp-chart-table-total th')!)
        .borderBottomWidth,
    ).toBe('0px');
  });

  it('shows the approved publication line without changing the article records', () => {
    const markup = renderToStaticMarkup(<ShortPostArticle piece={LOBBYIST_GIVING} />);
    expect(markup).toContain(
      'PUBLISHED SEP 26, 2026</span><span aria-hidden="true"> · </span><span>CANDIDATE RECORDS 2015–2026 · CAUCUS AMOUNTS 2025',
    );
    expect(markup).toContain('HOW THIS WAS CALCULATED');
    expect(markup).toContain('WHERE THESE NUMBERS COME FROM');
    expect(markup).toContain(
      'class="sp-prose-total"><th scope="row">Total committee registrations',
    );
    expect(markup).not.toContain('<div class="sp-related-wrap"');
  });

  it('keeps reporting periods near the title and the source-copy date in sources', () => {
    const organizations = renderToStaticMarkup(
      <ShortPostArticle piece={ORGANIZATIONS_BOTH_PARTIES} />,
    );
    const citedFilings = renderToStaticMarkup(
      <ShortPostArticle piece={TWO_RECORDS_NOT_TWO_DONATIONS} />,
    );
    expect(organizations).toContain('CONTRIBUTION RECORDS 2015–2025</span>');
    const metadata = organizations.match(/<div class="sp-meta-share">(.*?)<\/p>/)?.[1];
    expect(metadata).toBeDefined();
    expect(metadata).toContain('PUBLISHED SEP 26, 2026');
    expect(metadata).not.toMatch(/copied|saved|download/i);
    expect(organizations.slice(organizations.indexOf('WHERE THESE NUMBERS COME FROM'))).toContain(
      'saved September 24, 2026',
    );
    expect(organizations).toContain('class="sp-prose-total"><th scope="row">Combined');
    expect(citedFilings).toContain('RECORDS IN CITED FILINGS THROUGH DEC 20, 2023');
  });

  it('uses 3 editor-selected published neighbors and excludes the current article', () => {
    const piece = {
      ...LOBBYIST_GIVING,
      shortPost: {
        ...LOBBYIST_GIVING.shortPost!,
        relatedSlugs: [
          'organizations-both-parties',
          '2-records-not-always-2-donations',
          'what-the-records-name',
        ],
      },
    };
    const markup = renderToStaticMarkup(<ShortPostRelatedReading piece={piece} />);
    expect((markup.match(/class="sp-related-row"/g) ?? []).length).toBe(3);
    expect(markup).toContain('/blog/research/organizations-both-parties');
    expect(markup).toContain('/blog/guides/what-the-records-name');
    expect(markup).not.toContain('/blog/research/lobbyist-giving');
  });

  it('keeps only unique published picks and does not repeat the next guide', () => {
    const piece = {
      ...WHO_HAS_TO_REPORT_THEIR_MONEY,
      relatedSlugs: [
        'who-has-to-report-their-money',
        'what-the-records-name',
        'never-published',
        'why-2-official-numbers-can-both-be-right',
        'why-2-official-numbers-can-both-be-right',
      ],
    };
    const markup = renderToStaticMarkup(<ShortPostRelatedReading piece={piece} />);
    expect((markup.match(/class="sp-related-row"/g) ?? []).length).toBe(1);
    expect(markup).toContain('/blog/guides/why-2-official-numbers-can-both-be-right');
    expect(markup).not.toContain('/blog/guides/what-the-records-name');
    expect(markup).not.toContain('never-published');
    expect(markup).toContain('.sp-related-wrap{box-sizing:border-box');
  });

  it('uses computed parts, a named remainder, linked source, and a real table with single-line numbers', () => {
    const markup = renderToStaticMarkup(
      <ShortPostChart
        graphic={graphic}
        display={{
          graphicId: 'share',
          title: 'What the count includes',
          sourceEvidenceId: 'source',
          limitation: '2025 only.',
          treatment: 'table',
        }}
        evidence={evidence}
        articleId="article-one"
      />,
    );
    expect(markup).toContain('id="short-chart-article-one-share"');
    expect(markup).toContain('<table');
    expect(markup).toContain('scope="col"');
    expect(markup).toContain('scope="row"');
    expect(markup).toContain('>109</td>');
    expect(markup).toContain('Other records');
    expect(markup).toContain('white-space:nowrap');
    expect(markup).toContain('https://example.gov/records');
    expect(markup).not.toContain('sp-chart-description');
    expect(markup).not.toContain('aria-label="Alethical"');
    expect(markup).not.toContain('ShortPostWordmark');
  });

  it('keeps overlap values in accessible labels without redundant commentary', () => {
    const overlap: ShortPostGraphic = {
      ...graphic,
      id: 'overlap',
      input: {
        kind: 'overlap',
        left: { value: 80, unit: 'records', period },
        right: { value: 70, unit: 'records', period },
        both: { value: 30, unit: 'records', period },
        universe: { value: 120, unit: 'records', period },
        leftLabel: 'Group A',
        rightLabel: 'Group B',
        proportional: false,
      },
    };
    const markup = renderToStaticMarkup(
      <ShortPostChart
        graphic={overlap}
        display={{
          graphicId: 'overlap',
          title: 'Shared records',
          omitRepeatedUnit: true,
          sourceEvidenceId: 'source',
          limitation: '2025 only.',
        }}
        evidence={evidence}
        articleId="article-one"
      />,
    );
    expect(markup).not.toContain('Diagram shows overlap, not relative group sizes');
    expect(markup).not.toContain('records · 2025 filings');
    expect(markup).toContain('<span>Group A</span><strong>80</strong>');
    expect(markup).toContain('<span>Group B</span><strong>70</strong>');
    expect(markup).toContain('Total, including neither group');
    expect(markup).not.toContain('sp-chart-description');
    expect(markup).not.toContain('sp-chart-overlap-legend\" aria-hidden');
    expect(markup).toContain('aria-hidden="true"');
  });

  it('serializes body, chart, source, method, limits, and disclosure in reader order', () => {
    const piece = {
      format: 'short-post',
      title: 'Checked example',
      dek: 'An opening explanation.',
      publishedOn: '2026-09-25',
      recordsThrough: '2025-12-31',
      traits: { research: true, guide: false },
      slug: 'checked-example',
      topics: ['campaign-finance'],
      shortVersion: [],
      intro: [],
      sections: [],
      sources: [],
      sourceRuns: [[{ kind: 'externalLink', text: 'Official 2025 records', href: evidence.url }]],
      shortPost: {
        evidence: [evidence],
        graphics: [graphic],
        charts: [
          {
            graphicId: graphic.id,
            title: 'What the count includes',
            sourceEvidenceId: evidence.id,
            limitation: '2025 only.',
          },
        ],
        body: [
          { kind: 'paragraph', runs: [{ kind: 'text', text: 'Opening finding.' }] },
          { kind: 'chart', graphicId: graphic.id },
          { kind: 'method', essential: 'Count the named rows.', full: 'Check every row.' },
        ],
        history: [],
        coverageNote: 'Only the 2025 records are covered.',
        limitations: 'No later records are included.',
        disclosures: [SHORT_POST_AI_NOTE],
      },
    } as unknown as ResearchPiece;
    const blocks = shortPostArticleSnapshotBlocks(piece);
    const text = blocks.map((block) => block.text).join(' ');
    expect(text.indexOf('Opening finding.')).toBeLessThan(text.indexOf('What the count includes'));
    expect(text).toContain('Other records: 69 records');
    expect(text).toContain('Count the named rows.');
    expect(text).toContain('Only the 2025 records are covered.');
    expect(text).toContain(SHORT_POST_AI_NOTE);
    expect(blocks.some((block) => block.links?.some((link) => link.href === evidence.url))).toBe(
      true,
    );
    const firstResponse = renderPageSnapshot(shortPostPageSnapshot(piece));
    expect(firstResponse).toContain('Other records: 69 records');
    expect(firstResponse).toContain('https://example.gov/records');
    expect(firstResponse).toContain('Only the 2025 records are covered.');
    expect(firstResponse).toContain('No later records are included.');
    expect(firstResponse.replace(/<[^>]+>/g, '')).toContain(SHORT_POST_AI_NOTE);
  });
});

it('names both reporting periods above a comparison when they differ', () => {
  const input = {
    kind: 'comparison' as const,
    baseline: { value: 100, unit: 'USD', period },
    compared: {
      value: 200,
      unit: 'USD',
      period: { from: '2026-01-01', through: '2026-12-31', label: '2026 filings' },
    },
    baselineLabel: 'Earlier',
    comparedLabel: 'Later',
    showPercentChange: false,
  };
  const markup = renderToStaticMarkup(
    <ShortPostChart
      graphic={{ id: 'periods', claimIds: [], input, altDescription: chartDescription(input) }}
      display={{
        graphicId: 'periods',
        title: 'Period comparison',
        sourceEvidenceId: 'source',
        limitation: 'Different years.',
      }}
      evidence={evidence}
      articleId="test"
    />,
  );
  const topLine = markup.match(/<p class="sp-chart-measure">(.*?)<\/p>/)?.[1];
  expect(topLine).not.toContain('USD');
  expect(markup).toContain('100 USD');
  expect(markup).toContain('200 USD');
  expect(topLine).toContain('Earlier: 2025 filings');
  expect(topLine).toContain('Later: 2026 filings');
});

it('uses the article source list without a redundant jump link and retains direct outside sources', () => {
  for (const url of ['#private-sources', evidence.url]) {
    const markup = renderToStaticMarkup(
      <ShortPostChart
        graphic={graphic}
        display={{
          graphicId: graphic.id,
          title: 'Source navigation',
          sourceEvidenceId: evidence.id,
          limitation: evidence.limitations,
        }}
        evidence={{ ...evidence, url }}
        articleId="source-navigation"
      />,
    );
    const sourceLink = markup.match(/<a href="([^"]+)"[^>]*>/)?.[0];
    if (url.startsWith('#')) expect(sourceLink).toBeUndefined();
    else expect(sourceLink).toContain('target="_blank"');
  }
});

it('puts conclusion answers above qualifications across the available content width', () => {
  const article = new JSDOM(renderToStaticMarkup(<ShortPostArticle piece={LOBBYIST_GIVING} />))
    .window.document;
  const conclusion = article.querySelector('.sp-prose-conclusion')!;
  expect(conclusion).not.toBeNull();
  expect(article.defaultView!.getComputedStyle(conclusion).maxWidth).toBe('none');
  expect(article.defaultView!.getComputedStyle(conclusion.querySelector('p')!).flexGrow).toBe('1');
  expect(conclusion.querySelector('svg')?.getAttribute('aria-label')).toBe('Alethical');
  expect(conclusion.querySelector('strong')).not.toBeNull();
  expect(article.defaultView!.getComputedStyle(conclusion.querySelector('strong')!).display).toBe(
    'block',
  );
  const chart = new JSDOM(
    renderToStaticMarkup(
      <ShortPostChart
        graphic={graphic}
        display={{
          graphicId: graphic.id,
          title: 'Named records',
          sourceEvidenceId: evidence.id,
          limitation: evidence.limitations,
          conclusion: 'The records support this answer.',
        }}
        evidence={evidence}
        articleId="conclusion-width-check"
      />,
    ),
  ).window.document;
  const foot = chart.querySelector('.sp-chart-foot-conclusion')!;
  expect(chart.defaultView!.getComputedStyle(foot).maxWidth).toBe('none');
  expect(
    chart.defaultView!.getComputedStyle(foot.querySelector('.sp-chart-foot-text')!).flexGrow,
  ).toBe('1');
  expect(foot.querySelector('strong')?.textContent).toBe(
    'Conclusion: The records support this answer.',
  );
  expect(foot.querySelector('p')?.textContent).toContain(evidence.limitations);
  expect(chart.defaultView!.getComputedStyle(foot.querySelector('strong')!).display).toBe('block');
});
