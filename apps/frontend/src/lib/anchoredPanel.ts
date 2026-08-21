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
export const PANEL_GAP = 12;

/** Smallest gap the panel keeps to any edge of the window. */
export const PANEL_EDGE_MARGIN = 12;

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

  // Below the control by default. If the whole panel would not fit there, flip
  // above it; if it does not fit above either (a short window with the control
  // in the middle), sit as low as the window allows and, failing even that,
  // start at the top margin so the panel's first rows are the ones on screen.
  const lowestTop = viewport.height - margin - panel.height;
  const below = anchor.bottom + gap;
  const above = anchor.top - gap - panel.height;
  const top = below <= lowestTop ? below : above >= margin ? above : Math.max(margin, lowestTop);

  return { left, top };
}
