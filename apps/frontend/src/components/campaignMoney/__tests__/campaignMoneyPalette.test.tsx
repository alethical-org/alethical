// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

import type { CommitteeReceivedPayment } from '../../../data/types';
import { CAMPAIGN_MONEY_COLORS as c } from '../../../lib/campaignMoneyColors';
import { DonorBreakdown } from '../DonorBreakdown';
import { CommitteeMixHistory } from '../CommitteeMixHistory';

vi.mock('../../../hooks/useResponsive', () => ({
  useResponsive: () => ({ isMobile: true, isTablet: false }),
}));
vi.mock('../../../hooks/useCampaignMoneyDetails', () => ({
  useCampaignMoneyDetails: () => ({
    historyComplete: true,
    history: {
      data: {
        years: Array.from({ length: 12 }, (_, index) => ({
          year: 2015 + index,
          payments: paletteRows,
        })),
      },
    },
  }),
}));
vi.mock('react-native-svg', () => ({
  default: ({ children, ...props }: React.SVGProps<SVGSVGElement>) => (
    <svg {...props}>{children}</svg>
  ),
  Circle: (props: React.SVGProps<SVGCircleElement>) => <circle {...props} />,
}));

// Deliberately synthetic: cover every kind without inventing a kind in Abeler's records.
const paletteRows: CommitteeReceivedPayment[] = [
  'Individual',
  'Lobbyist',
  'Political Committee/Fund',
  'Party Unit',
  'Other',
].map((contributorType) => ({
  contributor: `${contributorType} colour sample`,
  contributorType,
  contributorRegistrationNumber: null,
  employer: null,
  receivedOn: '2025-01-10',
  receiptType: 'Contribution',
  inKind: 'No',
  amount: '100.00',
}));
const namedColors = [c.individuals, c.lobbyists, c.committees, c.partyUnits, c.other];
let root: Root | undefined;
let container: HTMLDivElement;

function draw(unnamed: boolean) {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      <>
        <div id="donut">
          <DonorBreakdown
            payments={paletteRows}
            split={{
              state: unnamed ? 'shown' : 'no_reported_total',
              reportedTotal: unnamed ? '600.00' : null,
              namedCashTotal: '500.00',
              namedInKindTotal: '0.00',
              unnamedTotal: unnamed ? '100.00' : null,
            }}
            year={2025}
            complete
            failed={false}
            onSelectTab={vi.fn()}
          />
        </div>
        <div id="history">
          <CommitteeMixHistory
            registrationNumber="colour-test"
            committeeName="Colour sample"
            year={2025}
            onSelectYear={vi.fn()}
          />
        </div>
      </>,
    ),
  );
}

function rgb(value: string) {
  const probe = document.createElement('div');
  probe.style.backgroundColor = value;
  return probe.style.backgroundColor;
}

function swatches(selector: string) {
  return [...container.querySelectorAll<HTMLElement>(selector)].filter((element) => {
    const style = getComputedStyle(element);
    return style.width === '14px' && style.height === '14px';
  });
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = undefined;
});

it('uses each solid kind colour in the donut, its square swatch and every year bar and legend', () => {
  draw(true);
  const colors = [...namedColors, c.unnamed];
  const circles = [...container.querySelectorAll('circle')];
  expect(circles.map((circle) => circle.getAttribute('stroke'))).toEqual(colors);
  expect(container.querySelector('svg')!.getAttribute('viewBox')).toBe('0 0 180 180');
  circles.forEach((circle) => {
    const length = Number(circle.getAttribute('stroke-dasharray')!.split(' ')[0]);
    expect(length).toBeCloseTo((Math.PI * 140) / 6 - 3, 5);
  });
  expect(swatches('#donut div').map((swatch) => getComputedStyle(swatch).backgroundColor)).toEqual(
    colors.map(rgb),
  );
  const bars = [...container.querySelectorAll<HTMLElement>('#history [role="img"]')];
  expect(bars).toHaveLength(12);
  bars.forEach((bar) => {
    expect(getComputedStyle(bar).gap).toBe('2px');
    expect([...bar.children].map((segment) => getComputedStyle(segment).backgroundColor)).toEqual(
      namedColors.map(rgb),
    );
  });
  expect(
    swatches('#history div').map((swatch) => getComputedStyle(swatch).backgroundColor),
  ).toEqual(namedColors.map(rgb));
  swatches('div').forEach((swatch) => {
    const style = getComputedStyle(swatch);
    expect(style.borderTopLeftRadius).toBe('3px');
    expect(parseFloat(style.borderTopWidth) || 0).toBe(0);
    expect(swatch.children).toHaveLength(0);
  });
  expect(container.querySelector('pattern, mask, image, use')).toBeNull();
});

it('reserves grey for unnamed contributions and keeps every slice distinct from white', () => {
  expect(namedColors).toEqual(['#149d5b', '#1f8fe6', '#7c3aed', '#e56b12', '#d6336c']);
  expect(c.unnamed).toBe('#899087');
  for (const color of [...namedColors, c.unnamed]) {
    const channels = color.match(/[a-f0-9]{2}/gi)!.map((pair) => parseInt(pair, 16) / 255);
    const linear = channels.map((value) =>
      value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
    );
    const contrast = 1.05 / (0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2] + 0.05);
    // The accepted palette states contrast to 2 decimal places.
    expect(Number(contrast.toFixed(2))).toBeGreaterThanOrEqual(3.26);
    if (color !== c.unnamed)
      expect(Math.max(...channels) - Math.min(...channels)).toBeGreaterThan(0.4);
  }
  draw(false);
  expect(
    [...container.querySelectorAll('circle')].map((circle) => circle.getAttribute('stroke')),
  ).toEqual(namedColors);
  expect(container.textContent).not.toContain('Non-itemized contributions');
});
