import { describe, expect, it } from 'vitest';

import { getPageBackgroundStyle } from '../pageBackground';
import { theme } from '../tokens';

describe('page background', () => {
  it('removes the decorative background image at phone widths', () => {
    expect(getPageBackgroundStyle(true, 'page')).toEqual({
      backgroundColor: theme.colors.surfaces.s200,
    });
  });

  it('keeps the decorative background image above phone widths', () => {
    expect(getPageBackgroundStyle(false, 'page')).toEqual({
      backgroundColor: theme.colors.surfaces.s200,
      backgroundImage: theme.gradients.page,
    });
  });
});
