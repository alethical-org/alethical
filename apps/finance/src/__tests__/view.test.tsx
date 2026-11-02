import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BarList, SplitBarList, useView, ViewSwitch } from '../ui/view';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function Section() {
  const [view, setView] = useView('typeView');
  return (
    <div>
      <ViewSwitch value={view} onChange={setView} />
      <output>{view}</output>
    </div>
  );
}

describe('the Chart/Table view switch (eug-141)', () => {
  it('opens on Chart, keeps an explicit Table choice in the address and drops the default', async () => {
    window.history.replaceState(null, '', '/money/committees/1');
    await act(async () => root.render(<Section />));
    const buttons = container.querySelectorAll<HTMLButtonElement>('.f-view-button');
    expect([...buttons].map((button) => button.textContent)).toEqual(['Chart', 'Table']);
    expect(buttons[0].getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('output')?.textContent).toBe('chart');

    await act(async () => buttons[1].click());
    expect(window.location.search).toBe('?typeView=table');
    expect(container.querySelector('output')?.textContent).toBe('table');
    expect(buttons[1].getAttribute('aria-pressed')).toBe('true');

    await act(async () => buttons[0].click());
    expect(window.location.search).toBe('');
  });

  it('reads an explicit Table choice from the address and moves between buttons with arrows', async () => {
    window.history.replaceState(null, '', '/money/committees/1?typeView=table&year=2026');
    await act(async () => root.render(<Section />));
    const buttons = container.querySelectorAll<HTMLButtonElement>('.f-view-button');
    expect(buttons[1].getAttribute('aria-pressed')).toBe('true');
    buttons[1].focus();
    await act(async () => {
      buttons[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    });
    expect(document.activeElement).toBe(buttons[0]);
  });
});

describe('bar charts', () => {
  it('draws a bar only for a positive amount and prints every value', async () => {
    await act(async () =>
      root.render(
        <BarList
          label="Total reported spending, by year"
          rows={[
            { key: '2025', label: '2025', amount: 1000, value: '$1,000' },
            { key: '2024', label: '2024', amount: 0, value: '$0' },
            { key: '2023', label: '2023', amount: null, value: 'Not reported' },
            {
              key: '2022',
              label: '2022',
              amount: null,
              value: 'No spending report held',
              gap: true,
            },
          ]}
        />,
      ),
    );
    const list = container.querySelector('ul[aria-label="Total reported spending, by year"]');
    expect(list).toBeTruthy();
    const rows = container.querySelectorAll('.f-bar-row');
    expect(rows).toHaveLength(4);
    expect(rows[0].querySelector('.f-bar-fill')?.getAttribute('style')).toContain('width: 100%');
    expect(rows[1].querySelector('.f-bar-fill')).toBeNull();
    expect(rows[2].querySelector('.f-bar-fill')).toBeNull();
    expect(rows[3].hasAttribute('data-gap')).toBe(true);
    expect(container.textContent).toContain('Not reported');
    expect(container.textContent).toContain('No spending report held');
    // Bars are not links and not focusable.
    expect(container.querySelector('.f-bars a, .f-bars button, .f-bars [tabindex]')).toBeNull();
  });

  it('puts For bars right and Against bars left of the centre line', async () => {
    await act(async () =>
      root.render(
        <SplitBarList
          label="Spending by outside groups"
          rows={[
            { key: 'a', label: 'A', amount: 500, value: '$500' },
            { key: 'b', label: 'B', amount: -250, value: '−$250' },
            { key: 'c', label: 'C', amount: null, value: 'Missing payment amount' },
          ]}
        />,
      ),
    );
    const fills = container.querySelectorAll<HTMLElement>('.f-bar-fill');
    expect(fills).toHaveLength(2);
    expect(fills[0].style.left).toBe('50%');
    expect(fills[0].style.width).toBe('50%');
    expect(fills[1].style.right).toBe('50%');
    expect(fills[1].style.width).toBe('25%');
    expect(container.textContent).toContain('Against');
    expect(container.textContent).toContain('For');
  });
});
