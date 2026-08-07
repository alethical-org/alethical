// Shared layer order for a bill card whose full surface is one real link.
//
// React Native Web gives each View its own zero-level stack. A control can say
// zIndex: 3 and still sit under the card's zIndex: 1 link when one of its parent
// Views is left at zero. The content layer therefore sits above the link, lets
// ordinary clicks pass through, and turns pointer handling back on only for real
// controls.

export const CARD_LINK_LAYER = {
  position: 'absolute',
  zIndex: 1,
} as const;

export const CARD_CONTENT_LAYER = {
  position: 'relative',
  zIndex: 2,
  pointerEvents: 'none',
} as const;

export const CARD_CONTROL_LAYER = {
  position: 'relative',
  zIndex: 3,
  pointerEvents: 'auto',
} as const;
