import { useCallback, useEffect, useRef, useState } from 'react';

import { Tabs, type Tab } from './controls';

function RightChevron() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M9 5 L16 12 L9 19"
        stroke="#4A5661"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Scrolls the row, never the page, so `tab` is fully in view; 56px on the right
 * clears the fade and chevron (Round 35). */
export function revealTab(row: HTMLElement, tab: HTMLElement) {
  const left = tab.offsetLeft - row.offsetLeft;
  const right = left + tab.offsetWidth;
  if (left < row.scrollLeft + 4) row.scrollLeft = Math.max(0, left - 8);
  else if (right > row.scrollLeft + row.clientWidth - 56) {
    row.scrollLeft = right - row.clientWidth + 56;
  }
}

/**
 * The shared tab row on 1 line at every band, scrolling only when needed, with a
 * right-edge fade and chevron while more tabs lie to the right (Round 35). The
 * selected tab is brought into view on load and on every change, and a
 * keyboard-focused tab is kept fully in view by scrolling the row. 4px of inner
 * space keeps the focus ring whole. The cue never takes a press.
 */
export function ScrollingTabs<T extends string>(props: {
  label: string;
  value: T;
  tabs: ReadonlyArray<Tab<T>>;
  onChange: (value: T) => void;
}) {
  const wrapper = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  const row = () => wrapper.current?.querySelector<HTMLElement>('.f-tabs') ?? null;
  const check = useCallback(() => {
    const element = wrapper.current?.querySelector<HTMLElement>('.f-tabs');
    setMore(!!element && element.scrollWidth - element.clientWidth - element.scrollLeft > 4);
  }, []);
  useEffect(() => {
    const element = wrapper.current?.querySelector<HTMLElement>('.f-tabs');
    check();
    element?.addEventListener('scroll', check, { passive: true });
    window.addEventListener('resize', check);
    return () => {
      element?.removeEventListener('scroll', check);
      window.removeEventListener('resize', check);
    };
  }, [check]);
  useEffect(check);
  // The selected tab comes into view on load and whenever it changes.
  useEffect(() => {
    const element = row();
    const selected = element?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (element && selected) revealTab(element, selected);
    check();
  }, [props.value, check]);
  return (
    <div
      ref={wrapper}
      className="f-scroll-tabs"
      onFocus={(event) => {
        const element = row();
        const target = event.target as HTMLElement;
        if (element && target.getAttribute('role') === 'tab') revealTab(element, target);
      }}
    >
      <Tabs {...props} />
      {more && (
        <div className="f-scroll-tabs-more" aria-hidden="true">
          <RightChevron />
        </div>
      )}
    </div>
  );
}
