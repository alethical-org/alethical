import { describe, expect, it } from 'vitest';

import { ROUTES, matchRoute, safeReturnPath } from '../routes';

describe('matchRoute', () => {
  it('matches every pattern to its own route', () => {
    for (const route of ROUTES) {
      const path = route.pattern.replace(/:[a-z]+/g, 'example-1');
      expect(matchRoute(path)?.route.name).toBe(route.name);
    }
  });

  it('reads parameters, decoded, and ignores a trailing slash', () => {
    expect(matchRoute('/money/names/EXAMPLE%20MEDIA%20LLC/')).toEqual({
      route: expect.objectContaining({ name: 'payments-under-name' }),
      params: { query: 'EXAMPLE MEDIA LLC' },
    });
  });

  it('does not let a shorter address claim a longer one', () => {
    expect(matchRoute('/money/recipients')?.route.name).toBe('recipients');
    expect(matchRoute('/money/committees')).toBeNull();
    expect(matchRoute('/money/committees/1/extra')).toBeNull();
  });

  it('has no address for pages Finance does not have', () => {
    expect(matchRoute('/admin/political-ads')).toBeNull();
    expect(matchRoute('/ads')).toBeNull();
    expect(matchRoute('/money/names/%E0%A4%A')).toBeNull();
  });
});

describe('safeReturnPath', () => {
  it('keeps a built Finance address with its query', () => {
    expect(safeReturnPath('/home?q=hortman', true)).toBe('/home?q=hortman');
    expect(safeReturnPath('/money/committees/12?year=2026', true)).toBe(
      '/money/committees/12?year=2026',
    );
  });

  it('returns to the landing page while the signed-in screens are off', () => {
    expect(safeReturnPath('/home?q=hortman', false)).toBe('/');
  });

  it.each([
    null,
    '',
    'https://example.com/',
    '//example.com/money',
    '/\\example.com',
    '/sign-in',
    '/auth/return?source=google',
    '/not-a-page',
    '/',
    '/media-buys',
  ])('sends %s to Finance Home instead', (value) => {
    expect(safeReturnPath(value, true)).toBe('/home');
  });
});
