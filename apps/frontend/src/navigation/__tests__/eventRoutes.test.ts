import { describe, expect, it } from 'vitest';
import { eventPath, PUBLISHED_EVENTS } from '../../lib/events';
import { screenNameForPath } from '../screenPreload';
import { pathForRoute, stateFromPathname, targetFromPathname } from '../webRoutes';

describe('event addresses', () => {
  it('round trips collection and announcement links through browser navigation', () => {
    for (const path of ['/blog/events', eventPath(PUBLISHED_EVENTS[0])]) {
      const state = stateFromPathname(path);
      const route = state.routes[state.index ?? 0];
      expect(pathForRoute(route as Parameters<typeof pathForRoute>[0])).toBe(path);
      expect(screenNameForPath(path)).toBe(path === '/blog/events' ? 'Events' : 'Event');
    }
  });
  it.each(['/blog/events/unknown', '/blog/events/forward-debate-2026/extra'])(
    'does not make an unknown event look like a real page: %s',
    (path) => {
      expect(targetFromPathname(path)).toEqual({ kind: 'notFound', path });
    },
  );
});
