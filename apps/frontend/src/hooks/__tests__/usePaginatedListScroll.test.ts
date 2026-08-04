import { describe, expect, it } from 'vitest';

import { computeScrollTarget } from '../usePaginatedListScroll';

// The scroll math behind the pagination "land the first result at the top"
// behavior (usePaginatedListScroll). The DOM/scroll wiring is verified live;
// this pins the two things a test can own: the offset and the clamp-at-0.
describe('computeScrollTarget', () => {
  // Reader is scrolled down (scrollTop 1000) and the anchor's top (the results
  // header) sits 900px below the scroller's top. Landing it `offset` (20) below
  // the top means scrolling to 1000 + 900 - 20 = 1880.
  it('lands the anchor top `offset` px below the scroller top', () => {
    expect(computeScrollTarget(1000, 1000, 100, 20)).toBe(1880);
  });

  it('uses the mobile offset when given 12', () => {
    expect(computeScrollTarget(1000, 1000, 100, 12)).toBe(1888);
  });

  // Anchor already at/above the viewport top: the naive target goes negative, so
  // the clamp keeps it at the start of the page instead of lurching backward.
  it('clamps at 0 when the anchor is already at/above the top', () => {
    expect(computeScrollTarget(5, 100, 100, 20)).toBe(0);
    expect(computeScrollTarget(0, -500, 100, 20)).toBe(0);
  });

  // Anchor top is exactly `offset` below the scroller top already: no movement.
  it('does not move when the anchor is already at the target', () => {
    expect(computeScrollTarget(300, 120, 100, 20)).toBe(300);
  });
});
