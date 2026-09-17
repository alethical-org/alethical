// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CAMPAIGN_MONEY_COLORS as c } from '../../../lib/campaignMoneyColors';
import { YearControl } from '../YearControl';

let mount: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  mount = document.createElement('div');
  document.body.append(mount);
  root = createRoot(mount);
});
afterEach(() => {
  act(() => root.unmount());
  mount.remove();
});

function color(value: string) {
  const element = document.createElement('div');
  element.style.color = value;
  return element.style.color;
}

describe('shared campaign money year buttons', () => {
  it.each(['committee', 'profile'] as const)(
    'keeps selection and named-only information on %s',
    (surface) => {
      const onSelect = vi.fn();
      const draw = (year: number) =>
        act(() =>
          root.render(
            <YearControl
              surface={surface}
              year={year}
              years={[2026, 2025, 2024]}
              namesOnlyYears={new Set([2024])}
              onSelect={onSelect}
            />,
          ),
        );
      draw(2026);
      const buttons = [...mount.querySelectorAll<HTMLElement>('[role="button"]')];
      expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
        '2026',
        '2025',
        '2024, named donations only',
      ]);
      expect(buttons.map((button) => button.getAttribute('aria-pressed'))).toEqual([
        'true',
        'false',
        'false',
      ]);
      expect(getComputedStyle(buttons[0]).backgroundColor).toBe(color(c.text));
      expect(getComputedStyle(buttons[2]).borderStyle).toBe('dashed');
      const label = [...mount.querySelectorAll('div')].find(
        (element) => element.textContent === 'Year',
      )!;
      expect(getComputedStyle(label).fontWeight).toBe('400');
      for (const button of buttons) {
        expect(getComputedStyle(button).borderTopLeftRadius).toBe('10px');
        expect(getComputedStyle(button).borderBottomRightRadius).toBe('10px');
        expect(getComputedStyle(button).minHeight).toBe('44px');
        expect(getComputedStyle(button.firstElementChild!).fontWeight).toBe('400');
      }
      act(() => buttons[1].click());
      expect(onSelect).toHaveBeenLastCalledWith(2025);
      draw(2025);
      expect(buttons.map((button) => button.getAttribute('aria-pressed'))).toEqual([
        'false',
        'true',
        'false',
      ]);
    },
  );

  it('lets a long year history wrap without shrinking the digits', () => {
    act(() =>
      root.render(
        <YearControl
          year={2026}
          years={Array.from({ length: 12 }, (_, index) => 2026 - index)}
          fullWidth
          onSelect={vi.fn()}
        />,
      ),
    );
    expect(getComputedStyle(mount.querySelector('[role="group"]')!).flexWrap).toBe('wrap');
    const buttons = [...mount.querySelectorAll('[role="button"]')];
    expect(buttons).toHaveLength(12);
    for (const button of buttons) {
      const style = getComputedStyle(button);
      expect(style.flexShrink).toBe('0');
      expect(style.flexBasis).toBe('auto');
      expect(style.minWidth).toBe('76px');
    }
  });
});
