import { useEffect, useState } from 'react';

/** Keep a title’s exact characters while treating each 4-digit year range as 1 word. */
export function ArticleTitleText({ title }: { title: string }) {
  return title.split(/(\b\d{4}–\d{4}\b)/u).map((part, index) =>
    /^\d{4}–\d{4}$/u.test(part) ? (
      <span key={index} style={{ whiteSpace: 'nowrap' }}>
        {part}
      </span>
    ) : (
      part
    ),
  );
}

/** A title adds a keyboard stop only while its unbroken content needs local scrolling. */
export function useArticleTitleOverflow(title: string) {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [overflowing, setOverflowing] = useState(false);
  useEffect(() => {
    if (!node) return;
    let active = true;
    const update = () => {
      if (active) setOverflowing(node.scrollWidth > node.clientWidth);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    // Loaded fonts can change the year range’s width without changing the heading’s box.
    void node.ownerDocument.fonts?.ready.then(update);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [node, title]);
  return { ref: setNode, tabIndex: overflowing ? 0 : undefined };
}
