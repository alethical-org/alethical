import { useMemo, useState } from 'react';
import { GestureResponderEvent, Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { RepresentativeLookupCoordinates } from '../data/types';
import { theme } from '../theme/tokens';

interface MapPinPickerProps {
  coordinate: RepresentativeLookupCoordinates;
  onCoordinateChange: (coordinate: RepresentativeLookupCoordinates) => void;
}

interface Size {
  width: number;
  height: number;
}

const TILE_SIZE = 256;
const ZOOM = 14;
const TILE_RADIUS = 1;
const DEFAULT_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const tileTemplate = process.env.EXPO_PUBLIC_MAP_TILE_URL || DEFAULT_TILE_URL;

export function MapPinPicker({ coordinate, onCoordinateChange }: MapPinPickerProps) {
  const [size, setSize] = useState<Size>({ width: 1, height: 1 });
  const tileGrid = useMemo(() => buildTileGrid(coordinate, size), [coordinate, size]);

  function handlePress(event: GestureResponderEvent) {
    const { locationX, locationY } = event.nativeEvent;
    onCoordinateChange(screenPointToCoordinate(locationX, locationY, coordinate, size));
  }

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityLabel="Map pin location"
        accessibilityRole="button"
        onLayout={(event) => setSize(event.nativeEvent.layout)}
        onPress={handlePress}
        style={styles.mapSurface}
      >
        {tileGrid.map((tile) => (
          <Image
            key={`${tile.z}-${tile.x}-${tile.y}`}
            source={{ uri: tileUrl(tile.x, tile.y, tile.z) }}
            style={[
              styles.tile,
              {
                left: tile.left,
                top: tile.top,
              },
            ]}
          />
        ))}
        <View pointerEvents="none" style={styles.crosshairHorizontal} />
        <View pointerEvents="none" style={styles.crosshairVertical} />
        <View pointerEvents="none" style={styles.pin} />
      </Pressable>
      <View style={styles.coordinateRow}>
        <Text style={styles.coordinateText}>{coordinate.latitude.toFixed(5)}</Text>
        <Text style={styles.coordinateText}>{coordinate.longitude.toFixed(5)}</Text>
      </View>
    </View>
  );
}

function buildTileGrid(coordinate: RepresentativeLookupCoordinates, size: Size) {
  const center = coordinateToWorldPixel(coordinate, ZOOM);
  const topLeft = {
    x: center.x - size.width / 2,
    y: center.y - size.height / 2,
  };
  const centerTileX = Math.floor(center.x / TILE_SIZE);
  const centerTileY = Math.floor(center.y / TILE_SIZE);
  const tiles = [];

  for (let dx = -TILE_RADIUS; dx <= TILE_RADIUS; dx += 1) {
    for (let dy = -TILE_RADIUS; dy <= TILE_RADIUS; dy += 1) {
      const x = centerTileX + dx;
      const y = centerTileY + dy;
      tiles.push({
        x,
        y,
        z: ZOOM,
        left: x * TILE_SIZE - topLeft.x,
        top: y * TILE_SIZE - topLeft.y,
      });
    }
  }

  return tiles;
}

function screenPointToCoordinate(
  x: number,
  y: number,
  centerCoordinate: RepresentativeLookupCoordinates,
  size: Size
): RepresentativeLookupCoordinates {
  const center = coordinateToWorldPixel(centerCoordinate, ZOOM);
  const worldPoint = {
    x: center.x + x - size.width / 2,
    y: center.y + y - size.height / 2,
  };
  return worldPixelToCoordinate(worldPoint, ZOOM);
}

function coordinateToWorldPixel(coordinate: RepresentativeLookupCoordinates, zoom: number) {
  const scale = TILE_SIZE * 2 ** zoom;
  const latitude = clamp(coordinate.latitude, -85.05112878, 85.05112878);
  const sinLatitude = Math.sin((latitude * Math.PI) / 180);
  return {
    x: ((coordinate.longitude + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sinLatitude) / (1 - sinLatitude)) / (4 * Math.PI)) * scale,
  };
}

function worldPixelToCoordinate(point: { x: number; y: number }, zoom: number): RepresentativeLookupCoordinates {
  const scale = TILE_SIZE * 2 ** zoom;
  const longitude = (point.x / scale) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * point.y) / scale;
  const latitude = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return {
    latitude: clamp(latitude, -90, 90),
    longitude: clamp(longitude, -180, 180),
  };
}

function tileUrl(x: number, y: number, z: number) {
  const max = 2 ** z;
  const wrappedX = ((x % max) + max) % max;
  return tileTemplate
    .replace('{z}', String(z))
    .replace('{x}', String(wrappedX))
    .replace('{y}', String(y));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

const styles = StyleSheet.create({
  container: {
    gap: theme.spacing.sm,
  },
  mapSurface: {
    position: 'relative',
    minHeight: 260,
    overflow: 'hidden',
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceAlt,
  },
  tile: {
    position: 'absolute',
    width: TILE_SIZE,
    height: TILE_SIZE,
  },
  crosshairHorizontal: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '50%',
    height: 1,
    backgroundColor: 'rgba(17, 17, 17, 0.22)',
  },
  crosshairVertical: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: '50%',
    width: 1,
    backgroundColor: 'rgba(17, 17, 17, 0.22)',
  },
  pin: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: 24,
    height: 24,
    marginLeft: -12,
    marginTop: -12,
    borderRadius: 12,
    borderWidth: 4,
    borderColor: theme.colors.surface,
    backgroundColor: theme.colors.accent,
  },
  coordinateRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  coordinateText: {
    color: theme.colors.mutedInk,
    fontFamily: theme.typography.mono,
    fontSize: 12,
  },
});
