import { describe, expect, it } from 'vitest';

import { arrowMovedCoordinate, visibleTileKeys } from '../districtMap';

describe('district map movement and tile loading', () => {
  it('moves the selected point by a small step and a larger Shift step', () => {
    const start = { latitude: 44.98, longitude: -93.27 };
    const small = arrowMovedCoordinate(start, 'ArrowRight', false);
    const large = arrowMovedCoordinate(start, 'ArrowRight', true);

    expect(small.latitude).toBe(start.latitude);
    expect(large.longitude - start.longitude).toBeGreaterThan(small.longitude - start.longitude);
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
