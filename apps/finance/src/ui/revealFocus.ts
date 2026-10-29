import { useCallback, useLayoutEffect, useRef } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled])';

/**
 * Keeps keyboard focus after "Show more": when the last press removes the button,
 * focus would otherwise fall to the page body. Call `mark()` as the reveal starts;
 * once new rows render, if focus was lost, it moves to the first newly shown control.
 */
export function useRevealFocus<E extends HTMLElement>() {
  const list = useRef<E | null>(null);
  const before = useRef<number | null>(null);

  const mark = useCallback(() => {
    before.current = list.current?.querySelectorAll(FOCUSABLE).length ?? null;
  }, []);

  useLayoutEffect(() => {
    const count = before.current;
    if (count === null || !list.current) return;
    const items = list.current.querySelectorAll<HTMLElement>(FOCUSABLE);
    if (items.length <= count) return;
    before.current = null;
    const active = document.activeElement;
    if (!active || active === document.body || !active.isConnected) items[count]?.focus();
  });

  return { list, mark };
}
