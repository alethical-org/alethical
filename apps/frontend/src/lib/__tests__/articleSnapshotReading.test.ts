import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import {
  homePageSnapshot,
  researchPageSnapshot,
  shortPostPageSnapshot,
  renderPageSnapshot,
} from '../pageSnapshot';
import { MONEY_ONLY_GOES_ONE_WAY } from '../researchPieces/moneyOnlyGoesOneWay';
import { WHO_HAS_TO_REPORT_THEIR_MONEY } from '../researchPieces/whoHasToReportTheirMoney';
import { LOBBYIST_GIVING } from '../researchPieces/lobbyistGiving';
import { researchPageMetadata } from '../researchMetadata';

const documentFor = (html: string) => new JSDOM(html).window.document;
const samples = [
  researchPageSnapshot(MONEY_ONLY_GOES_ONE_WAY),
  researchPageSnapshot(WHO_HAS_TO_REPORT_THEIR_MONEY),
  shortPostPageSnapshot(LOBBYIST_GIVING),
];

describe('Approved article titles in the first HTML response', () => {
  it.each(samples)('preserves each published title and its heading semantics', (snapshot) => {
    const document = documentFor(renderPageSnapshot(snapshot));
    expect(snapshot.article).toBe(true);
    expect(document.querySelectorAll('h1')).toHaveLength(1);
    const heading = document.querySelector('h1')!;
    expect(heading.textContent).toBe(snapshot.heading);
    expect(heading.className).toBe('ps-article-title');
    expect(document.querySelector('.page-snapshot-article')).not.toBeNull();
    const ranges = snapshot.heading.match(/\b\d{4}–\d{4}\b/gu) ?? [];
    expect([...heading.querySelectorAll('.ps-title-year')].map((span) => span.textContent)).toEqual(
      ranges,
    );
    expect(heading.getAttribute('tabindex')).toBe(ranges.length ? '0' : null);
    expect(heading.querySelector('nobr')).toBeNull();
    expect(heading.textContent).not.toContain('\u00a0');
  });

  it('escapes title content while keeping metadata and exact characters untouched', () => {
    const piece = { ...LOBBYIST_GIVING, title: '<img src=x onerror="bad()"> & 2015–2026' };
    const metadata = researchPageMetadata(piece);
    const snapshot = shortPostPageSnapshot(piece);
    const document = documentFor(renderPageSnapshot(snapshot));
    expect(document.querySelector('h1')?.textContent).toBe(piece.title);
    expect(document.querySelector('h1 img')).toBeNull();
    expect(snapshot.heading).toBe(piece.title);
    expect(snapshot.subheading).toBe(shortPostPageSnapshot(LOBBYIST_GIVING).subheading);
    expect(researchPageMetadata(piece)).toEqual(metadata);
    expect(metadata.title).toContain(piece.title);
  });

  it('leaves every unmarked heading unchanged, even when it contains a year range', () => {
    const snapshot = { ...homePageSnapshot(), heading: '2015–2026 <safe>' };
    const document = documentFor(renderPageSnapshot(snapshot));
    expect(document.querySelector('h1')?.outerHTML).toBe('<h1>2015–2026 &lt;safe&gt;</h1>');
    expect(document.querySelector('.ps-title-year')).toBeNull();
    expect(document.querySelector('.page-snapshot-article')).toBeNull();
  });

  it('scopes readable title and table rules to articles without changing title fonts or phone gutters', () => {
    const shell = readFileSync(new URL('../../../public/index.html', import.meta.url), 'utf8');
    expect(shell).toMatch(/h1\.ps-article-title\s*\{\s*max-width: 100%;\s*overflow-x: auto;/);
    expect(shell).toMatch(/h1\.ps-article-title\s*\{[^}]*overflow-wrap: anywhere;/);
    expect(shell).toMatch(
      /@media \(min-width: 768px\)\s*\{\s*\.page-snapshot-article h1\.ps-article-title\s*\{\s*max-width: 1040px;\s*text-wrap: balance;/,
    );
    expect(shell).toMatch(/\.ps-title-year\s*\{\s*white-space: nowrap;/);
    expect(shell).toContain('outline: 2px solid #7c5cff;');
    expect(shell).toContain('.page-snapshot-article .ps-table');
    expect(shell).toMatch(/min-width: 160px;\s*white-space: nowrap;/);
    expect(shell).toMatch(
      /\.page-snapshot h1\s*\{\s*margin: 12px 0 0;\s*font-size: 40px;\s*line-height: 46px;/,
    );
    expect(shell).toMatch(
      /\.page-snapshot \.ps-inner\s*\{\s*padding-left: 24px;\s*padding-right: 24px;/,
    );
  });
});

describe('Existing article tables in the first response', () => {
  it('ends initial article table row lines before the empty remaining width', () => {
    const shell = readFileSync(new URL('../../../public/index.html', import.meta.url), 'utf8');
    const snapshot = researchPageSnapshot(MONEY_ONLY_GOES_ONE_WAY);
    const document = documentFor(
      shell.replace('</body>', `${renderPageSnapshot(snapshot)}</body>`),
    );
    for (const table of document.querySelectorAll('.page-snapshot-article table')) {
      for (const row of table.querySelectorAll('tr')) {
        expect(
          document.defaultView!.getComputedStyle(row.lastElementChild!).borderBottomWidth,
        ).toBe('0px');
        expect(
          document.defaultView!.getComputedStyle(row.firstElementChild!).borderBottomWidth,
        ).toBe('1px');
      }
    }
    expect(document.querySelectorAll('.ps-table-spacer').length).toBeGreaterThan(0);
  });

  it('preserves all real research cells, associates headers and adds only 1 hidden spacer per row', () => {
    const snapshot = researchPageSnapshot(MONEY_ONLY_GOES_ONE_WAY);
    const tables = MONEY_ONLY_GOES_ONE_WAY.sections
      .flatMap((section) => section.blocks)
      .filter((block) => block.kind === 'table');
    const document = documentFor(renderPageSnapshot(snapshot));
    const rendered = [...document.querySelectorAll('table')];
    expect(rendered).toHaveLength(tables.length);
    rendered.forEach((table, index) => {
      expect([...table.querySelectorAll('thead th')].map((cell) => cell.textContent)).toEqual(
        tables[index].columns,
      );
      expect(
        [...table.querySelectorAll('thead th')].every(
          (cell) => cell.getAttribute('scope') === 'col',
        ),
      ).toBe(true);
      expect(
        [...table.querySelectorAll('tbody tr')].map((row) =>
          [...row.children]
            .filter((cell) => cell.getAttribute('aria-hidden') !== 'true')
            .map((cell) => cell.textContent),
        ),
      ).toEqual(tables[index].rows);
      for (const row of table.querySelectorAll('tr')) {
        expect(row.querySelectorAll('.ps-table-spacer')).toHaveLength(1);
        expect(row.lastElementChild?.getAttribute('aria-hidden')).toBe('true');
        expect(row.lastElementChild?.textContent).toBe('');
      }
      expect(
        [...table.querySelectorAll('tbody th')].every(
          (cell) => cell.getAttribute('scope') === 'row',
        ),
      ).toBe(true);
      expect(table.parentElement?.getAttribute('tabindex')).toBe('0');
    });
    const generic = documentFor(renderPageSnapshot({ ...snapshot, article: undefined }));
    expect(generic.querySelectorAll('.ps-table-spacer')).toHaveLength(0);
    expect(generic.querySelectorAll('.ps-article-table-scroll')).toHaveLength(0);
    expect(generic.querySelector('thead th')?.getAttribute('scope')).toBeNull();
    expect(generic.querySelector('tbody tr')?.firstElementChild?.tagName).toBe('TD');
  });
});

describe('Branded conclusions in the first response', () => {
  it('puts the answer above its qualification beside the left symbol without a narrower width', () => {
    const shell = readFileSync(new URL('../../../public/index.html', import.meta.url), 'utf8');
    const document = documentFor(
      shell.replace(
        '</body>',
        `${renderPageSnapshot(shortPostPageSnapshot(LOBBYIST_GIVING))}</body>`,
      ),
    );
    const conclusion = document.querySelector('.ps-conclusion')!;
    expect(conclusion).not.toBeNull();
    expect(conclusion.querySelector('svg')?.getAttribute('aria-label')).toBe('Alethical');
    expect(conclusion.querySelector('strong')).not.toBeNull();
    expect(
      document.defaultView!.getComputedStyle(conclusion.querySelector('strong')!).display,
    ).toBe('block');
    expect(conclusion.querySelectorAll('p')).toHaveLength(1);
    expect(document.defaultView!.getComputedStyle(conclusion).maxWidth).toBe('none');
    expect(document.defaultView!.getComputedStyle(conclusion.querySelector('p')!).flexGrow).toBe(
      '1',
    );
    expect(conclusion.querySelector('svg')?.getAttribute('width')).toBe('31');
  });
});
