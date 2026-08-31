import { describe, expect, it } from 'vitest';

import { PANEL_EDGE_MARGIN, PANEL_GAP, placeAnchoredPanel } from '../anchoredPanel';

// A Share control sitting comfortably in the middle of a roomy window.
const control = { top: 300, right: 900, bottom: 345, left: 790 };
const panel = { width: 366, height: 320 };
const window = { width: 1440, height: 900 };

describe('placing the Share panel in the window', () => {
  it('hangs the panel under the control, right edges lined up', () => {
    expect(placeAnchoredPanel({ anchor: control, panel, viewport: window })).toEqual({
      left: control.right - panel.width,
      top: control.bottom + PANEL_GAP,
    });
  });

  it('slides the panel in when the control sits against the right edge', () => {
    const atRightEdge = { ...control, left: 1425, right: 1438 };
    const { left } = placeAnchoredPanel({ anchor: atRightEdge, panel, viewport: window });
    expect(left + panel.width).toBe(window.width - PANEL_EDGE_MARGIN);
  });

  it('slides the panel in when the control sits against the left edge', () => {
    const atLeftEdge = { ...control, left: 2, right: 112 };
    const { left } = placeAnchoredPanel({ anchor: atLeftEdge, panel, viewport: window });
    expect(left).toBe(PANEL_EDGE_MARGIN);
  });

  // The exact case measured on the live report page before this fix: a 620px-tall
  // window, where the panel used to run 106px below the bottom of the window.
  it('flips the panel above the control when a short window has no room below', () => {
    const shortWindow = { width: 1200, height: 620 };
    const lowControl = { top: 349, right: 1098, bottom: 394.5, left: 987 };
    const { top } = placeAnchoredPanel({ anchor: lowControl, panel, viewport: shortWindow });
    expect(top).toBe(lowControl.top - PANEL_GAP - panel.height);
    expect(top).toBeGreaterThanOrEqual(PANEL_EDGE_MARGIN);
    expect(top + panel.height).toBeLessThanOrEqual(shortWindow.height - PANEL_EDGE_MARGIN);
  });

  it('keeps the whole panel on screen when it fits neither below nor above', () => {
    const shortWindow = { width: 1440, height: 500 };
    const midControl = { top: 200, right: 900, bottom: 245, left: 790 };
    const { top } = placeAnchoredPanel({ anchor: midControl, panel, viewport: shortWindow });
    expect(top).toBeGreaterThanOrEqual(PANEL_EDGE_MARGIN);
    expect(top + panel.height).toBeLessThanOrEqual(shortWindow.height - PANEL_EDGE_MARGIN);
  });

  it('shows the top of the panel when the window is shorter than the panel itself', () => {
    const tinyWindow = { width: 1440, height: 260 };
    const { top } = placeAnchoredPanel({ anchor: control, panel, viewport: tinyWindow });
    expect(top).toBe(PANEL_EDGE_MARGIN);
  });

  it('never starts the panel off the left edge, even in a window narrower than it', () => {
    const narrowWindow = { width: 320, height: 900 };
    const { left } = placeAnchoredPanel({ anchor: control, panel, viewport: narrowWindow });
    expect(left).toBe(PANEL_EDGE_MARGIN);
  });
});
