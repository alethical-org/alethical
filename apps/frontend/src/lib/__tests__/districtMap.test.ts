import { describe, expect, it } from 'vitest';

import { arrowMovedCoordinate, visibleTileKeys } from '../districtMap';

describe('district map movement and tile loading', () => {
  it('moves the selected point by a screen-sized step that shrinks as zoom increases', () => {
    const start = { latitude: 44.98, longitude: -93.27 };
    const atWideZoom = arrowMovedCoordinate(start, 'ArrowRight', false, 6);
    const atCloseZoom = arrowMovedCoordinate(start, 'ArrowRight', false, 12);
    const shifted = arrowMovedCoordinate(start, 'ArrowRight', true, 12);

    expect(atWideZoom.latitude).toBeCloseTo(start.latitude, 10);
    expect(atWideZoom.longitude - start.longitude).toBeGreaterThan(
      atCloseZoom.longitude - start.longitude,
    );
    expect(shifted.longitude - start.longitude).toBeGreaterThan(
      atCloseZoom.longitude - start.longitude,
    );
  });

  it('loads only the visible viewport plus a 1-tile margin', () => {
    const keys = visibleTileKeys(
      { latitude: 44.98, longitude: -93.27 },
      { width: 600, height: 400 },
      12,
    );
    expect(keys.length).toBeLessThanOrEqual(30);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
