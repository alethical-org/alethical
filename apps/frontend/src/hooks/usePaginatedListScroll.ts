import { useCallback, useId, useRef } from 'react';
import { Platform } from 'react-native';

import { useResponsive } from './useResponsive';
import { useReducedMotion } from './useReducedMotion';

// When a paginated list changes page, the reader is parked at the bottom next to
// the Prev/Next row, staring at swapped-in-place results with no signal anything
// moved. This hook lands the first result at the top of the viewport instead:
// smooth-scroll the list into view (the motion is the signal), move keyboard
// focus to the list, and leave a small gap above so the first card isn't clipped.
//
// Build-once: any paged list gets the behavior by spreading `listAnchorProps` on
// its results container and passing `onPageChange` to the shared Pagination
// control, which fires it after Prev/Next (never on filter/sort/keystroke — the
// reader is already at the top of the list for those).
//
// The gap above the list: ~20px on web, ~12px on the narrow mobile-web layout.
const WEB_OFFSET = 20;
const MOBILE_OFFSET = 12;
const SCROLL_DURATION_MS = 320;

// Walk up from the list to the real scrolling element. The Search screens scroll
// inside a nested react-native-web ScrollView (a div with overflow), not the
// window, so we must move that div — window scrolling would do nothing. Falls
// back to the document scroller for any page that scrolls the window instead.
function findScrollParent(node: HTMLElement): HTMLElement {
  let el: HTMLElement | null = node.parentElement;
  while (el && el !== document.body) {
    const overflowY = getComputedStyle(el).overflowY;
    if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight) {
      return el;
    }
    el = el.parentElement;
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

// The scroll position that puts the list's top edge `offset` px below the
// scroller's top. `listTop`/`scrollerTop` are viewport-relative (getBoundingClientRect
// tops); adding the current scrollTop converts to an absolute target. Clamp at 0 so a
// list already at/above the top doesn't lurch backward past the start of the page.
export function computeScrollTarget(
  scrollTop: number,
  listTop: number,
  scrollerTop: number,
  offset: number,
): number {
  return Math.max(0, scrollTop + (listTop - scrollerTop) - offset);
}

// react-native-web's ScrollView div ignores Element.scrollTo() entirely (verified
// live), so behavior:'smooth' never fires there. Assigning scrollTop is the one
// primitive that moves it, so animate that by hand — reliable everywhere, and it
// leaves the element's scroll-behavior untouched so ordinary wheel/keyboard
// scrolling still feels the same.
function animateScrollTop(el: HTMLElement, target: number, cancelRef: { id: number }) {
  cancelAnimationFrame(cancelRef.id);
  const start = el.scrollTop;
  const distance = target - start;
  if (distance === 0) {
    return;
  }
  const startedAt = performance.now();
  const tick = (now: number) => {
    const progress = Math.min(1, (now - startedAt) / SCROLL_DURATION_MS);
    // easeOutCubic: quick off the mark, gentle landing.
    const eased = 1 - Math.pow(1 - progress, 3);
    el.scrollTop = start + distance * eased;
    if (progress < 1) {
      cancelRef.id = requestAnimationFrame(tick);
    }
  };
  cancelRef.id = requestAnimationFrame(tick);
}

export function usePaginatedListScroll() {
  const { isMobile } = useResponsive();
  const reducedMotion = useReducedMotion();
  const rafRef = useRef({ id: 0 });
  // A stable DOM id for this list instance (two lists on one screen each get
  // their own). getElementById tolerates any string, but strip the framework's
  // separators so the id stays readable.
  const nativeID = `paged-list-${useId().replace(/[^a-z0-9]/gi, '')}`;

  const onPageChange = useCallback(() => {
    // Web-only: the shipping target is web (desktop + mobile-web). Native has no
    // equivalent DOM scroller here; guarding keeps the hook a no-op there.
    if (Platform.OS !== 'web' || typeof document === 'undefined') {
      return;
    }
    const el = document.getElementById(nativeID);
    if (!el) {
      return;
    }
    const offset = isMobile ? MOBILE_OFFSET : WEB_OFFSET;
    const scroller = findScrollParent(el);
    const target = computeScrollTarget(
      scroller.scrollTop,
      el.getBoundingClientRect().top,
      scroller.getBoundingClientRect().top,
      offset,
    );

    // Motion is the signal that the page changed; honor prefers-reduced-motion by
    // jumping instantly, but still move focus below.
    if (reducedMotion) {
      scroller.scrollTop = target;
    } else {
      animateScrollTop(scroller, target, rafRef.current);
    }

    // Move keyboard focus onto the list so the next Tab walks into the new
    // results instead of the footer. tabindex="-1" makes it programmatically
    // focusable only; suppress the ring since it's a scroll target, not a control.
    el.setAttribute('tabindex', '-1');
    el.style.outline = 'none';
    el.focus({ preventScroll: true });
  }, [nativeID, isMobile, reducedMotion]);

  return { listAnchorProps: { nativeID }, onPageChange };
}
