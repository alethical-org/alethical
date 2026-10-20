// Where the Share panel sits once it is painted in the page's own top layer.
//
// The arithmetic lives here, away from the component, because it is the part
// with real edge cases: a window too short for the panel below the control, a
// control near the right edge, a window narrower than the panel itself. A pure
// function is testable without a browser, so those cases are pinned by
// lib/__tests__/anchoredPanel.test.ts rather than found by a reader.
//
// Every number is in viewport coordinates. The panel is rendered inside a
// react-native Modal, whose web output is a portal into document.body holding a
// fixed, full-window layer, so "viewport" and "the layer the panel sits in" are
// the same box.

export type AnchorRect = { top: number; right: number; bottom: number; left: number };

/** Distance between the Share control and the panel below or above it. */
export const PANEL_GAP = 10;

/** Smallest gap the panel keeps to any edge of the window. */
export const PANEL_EDGE_MARGIN = 16;

export function placeAnchoredPanel({
  anchor,
  panel,
  viewport,
  gap = PANEL_GAP,
  margin = PANEL_EDGE_MARGIN,
}: {
  anchor: AnchorRect;
  panel: { width: number; height: number };
  viewport: { width: number; height: number };
  gap?: number;
  margin?: number;
}): { left: number; top: number } {
  // The panel's right edge lines up with the control's right edge, then slides
  // inwards if that would push it past either side of the window. Math.max wins
  // the tie, so a panel wider than the window overhangs on the right rather than
  // starting off-screen on the left, where its first words would be unreadable.
  const left = Math.max(
    margin,
    Math.min(anchor.right - panel.width, viewport.width - margin - panel.width),
  );

  // Prefer below, then above, then beside the trigger. In a short window,
  // keep the panel to one side so its scrolling body never covers the trigger.
  const lowestTop = viewport.height - margin - panel.height;
  const below = anchor.bottom + gap;
  const above = anchor.top - gap - panel.height;
  if (below <= lowestTop) return { left, top: below };
  if (above >= margin) return { left, top: above };
  const sideTop = Math.max(margin, Math.min(anchor.top, lowestTop));
  const besideLeft = anchor.left - gap - panel.width;
  if (besideLeft >= margin) return { left: besideLeft, top: sideTop };
  const besideRight = anchor.right + gap;
  if (besideRight + panel.width <= viewport.width - margin)
    return { left: besideRight, top: sideTop };
  return { left, top: Math.max(margin, lowestTop) };
}
