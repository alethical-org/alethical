// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { CommitteeMixHistory } from '../CommitteeMixHistory';
import type { DetailedReceivedPayment } from '../../../lib/campaignMoneyDetails';
import { committeePaymentsReceivedFromPayload } from '../../../data/api';
import fixture from '../../../lib/__tests__/fixtures/campaign-money-17868-2025.json';

const data = vi.hoisted(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  return {
    complete: true,
    mobile: false,
    releaseId: 'release',
    years: [] as { year: number; payments: DetailedReceivedPayment[] }[],
  };
});
vi.mock('../../../hooks/useCampaignMoneyDetails', () => ({
  useCampaignMoneyDetails: () => ({
    historyComplete: data.complete,
    history: { data: { years: data.years, releaseId: data.releaseId } },
  }),
}));
vi.mock('../../../hooks/useResponsive', () => ({
  useResponsive: () => ({ isMobile: data.mobile, isTablet: false }),
}));

let root: Root;
let host: HTMLDivElement;
const gift = (patch: Partial<DetailedReceivedPayment> = {}): DetailedReceivedPayment => ({
  contributor: 'Test contributor',
  contributorRegistrationNumber: null,
  contributorType: 'Individual',
  employer: null,
  amount: '100',
  receivedOn: '2025-01-01',
  receiptType: 'Contribution',
  inKind: 'No',
  ...patch,
});
const real = committeePaymentsReceivedFromPayload(fixture.data).payments;

beforeEach(() => {
  data.years = [];
  data.complete = true;
  data.releaseId = 'release';
  data.mobile = false;
});
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
});
function render(onSelectYear = vi.fn(), releaseId?: string) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root.render(
      <CommitteeMixHistory
        registrationNumber="17868"
        committeeName="Abeler, Jim Senate Committee"
        year={2025}
        onSelectYear={onSelectYear}
        releaseId={releaseId}
      />,
    ),
  );
  return onSelectYear;
}
const button = (label: string) =>
  host.querySelector<HTMLElement>(`[role="button"][aria-label="${label}"]`)!;
const buttonText = (label: string) =>
  [...host.querySelectorAll<HTMLElement>('[role="button"]')].find(
    (element) => element.textContent === label,
  )!;

it('explains percentages without repeating the committee name', () => {
  render();
  expect(host.querySelector('[role="heading"]')?.textContent).toBe(
    'How the mix of itemized contributions changed by year',
  );
  const note = [...host.querySelectorAll<HTMLElement>('[dir="auto"]')].find(
    (element) =>
      element.textContent ===
      'Each bar shows the percentage of dollars from each donor kind, excluding donated goods and services',
  );
  expect(note).toBeDefined();
  expect(host.textContent).not.toContain('Abeler, Jim Senate Committee');
  expect(host.textContent).not.toContain('Non-itemized contributions cannot be split by kind');
  expect(host.querySelector('strong, b')).toBeNull();
  expect(getComputedStyle(note!).maxWidth).toBe('900px');
  expect(getComputedStyle(note!).getPropertyValue('text-wrap')).toBe('pretty');
});

it('collapses leading empty years but preserves gaps and lets readers restore years in place', () => {
  data.years = [
    { year: 2021, payments: [] },
    { year: 2022, payments: [] },
    { year: 2023, payments: [gift()] },
    { year: 2024, payments: [] },
    { year: 2025, payments: [gift()] },
  ];
  const select = render();
  expect(button('Choose 2021')).toBeNull();
  expect(button('Choose 2024')).not.toBeNull();
  expect(host.textContent).toContain('No itemized contributions listed');
  expect(buttonText('Show earlier years').querySelector('svg')).toBeNull();
  expect(buttonText('Show earlier years').textContent).not.toMatch(/[→↗]/);
  expect(getComputedStyle(buttonText('Show earlier years').firstElementChild!).color).toBe(
    'rgb(15, 122, 69)',
  );
  act(() => buttonText('Show earlier years').click());
  expect(buttonText('Hide earlier years').getAttribute('aria-expanded')).toBe('true');
  expect(
    [...host.querySelectorAll('[aria-label^="Choose "]')].map((node) => node.textContent),
  ).toEqual(['2021', '2022', '2023', '2024', '2025']);
  act(() => button('Choose 2021').click());
  expect(select).toHaveBeenCalledWith(2021);
  act(() => buttonText('Hide earlier years').click());
  expect(button('Choose 2021')).toBeNull();
  expect(button('Choose 2024')).not.toBeNull();
});

