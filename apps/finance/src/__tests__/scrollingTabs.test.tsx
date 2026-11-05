import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ScrollingTabs } from '../ui/scrollingTabs';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root;
const tabs = [
  { value: 'folders', label: 'TV station folders' },
  { value: 'stations', label: 'Stations', count: '3' },
];
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});
function render() {
  act(() =>
    root.render(<ScrollingTabs label="Files" value="folders" tabs={tabs} onChange={() => {}} />),
  );
  const row = container.querySelector<HTMLElement>('[role="tablist"]')!;
  const target = container.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1];
  Object.defineProperties(row, {
    clientWidth: { configurable: true, value: 300 },
    offsetLeft: { configurable: true, value: 0 },
    scrollWidth: { configurable: true, value: 500 },
  });
  Object.defineProperties(target, {
    offsetLeft: { configurable: true, value: 280 },
    offsetWidth: { configurable: true, value: 100 },
  });
  return { row, target };
}
it('does not move a partly visible tab when pointer focus arrives before its click', () => {
  const { row, target } = render();
  vi.spyOn(target, 'matches').mockReturnValue(false);
  act(() => target.focus());
  expect(document.activeElement).toBe(target);
  expect(row.scrollLeft).toBe(0);
});
it('reveals a keyboard-focused tab without moving focus away', () => {
  const { row, target } = render();
  vi.spyOn(target, 'matches').mockReturnValue(true);
  act(() => target.focus());
  expect(document.activeElement).toBe(target);
  expect(row.scrollLeft).toBeGreaterThan(0);
  expect(target.offsetLeft + target.offsetWidth).toBeLessThanOrEqual(
    row.scrollLeft + row.clientWidth - 56,
  );
});
it('still reveals a newly selected tab after pointer focus', () => {
  const { row, target } = render();
  vi.spyOn(target, 'matches').mockReturnValue(false);
  act(() => target.focus());
  act(() =>
    root.render(<ScrollingTabs label="Files" value="stations" tabs={tabs} onChange={() => {}} />),
  );
  expect(row.scrollLeft).toBeGreaterThan(0);
  expect(target.getAttribute('aria-selected')).toBe('true');
  expect(document.activeElement).toBe(target);
});

it('reveals earlier tabs and transfers focus when a clicked arrow disappears', () => {
  const onChange = vi.fn();
  act(() =>
    root.render(
      <ScrollingTabs
        label="Files"
        value="stations"
        tabs={tabs}
        onChange={onChange}
        scrollButtons
      />,
    ),
  );
  const row = container.querySelector<HTMLElement>('[role="tablist"]')!;
  const [first, selected] = row.querySelectorAll<HTMLButtonElement>('[role="tab"]');
  Object.defineProperties(row, {
    clientWidth: { value: 260 },
    scrollWidth: { value: 380 },
    scrollTo: {
      value: ({ left }: ScrollToOptions) => {
        row.scrollLeft = left ?? 0;
        row.dispatchEvent(new Event('scroll'));
      },
    },
  });
  Object.defineProperties(first, { offsetLeft: { value: 4 }, offsetWidth: { value: 170 } });
  Object.defineProperties(selected, { offsetLeft: { value: 176 }, offsetWidth: { value: 200 } });
  act(() => {
    row.scrollLeft = 120;
    row.dispatchEvent(new Event('scroll'));
  });
  const left = container.querySelector<HTMLButtonElement>('[aria-label="Scroll tabs left"]')!;
  expect(left).toBeTruthy();
  expect(container.querySelector('[aria-label="Scroll tabs right"]')).toBeNull();
  vi.spyOn(left, 'matches').mockReturnValue(false);
  act(() => {
    left.focus();
    left.click();
  });
  expect(row.scrollLeft).toBe(0);
  expect(onChange).not.toHaveBeenCalled();
  expect(selected.getAttribute('aria-selected')).toBe('true');
  expect(container.querySelector('[aria-label="Scroll tabs left"]')).toBeNull();
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Scroll tabs right');
});
