import { describe, expect, it } from 'vitest';

import {
  arrowMovedCoordinate,
  pinchZoomLevel,
  visibleTileKeys,
  zoomedMapViewport,
} from '../districtMap';

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

  it('turns a 2-finger pinch into bounded whole map zoom levels', () => {
    expect(pinchZoomLevel(6, 100, 205, 5, 15)).toBe(7);
    expect(pinchZoomLevel(6, 100, 49, 5, 15)).toBe(5);
    expect(pinchZoomLevel(14, 100, 1000, 5, 15)).toBe(15);
  });

  it('keeps the point under a pinch or trackpad gesture in place while zooming', () => {
    const center = { latitude: 44.98, longitude: -93.27 };
    const size = { width: 600, height: 400 };
    const centered = zoomedMapViewport(center, 6, 7, size, { x: 300, y: 200 });
    const rightSide = zoomedMapViewport(center, 6, 7, size, { x: 450, y: 200 });

    expect(centered.center.latitude).toBeCloseTo(center.latitude, 10);
    expect(centered.center.longitude).toBeCloseTo(center.longitude, 10);
    expect(rightSide.center.longitude).toBeGreaterThan(center.longitude);
  });
});
