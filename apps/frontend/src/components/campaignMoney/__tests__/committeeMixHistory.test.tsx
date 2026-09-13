// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

import { CommitteeMixHistory } from '../CommitteeMixHistory';

vi.hoisted(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
vi.mock('../../../hooks/useCampaignMoneyDetails', () => ({
  useCampaignMoneyDetails: () => ({
    historyComplete: true,
    history: { data: { years: [] } },
  }),
}));

let root: Root;
let host: HTMLDivElement;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
});

it('names itemized contributions and leaves the committee name to its surrounding block', () => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root.render(
      <CommitteeMixHistory
        registrationNumber="17868"
        committeeName="Abeler, Jim Senate Committee"
        year={2025}
        onSelectYear={vi.fn()}
      />,
    ),
  );

  expect(host.querySelector('[role="heading"]')?.textContent).toBe(
    'How the mix of itemized contributions changed by year',
  );
  const note = [...host.querySelectorAll<HTMLElement>('[dir="auto"]')].find(
    (element) => element.textContent === 'Non-itemized contributions cannot be split by kind',
  );
  expect(note).toBeDefined();
  expect(host.textContent).not.toContain('Abeler, Jim Senate Committee');
  expect(host.querySelector('strong, b')).toBeNull();
  const noteStyle = getComputedStyle(note!);
  expect(['normal', '400']).toContain(noteStyle.fontWeight);
  expect(noteStyle.maxWidth).toBe('none');
  expect(noteStyle.getPropertyValue('text-wrap')).toBe('pretty');
});
