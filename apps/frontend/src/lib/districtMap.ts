import type { RepresentativeLookupCoordinates } from '../data/types';

const TILE_SIZE = 256;

export function arrowMovedCoordinate(
  coordinate: RepresentativeLookupCoordinates,
  key: string,
  shifted: boolean,
  zoom: number,
): RepresentativeLookupCoordinates {
  const point = {
    x: TILE_SIZE * longitudeToTileX(coordinate.longitude, zoom),
    y: TILE_SIZE * latitudeToTileY(coordinate.latitude, zoom),
  };
  const step = shifted ? 48 : 16;
  return coordinateAtWorldPoint(
    {
      x: point.x + (key === 'ArrowRight' ? step : key === 'ArrowLeft' ? -step : 0),
      y: point.y + (key === 'ArrowDown' ? step : key === 'ArrowUp' ? -step : 0),
    },
    zoom,
  );
}

function longitudeToTileX(longitude: number, zoom: number) {
  return ((longitude + 180) / 360) * 2 ** zoom;
}

function latitudeToTileY(latitude: number, zoom: number) {
  const radians = (latitude * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2) * 2 ** zoom;
}

function coordinateAtWorldPoint(point: { x: number; y: number }, zoom: number) {
  const scale = TILE_SIZE * 2 ** zoom;
  const longitude = (point.x / scale) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * point.y) / scale;
  return { latitude: (180 / Math.PI) * Math.atan(Math.sinh(n)), longitude };
}

function worldPoint(coordinate: RepresentativeLookupCoordinates, zoom: number) {
  return {
    x: TILE_SIZE * longitudeToTileX(coordinate.longitude, zoom),
    y: TILE_SIZE * latitudeToTileY(coordinate.latitude, zoom),
  };
}

export function pinchZoomLevel(
  startZoom: number,
  startDistance: number,
  currentDistance: number,
  minZoom: number,
  maxZoom: number,
) {
  if (startDistance <= 0 || currentDistance <= 0) return startZoom;
  return Math.min(
    maxZoom,
    Math.max(minZoom, Math.round(startZoom + Math.log2(currentDistance / startDistance))),
  );
}

export function zoomedMapViewport(
  center: RepresentativeLookupCoordinates,
  zoom: number,
  nextZoom: number,
  viewport: { width: number; height: number },
  anchor: { x: number; y: number },
  nextAnchor = anchor,
) {
  const origin = worldPoint(center, zoom);
  const anchorCoordinate = coordinateAtWorldPoint(
    {
      x: origin.x + anchor.x - viewport.width / 2,
      y: origin.y + anchor.y - viewport.height / 2,
    },
    zoom,
  );
  const nextAnchorPoint = worldPoint(anchorCoordinate, nextZoom);
  return {
    center: coordinateAtWorldPoint(
      {
        x: nextAnchorPoint.x - nextAnchor.x + viewport.width / 2,
        y: nextAnchorPoint.y - nextAnchor.y + viewport.height / 2,
      },
      nextZoom,
    ),
    zoom: nextZoom,
  };
}

export function visibleTileKeys(
  center: RepresentativeLookupCoordinates,
  viewport: { width: number; height: number },
  zoom: number,
): string[] {
  const centerX = longitudeToTileX(center.longitude, zoom);
  const centerY = latitudeToTileY(center.latitude, zoom);
  const columns = Math.ceil(viewport.width / TILE_SIZE) + 2;
  const rows = Math.ceil(viewport.height / TILE_SIZE) + 2;
  const count = 2 ** zoom;
  const keys: string[] = [];
  const firstY = Math.floor(centerY - rows / 2);
  const firstX = Math.floor(centerX - columns / 2);
  for (let y = firstY; y < firstY + rows; y += 1) {
    if (y < 0 || y >= count) continue;
    for (let x = firstX; x < firstX + columns; x += 1) {
      const wrappedX = ((x % count) + count) % count;
      keys.push(`${zoom}/${wrappedX}/${y}`);
    }
  }
  return [...new Set(keys)];
}
