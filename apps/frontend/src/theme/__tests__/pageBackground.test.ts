import { describe, expect, it } from 'vitest';

import { getPageBackgroundStyle } from '../pageBackground';
import { theme } from '../tokens';

describe('page background', () => {
  it('removes the decorative background image at phone widths', () => {
    expect(getPageBackgroundStyle(true)).toEqual({
      backgroundColor: theme.colors.surfaces.s200,
    });
  });

  it('keeps wider page backgrounds neutral', () => {
    expect(theme.gradients.page).toBe(
      'linear-gradient(180deg,#f4f5f7 0%,#f7f8fa 60%,#fdfdfe 92%,#ffffff 100%)',
    );
    expect(getPageBackgroundStyle(false)).toEqual({
      backgroundColor: theme.colors.surfaces.s200,
      backgroundImage: theme.gradients.page,
    });
  });
});
