import { describe, expect, it } from 'vitest';

import { getHomeDotVisibility, getPageBackgroundStyle } from '../pageBackground';
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

describe('homepage dot textures', () => {
  // @spec HOME-UI-001, HOME-UI-002, HOME-UI-003
  it.each([
    {
      name: 'phone web',
      isWeb: true,
      isMobile: true,
      expected: { hero: false, finder: true },
    },
    {
      name: 'tablet or desktop web',
      isWeb: true,
      isMobile: false,
      expected: { hero: true, finder: true },
    },
    {
      name: 'native app',
      isWeb: false,
      isMobile: true,
      expected: { hero: false, finder: false },
    },
  ])('sets the intended textures for $name', ({ isWeb, isMobile, expected }) => {
    expect(getHomeDotVisibility(isWeb, isMobile)).toEqual(expected);
  });
});
