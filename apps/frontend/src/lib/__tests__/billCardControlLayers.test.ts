import { describe, expect, it } from 'vitest';

import { CARD_CONTENT_LAYER, CARD_CONTROL_LAYER, CARD_LINK_LAYER } from '../billCardControlLayers';

describe('controls inside a whole-card link', () => {
  it('keeps the full-card link below the card content', () => {
    expect(CARD_LINK_LAYER).toMatchObject({ position: 'absolute', zIndex: 1 });
    expect(CARD_CONTENT_LAYER).toMatchObject({ position: 'relative', zIndex: 2 });
  });

  it('lets ordinary card content pass clicks through while controls remain clickable', () => {
    expect(CARD_CONTENT_LAYER.pointerEvents).toBe('none');
    expect(CARD_CONTROL_LAYER).toMatchObject({
      position: 'relative',
      zIndex: 3,
      pointerEvents: 'auto',
    });
  });
});
