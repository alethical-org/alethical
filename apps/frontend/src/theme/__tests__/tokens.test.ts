import { describe, expect, it } from 'vitest';

import { theme } from '../tokens';

describe('green text and green graphics use different roles', () => {
  it('uses the AA green for text while leaving the brighter graphic green available', () => {
    expect(theme.colors.text.green).toBe('#0f7a45');
    expect(theme.colors.brand.graphics).toBe('#149d5b');
  });
});
