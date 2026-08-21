import { describe, expect, it } from 'vitest';

import { theme } from '../tokens';

describe('green text and green graphics use different roles', () => {
  it('uses the AA green for text while leaving the brighter graphic green available', () => {
    expect(theme.colors.text.green).toBe('#0f7a45');
    expect(theme.colors.brand.graphics).toBe('#149d5b');
  });
});

describe('cyan surfaces use separate steps for white and grey pages', () => {
  it('keeps the lighter About surface and provides a stronger report surface', () => {
    expect(theme.colors.cyan).toEqual({
      surface: '#f4fafc',
      surfaceStrong: '#e9f4f9',
      border: '#dbeef4',
      borderStrong: '#cbe4ee',
      ink: '#2b6377',
    });
  });
});
