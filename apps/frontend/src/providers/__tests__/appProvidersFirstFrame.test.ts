// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { initialWebWindowMetrics } from '../../lib/initialWindowMetrics';

/**
 * The safe-area provider draws nothing until it knows the window's insets. Given
 * nothing to start from, its first draw was an empty full-height box, and every
 * screen waited a frame for the measurement: a blank white paint about 40 ms long
 * between the server's text and the app, on every address (measured live 17 Sep
 * 2026). On the web the insets are known to be 0 before anything draws.
 */
describe('the app tells the safe-area provider what a browser window looks like', () => {
  it('starts with zero insets and the document’s own size, so the first draw is not empty', () => {
    const metrics = initialWebWindowMetrics();
    expect(metrics?.insets).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    expect(metrics?.frame).toEqual({
      x: 0,
      y: 0,
      width: document.documentElement.offsetWidth,
      height: document.documentElement.offsetHeight,
    });
  });
});
