// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { CommitteeRefunds } from '../../../data/types';
import { CommitteeRefundCard } from '../CommitteeRefundCard';
import { refundFixture } from './refundFixtures';

const responsive = vi.hoisted(() => ({ width: 1200 }));
vi.mock('../../../hooks/useResponsive', () => ({
  useResponsive: () => ({
    width: responsive.width,
    isMobile: responsive.width < 768,
    isTablet: responsive.width >= 768 && responsive.width < 1100,
    isDesktop: responsive.width >= 1100,
  }),
}));
const { renderToStaticMarkup } = require('react-dom/server') as typeof import('react-dom/server');

function render(refunds: CommitteeRefunds | undefined = refundFixture()) {
  const container = document.createElement('div');
  container.innerHTML = renderToStaticMarkup(
    <CommitteeRefundCard registrationNumber="17868" refunds={refunds} />,
  );
  return container;
}

function row(container: HTMLElement, year: number): HTMLTableRowElement | undefined {
  return [...container.querySelectorAll<HTMLTableRowElement>('tbody tr')].find(
    (entry) => entry.querySelector('th[scope="row"]')?.textContent === String(year),
  );
}
const cells = (entry: HTMLTableRowElement | undefined) =>
  entry ? [...entry.cells].map((cell) => cell.textContent) : [];

