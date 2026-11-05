import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { Tabs, type Tab } from './controls';

const EDGE = 56;
const GUTTER = 4;
const TOLERANCE = 1;

type Direction = 'left' | 'right';

function Chevron() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M9 5 L16 12 L9 19"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function tabStart(row: HTMLElement, tab: HTMLElement) {
  return tab.offsetLeft - row.offsetLeft;
}

function scrollLimit(row: HTMLElement) {
  return Math.max(0, row.scrollWidth - row.clientWidth);
}

function tabButtons(row: HTMLElement) {
  return Array.from(row.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
}

/** Bring the chosen tab and its focus ring clear of the edge controls. */
export function revealTab(row: HTMLElement, tab: HTMLElement, scrollButtons = false) {
  const left = tabStart(row, tab);
  const right = left + tab.offsetWidth;
  if (!scrollButtons) {
    if (left < row.scrollLeft + GUTTER) row.scrollLeft = Math.max(0, left - 8);
    else if (right > row.scrollLeft + row.clientWidth - EDGE) {
      row.scrollLeft = right - row.clientWidth + EDGE;
    }
    return;
  }

  const limit = scrollLimit(row);
  if (limit <= TOLERANCE) return;
  const [first, ...rest] = tabButtons(row);
  if (tab === first) row.scrollLeft = 0;
  else if (tab === rest.at(-1)) row.scrollLeft = limit;
  else {
    const leading = row.scrollLeft > TOLERANCE ? EDGE : GUTTER;
    const trailing = limit - row.scrollLeft > TOLERANCE ? EDGE : GUTTER;
    if (left < row.scrollLeft + leading) row.scrollLeft = Math.max(0, left - EDGE);
    else if (right > row.scrollLeft + row.clientWidth - trailing) {
      row.scrollLeft = Math.min(limit, right - row.clientWidth + EDGE);
    }
  }
}

function scrollStep(row: HTMLElement, direction: Direction) {
  const tabs = tabButtons(row);
  const at = row.scrollLeft;
  const limit = scrollLimit(row);
  const left = direction === 'left';
  const hidden = left
    ? tabs.reverse().find((tab) => tabStart(row, tab) < at + EDGE - TOLERANCE)
    : tabs.find(
        (tab) => tabStart(row, tab) + tab.offsetWidth > at + row.clientWidth - EDGE + TOLERANCE,
      );
  let next = left ? 0 : limit;
  if (hidden) {
    const start = tabStart(row, hidden);
    next = left ? start - EDGE : start + hidden.offsetWidth - row.clientWidth + EDGE;
    // At very narrow widths a tab may be wider than the clear area between the
    // controls. Keep making progress even when the entire label cannot fit.
    if (left ? next >= at - TOLERANCE : next <= at + TOLERANCE) {
      const step = Math.max(1, row.clientWidth - EDGE * 2);
      next = at + (left ? -step : step);
    }
  }
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  row.scrollTo({
    left: Math.max(0, Math.min(limit, next)),
    behavior: reducedMotion ? 'instant' : 'smooth',
  });
}

/** A one-line tab row. Committee opts in to named buttons at both cut edges. */
export function ScrollingTabs<T extends string>({
  scrollButtons = false,
  ...props
}: {
  label: string;
  value: T;
  tabs: ReadonlyArray<Tab<T>>;
  onChange: (value: T) => void;
  scrollButtons?: boolean;
}) {
  const wrapper = useRef<HTMLDivElement>(null);
  const leftButton = useRef<HTMLButtonElement>(null);
  const rightButton = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef<Direction | null>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const row = () => wrapper.current?.querySelector<HTMLElement>('.f-tabs') ?? null;
  const check = useCallback(() => {
    const element = wrapper.current?.querySelector<HTMLElement>('.f-tabs');
    if (!element) return;
    const left = scrollButtons && element.scrollLeft > TOLERANCE;
    const right = scrollLimit(element) - element.scrollLeft > (scrollButtons ? TOLERANCE : GUTTER);
    const active = document.activeElement;
    if (active && active === leftButton.current && !left) restoreFocus.current = 'right';
    if (active && active === rightButton.current && !right) restoreFocus.current = 'left';
    setEdges((current) =>
      left === current.left && right === current.right ? current : { left, right },
    );
  }, [scrollButtons]);

  useLayoutEffect(() => {
    if (!restoreFocus.current) return;
    const next = restoreFocus.current === 'left' ? leftButton.current : rightButton.current;
    restoreFocus.current = null;
    (next ?? row()?.querySelector<HTMLElement>('[aria-selected="true"]'))?.focus({
      preventScroll: true,
    });
  }, [edges]);

  const tabContent = JSON.stringify(
    props.tabs.map(({ value, label, count }) => [value, label, count]),
  );
  useEffect(() => {
    const element = wrapper.current?.querySelector<HTMLElement>('.f-tabs');
    if (!element) return;
    check();
    element.addEventListener('scroll', check, { passive: true });
    const checkLayout = () => {
      const focused = document.activeElement;
      if (
        scrollButtons &&
        focused instanceof HTMLElement &&
        element.contains(focused) &&
        focused.matches('[role="tab"]:focus-visible')
      ) {
        revealTab(element, focused, true);
      }
      check();
    };
    window.addEventListener('resize', checkLayout);
    // A late font load can change the tabs' widths without resizing the row.
    const observer =
      scrollButtons && typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(checkLayout)
        : null;
    observer?.observe(element);
    if (observer) tabButtons(element).forEach((tab) => observer.observe(tab));
    return () => {
      observer?.disconnect();
      element.removeEventListener('scroll', check);
      window.removeEventListener('resize', checkLayout);
    };
  }, [check, scrollButtons, tabContent]);

  useEffect(() => {
    const element = row();
    const selected = element?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (element && selected) revealTab(element, selected, scrollButtons);
    check();
  }, [props.value, tabContent, check, scrollButtons]);

  return (
    <div
      ref={wrapper}
      className="f-scroll-tabs"
      onFocus={(event) => {
        const element = row();
        const target = event.target as HTMLElement;
        // Moving a tab during pointer focus can move it out from under the click.
        if (element && target.getAttribute('role') === 'tab' && target.matches(':focus-visible')) {
          revealTab(element, target, scrollButtons);
          check();
        }
      }}
    >
      {scrollButtons && edges.left && (
        <button
          ref={leftButton}
          type="button"
          aria-label="Scroll tabs left"
          className="f-scroll-tabs-arrow f-scroll-tabs-arrow-left"
          onClick={() => {
            const element = row();
            if (element) scrollStep(element, 'left');
          }}
        >
          <Chevron />
        </button>
      )}
      <Tabs {...props} preventFocusScroll={scrollButtons} />
      {scrollButtons
        ? edges.right && (
            <button
              ref={rightButton}
              type="button"
              aria-label="Scroll tabs right"
              className="f-scroll-tabs-arrow f-scroll-tabs-arrow-right"
              onClick={() => {
                const element = row();
                if (element) scrollStep(element, 'right');
              }}
            >
              <Chevron />
            </button>
          )
        : edges.right && (
            <div className="f-scroll-tabs-more" aria-hidden="true">
              <Chevron />
            </div>
          )}
    </div>
  );
}
