import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

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
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('white-space:nowrap');
    expect(markup).toContain('https://example.gov/records');
  });

  it('keeps overlap values in one accessible description and states circle sizes are not shares', () => {
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
          sourceEvidenceId: 'source',
          limitation: '2025 only.',
        }}
        evidence={evidence}
        articleId="article-one"
      />,
    );
    expect(markup).toContain('Diagram shows overlap, not relative group sizes.');
    expect(markup).toContain('Group A contains 80 records');
    expect(markup).toContain('Group B contains 70 records');
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
    expect(firstResponse).toContain(SHORT_POST_AI_NOTE);
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
  expect(topLine).toContain('Earlier: 2025 filings');
  expect(topLine).toContain('Later: 2026 filings');
});