describe('the per-committee refund card', () => {
  it.each([375, 900, 1200])('prints the held Abeler figures in 3 columns at width %s', (width) => {
    responsive.width = width;
    const container = render();
    expect(container.querySelector('caption')?.textContent).toBe('Refunds by year');
    expect([...container.querySelectorAll('thead th')].map((cell) => cell.textContent)).toEqual([
      'Year',
      'Contributions refunded',
      'Amount refunded',
    ]);
    expect(
      [...container.querySelectorAll('thead th')].every(
        (cell) => cell.getAttribute('scope') === 'col',
      ),
    ).toBe(true);
    expect(cells(row(container, 2025))).toEqual(['2025', '180', '$14,216']);
    expect(cells(row(container, 2021))).toEqual(['2021', '54', '$4,158']);
    expect(cells(row(container, 2024))).toEqual(['2024', 'Count not published', '$10,508']);
    expect(row(container, 2016)).toBeUndefined();
    expect(row(container, 2015)).toBeUndefined();
    expect(container.querySelector('tfoot')).toBeNull();
    expect(container.textContent).not.toMatch(/\btotal\b/i);
  });

  it('shows Dibble’s 2016 absence between real matched rows with a year header and 2-column message', () => {
    const container = render(refundFixture('15667'));
    expect(cells(row(container, 2017))).toEqual(['2017', '85', '$5,392']);
    expect(cells(row(container, 2015))).toEqual(['2015', '33', '$2,045']);
    const gap = row(container, 2016)!;
    expect(cells(gap)).toEqual(['2016', 'Not published']);
    expect(gap.querySelector('th')?.getAttribute('scope')).toBe('row');
    expect(gap.querySelector('td')?.colSpan).toBe(2);
    expect(gap.nextElementSibling?.textContent).toBe('The Board published no summary for 2016');
    expect(row(container, 2026)).toBeUndefined();
  });

  it('preserves true zero figures and distinguishes a missing count', () => {
    const refunds = refundFixture();
    refunds.years = [
      {
        ...refunds.years.find((entry) => entry.year === 2025)!,
        contributionsRefunded: 0,
        amountRefunded: '0.00',
      },
    ];
    expect(cells(row(render(refunds), 2025))).toEqual(['2025', '0', '$0']);
  });

  it('keeps a known uncopied year visible without claiming the Board published nothing', () => {
    const refunds = refundFixture();
    refunds.state = 'unavailable';
    refunds.years = refunds.years.map((entry) => ({
      ...entry,
      state: entry.year === 2026 ? 'unavailable' : 'not_matched',
      contributionsRefunded: null,
      amountRefunded: null,
    }));
    const container = render(refunds);
    expect(cells(row(container, 2026))).toEqual(['2026', 'Not yet copied by Alethical']);
    expect(row(container, 2026)?.querySelector('td')?.colSpan).toBe(2);
    expect(row(container, 2025)).toBeUndefined();
    expect(container.textContent).not.toContain('The Board published no summary');
    expect(container.textContent).not.toContain('name no row');
    expect(container.textContent).not.toContain('$0');
  });

  it('keeps the introduction and source on a no-match card without a table or zero', () => {
    const refunds = refundFixture();
    refunds.state = 'not_matched';
    refunds.copiedOn = '2026-09-10';
    refunds.years = refunds.years.map((entry) => ({
      ...entry,
      state: 'not_matched',
      contributionsRefunded: null,
      amountRefunded: null,
    }));
    const container = render(refunds);
    expect(container.textContent).toContain("Refunds the state paid to this committee's donors");
    expect(container.textContent).toContain(
      'This is money the state returned to donors, not money the committee received.',
    );
    expect(container.textContent).toContain(
      "The Board's refund summaries name no row for this committee's candidate, office and party.",
    );
    expect(container.querySelector('table')).toBeNull();
    expect(container.textContent).not.toContain('$0');
    expect(container.querySelectorAll('a')).toHaveLength(1);
    expect(container.querySelector('a')?.textContent).toBe(
      'Board summary files last copied Sep 10, 2026',
    );
    expect(container.querySelector('a')?.getAttribute('href')).toBe(refunds.sourceUrl);
  });

  it('retains held amounts beside a newer unavailable year', () => {
    const refunds = refundFixture();
    refunds.years.find((entry) => entry.year === 2026)!.state = 'unavailable';
    const container = render(refunds);
    expect(cells(row(container, 2026))).toEqual(['2026', 'Not yet copied by Alethical']);
    expect(cells(row(container, 2025))).toEqual(['2025', '180', '$14,216']);
    expect(container.textContent).not.toContain('The Board published no summary for 2026');
  });

  it('calls an empty unavailable history our missing copy without inventing source details', () => {
    const container = render({ state: 'unavailable', years: [], sourceUrl: null, copiedOn: null });
    expect(container.textContent).toContain('Not yet copied by Alethical');
    expect(container.textContent).not.toContain('name no row');
    expect(container.querySelector('table')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).not.toContain('last copied');
  });

  it('uses exactly the stored program link and copy date without linking years', () => {
    const refunds = {
      ...refundFixture(),
      sourceUrl: 'https://cfb.mn.gov/stored-program-page',
      copiedOn: '2026-09-10',
    };
    const container = render(refunds);
    const links = container.querySelectorAll('a');
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe(refunds.sourceUrl);
    expect(links[0].textContent).toBe('Board summary files last copied Sep 10, 2026');
    expect(container.querySelector('table a')).toBeNull();
    const withoutSource = render({ ...refunds, sourceUrl: null });
    expect(withoutSource.querySelector('a')).toBeNull();
  });

  it.each([false, null])(
    'withholds the shared counting note if a displayed source says %s',
    (note) => {
      const refunds = refundFixture();
      expect(render(refunds).textContent).toContain(
        'The Board counts a married couple filing jointly as one contribution',
      );
      refunds.years.find((entry) => entry.year === 2025)!.jointFilingCountsAsOne = note;
      expect(render(refunds).textContent).not.toContain(
        'The Board counts a married couple filing jointly',
      );
    },
  );

  it('does not reorder or rewrite the supplied records while rendering', () => {
    const refunds = refundFixture();
    refunds.years.reverse();
    const before = JSON.stringify(refunds);
    refunds.years.forEach(Object.freeze);
    Object.freeze(refunds.years);
    Object.freeze(refunds);
    const container = render(refunds);
    expect(row(container, 2025)?.textContent).toContain('$14,216');
    expect(JSON.stringify(refunds)).toBe(before);
  });

  it('does not invent a block when an older response omitted refunds', () => {
    const container = document.createElement('div');
    container.innerHTML = renderToStaticMarkup(
      <CommitteeRefundCard registrationNumber="17868" refunds={undefined} />,
    );
    expect(container.textContent).toBe('');
  });
});
