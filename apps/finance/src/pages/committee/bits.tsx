import { useCallback, useEffect, useRef, useState } from 'react';

import { Tabs, type Tab } from '../../ui/controls';

export function Spinner() {
  return <span className="f-spinner" aria-hidden="true" />;
}

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

/**
 * The shared tab row, wrapping at computer and scrolling at tablet and phone with a
 * right-edge fade and chevron while more tabs lie to the right (build notes
 * Round 21). The cue is drawn over the row and never takes a press.
 */
export function ScrollingTabs<T extends string>(props: {
  label: string;
  value: T;
  tabs: ReadonlyArray<Tab<T>>;
  onChange: (value: T) => void;
}) {
  const wrapper = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  const check = useCallback(() => {
    const row = wrapper.current?.querySelector<HTMLElement>('.f-tabs');
    setMore(!!row && row.scrollWidth - row.clientWidth - row.scrollLeft > 4);
  }, []);
  useEffect(() => {
    const row = wrapper.current?.querySelector<HTMLElement>('.f-tabs');
    check();
    row?.addEventListener('scroll', check, { passive: true });
    window.addEventListener('resize', check);
    return () => {
      row?.removeEventListener('scroll', check);
      window.removeEventListener('resize', check);
    };
  }, [check]);
  useEffect(check);
  return (
    <div ref={wrapper} className="cmt-tabs">
      <Tabs {...props} />
      {more && (
        <div className="cmt-tabs-more" aria-hidden="true">
          <RightChevron />
        </div>
      )}
    </div>
  );
}
