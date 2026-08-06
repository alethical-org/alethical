import type { RepresentativeLookupCoordinates } from '../data/types';

const TILE_SIZE = 256;

export function arrowMovedCoordinate(
  coordinate: RepresentativeLookupCoordinates,
  key: string,
  shifted: boolean,
): RepresentativeLookupCoordinates {
  const step = shifted ? 0.005 : 0.001;
  return {
    latitude: coordinate.latitude + (key === 'ArrowUp' ? step : key === 'ArrowDown' ? -step : 0),
    longitude:
      coordinate.longitude + (key === 'ArrowRight' ? step : key === 'ArrowLeft' ? -step : 0),
  };
}

function longitudeToTileX(longitude: number, zoom: number) {
  return ((longitude + 180) / 360) * 2 ** zoom;
}

function latitudeToTileY(latitude: number, zoom: number) {
  const radians = (latitude * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2) * 2 ** zoom;
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