it('does not disguise an all-empty history or unusable amounts as collapsed years', () => {
  data.years = [
    { year: 2024, payments: [] },
    { year: 2025, payments: [] },
  ];
  render();
  expect(buttonText('Show earlier years')).toBeUndefined();
  expect(button('Choose 2024')).not.toBeNull();
  expect(host.textContent?.match(/No itemized contributions listed/g)).toHaveLength(2);
  data.years = [
    { year: 2024, payments: [gift({ inKind: 'Yes' })] },
    { year: 2025, payments: [gift({ amount: null })] },
  ];
  act(() =>
    root.render(
      <CommitteeMixHistory
        registrationNumber="17868"
        committeeName="Committee"
        year={2025}
        onSelectYear={vi.fn()}
      />,
    ),
  );
  expect(buttonText('Show earlier years')).toBeUndefined();
  expect(host.textContent?.match(/A cash breakdown is unavailable/g)).toHaveLength(2);
  expect(host.textContent).not.toContain('No itemized contributions listed');
});

it('orders the legend by donor kind even when an earlier year contains only committees', () => {
  data.years = [
    { year: 2024, payments: [gift({ contributorType: 'Candidate Committee' })] },
    { year: 2025, payments: real },
  ];
  render();
  const legend = host.querySelector('[aria-label="Donor kinds"]')!;
  expect([...legend.children].map((node) => node.textContent)).toEqual([
    'Individuals',
    'Lobbyists',
    'Committees & Funds',
    'Party Units',
  ]);
  expect(legend.textContent).not.toContain('Other kinds');
});

it('exposes every itemized-only percentage through a 44px keyboard-focusable phone control', () => {
  data.mobile = true;
  data.years = [{ year: 2025, payments: real }];
  render();
  const control = button('View percentages for 2025');
  expect(getComputedStyle(control).minHeight).toBe('44px');
  expect(control.tagName).toBe('BUTTON');
  expect(control.tabIndex).toBe(0);
  act(() => {
    control.focus();
    control.click();
  });
  const list = host.querySelector('[aria-label="Itemized contribution percentages for 2025"]')!;
  expect(list).not.toBeNull();
  expect([...list.children].map((node) => node.textContent)).toEqual([
    'Individuals59.5%',
    'Lobbyists2.1%',
    'Committees & Funds24.7%',
    'Party Units13.7%',
  ]);
  expect(list.textContent).not.toContain('Non-itemized');
  expect(button('Hide percentages for 2025').getAttribute('aria-expanded')).toBe('true');
  act(() => button('Hide percentages for 2025').click());
  expect(
    host.querySelector('[aria-label="Itemized contribution percentages for 2025"]'),
  ).toBeNull();
  act(() => button('View percentages for 2025').click());
  expect(
    host.querySelector('[aria-label="Itemized contribution percentages for 2025"]'),
  ).not.toBeNull();
});

it('keeps the pointed, focused or tapped share readable after leaving the segment', () => {
  data.years = [{ year: 2025, payments: [gift(), gift({ contributorType: 'Lobbyist' })] }];
  render();
  const status = host.querySelector<HTMLElement>('[role="status"]')!;
  expect(status.textContent).toBe(
    'Point to a segment, tap it, or reach it with the keyboard for its share',
  );
  const individual = button('2025, Individuals 50%');
  expect(getComputedStyle(individual).height).toBe('22px');
  act(() => individual.focus());
  expect(status.textContent).toBe('2025Individuals50%');
  act(() => individual.blur());
  expect(status.textContent).toBe('2025Individuals50%');
  act(() => button('2025, Lobbyists 50%').click());
  expect(status.textContent).toBe('2025Lobbyists50%');
  expect(getComputedStyle(status).minHeight).toBe('68px');
});

it('withholds history while incomplete or from another release', () => {
  data.complete = false;
  data.years = [{ year: 2025, payments: real }];
  render(undefined, 'requested');
  expect(host.textContent).toBe('');
  data.complete = true;
  act(() =>
    root.render(
      <CommitteeMixHistory
        registrationNumber="17868"
        committeeName="Committee"
        year={2025}
        onSelectYear={vi.fn()}
        releaseId="requested"
      />,
    ),
  );
  expect(host.textContent).toBe('');
});
