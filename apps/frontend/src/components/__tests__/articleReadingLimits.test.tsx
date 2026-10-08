import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ArticleTitleText } from '../ArticleTitleText';
import { ResearchBlockTable } from '../ResearchBlockTable';
import { MONEY_ONLY_GOES_ONE_WAY } from '../../lib/researchPieces/moneyOnlyGoesOneWay';
import { LOBBYIST_GIVING } from '../../lib/researchPieces/lobbyistGiving';

const documentFor = (markup: string) => new JSDOM(markup).window.document;

describe('Article title year ranges', () => {
  it('preserves every character of the published lobbyist title', () => {
    const document = documentFor(
      renderToStaticMarkup(
        <h1>
          <ArticleTitleText title={LOBBYIST_GIVING.title} />
        </h1>,
      ),
    );
    expect(document.querySelector('h1')?.textContent).toBe(LOBBYIST_GIVING.title);
    const range = document.querySelector('h1 span');
    expect(range?.textContent).toBe('2015–2026');
    expect(range?.getAttribute('style')).toBe('white-space:nowrap');
    expect(document.querySelector('nobr')).toBeNull();
    expect(document.querySelector('h1')?.textContent).not.toContain('\u00a0');
  });

  it('handles several ranges and only whole 4-digit years joined by an en dash', () => {
    const title = '2015–2026 / 2020–2025; 12015–20260, 2015-2026, 2015–26';
    const document = documentFor(
      renderToStaticMarkup(
        <h1>
          <ArticleTitleText title={title} />
        </h1>,
      ),
    );
    expect(document.querySelector('h1')?.textContent).toBe(title);
    expect([...document.querySelectorAll('h1 span')].map((span) => span.textContent)).toEqual([
      '2015–2026',
      '2020–2025',
    ]);
  });

  it('leaves a guide without a year range unchanged', () => {
    const title = 'Who has to report their money';
    expect(renderToStaticMarkup(<ArticleTitleText title={title} />)).toBe(title);
  });
});

describe('Published Research table semantics and contents', () => {
  const tables = MONEY_ONLY_GOES_ONE_WAY.sections
    .flatMap((section) => section.blocks)
    .filter((block) => block.kind === 'table');
  it.each(tables)('preserves every header and row in the published table', (block) => {
    const document = documentFor(
      renderToStaticMarkup(
        <ResearchBlockTable columns={block.columns} rows={block.rows} totalRow={block.totalRow} />,
      ),
    );
    const table = document.querySelector('table')!;
    expect([...table.querySelectorAll('thead th')].map((cell) => cell.textContent)).toEqual(
      block.columns,
    );
    expect(
      [...table.querySelectorAll('thead th')].every((cell) => cell.getAttribute('scope') === 'col'),
    ).toBe(true);
    expect(
      [...table.querySelectorAll('tbody tr')].map((row) =>
        [...row.children]
          .filter((cell) => cell.getAttribute('aria-hidden') !== 'true')
          .map((cell) => cell.textContent),
      ),
    ).toEqual(block.rows);
    expect(
      [...table.querySelectorAll('tbody tr')].every(
        (row) => row.firstElementChild?.getAttribute('scope') === 'row',
      ),
    ).toBe(true);
    for (const row of table.querySelectorAll('tr')) {
      expect(row.querySelectorAll('[aria-hidden="true"]')).toHaveLength(1);
      expect(row.lastElementChild?.tagName).toBe('TD');
      expect(row.lastElementChild?.textContent).toBe('');
      expect(document.defaultView!.getComputedStyle(row.lastElementChild!).borderTopWidth).toBe(
        '0px',
      );
    }
    expect(
      document.defaultView!.getComputedStyle(table.querySelector('tbody th')!).borderTopWidth,
    ).toBe('1px');
    expect(document.querySelector('[role="region"]')?.getAttribute('tabindex')).toBe('0');
  });
});
