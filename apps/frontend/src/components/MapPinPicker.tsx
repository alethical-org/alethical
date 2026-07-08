import { useEffect, useMemo, useRef, useState } from 'react';
import {
  GestureResponderEvent,
  Image,
  Linking,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Polygon, Polyline } from 'react-native-svg';

import { MINNESOTA_BOUNDARY, isCoordinateInMinnesota } from '../data/minnesotaBoundary';
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
const DEFAULT_ZOOM = 14;
const MIN_ZOOM = 10;
const MAX_ZOOM = 18;
const TILE_RADIUS = 2;
const DRAG_THRESHOLD = 4;
const OPENSTREETMAP_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const OPENSTREETMAP_COPYRIGHT_URL = 'https://www.openstreetmap.org/copyright';
const MAP_TILE_USER_AGENT =
  process.env.EXPO_PUBLIC_MAP_TILE_USER_AGENT ||
  'Alethical/0.1 (+https://alethical-web.vercel.app)';
const tileTemplate =
  process.env.EXPO_PUBLIC_OPENSTREETMAP_TILE_URL ||
  process.env.EXPO_PUBLIC_MAP_TILE_URL ||
  OPENSTREETMAP_TILE_URL;
const webMapSurfaceStyle = {
  cursor: 'grab',
  touchAction: 'none',
} as any;
const DEFAULT_COORDINATE = {
  latitude: 44.97683,
  longitude: -93.26579,
};

export function MapPinPicker({ coordinate, onCoordinateChange }: MapPinPickerProps) {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const safeCoordinate = isValidCoordinate(coordinate) ? coordinate : DEFAULT_COORDINATE;
  const tileGrid = useMemo(
    () => buildTileGrid(safeCoordinate, size, zoom),
    [safeCoordinate, size, zoom],
  );
  const boundaryPoints = useMemo(
    () => buildBoundaryPoints(safeCoordinate, size, zoom),
    [safeCoordinate, size, zoom],
  );
  const isInMinnesota = isCoordinateInMinnesota(safeCoordinate);
  const dragStartCoordinateRef = useRef<RepresentativeLookupCoordinates>(safeCoordinate);
  const pointerDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    coordinate: RepresentativeLookupCoordinates;
    moved: boolean;
  } | null>(null);
  const suppressNextPressRef = useRef(false);

  useEffect(() => {
    if (!isValidCoordinate(coordinate)) {
      onCoordinateChange(DEFAULT_COORDINATE);
    }
  }, [coordinate, onCoordinateChange]);

  function handlePress(event: GestureResponderEvent) {
    if (suppressNextPressRef.current) {
      suppressNextPressRef.current = false;
      return;
    }

    const pressLocation = pressLocationFromEvent(event);
    if (!isValidSize(size)) {
      return;
    }
    if (!pressLocation) {
      return;
    }

    const nextCoordinate = screenPointToCoordinate(
      pressLocation.x,
      pressLocation.y,
      safeCoordinate,
      size,
      zoom,
    );
    if (isValidCoordinate(nextCoordinate)) {
      onCoordinateChange(nextCoordinate);
    }
  }

  function handleZoomStep(delta: number) {
    const nextZoom = clamp(zoom + delta, MIN_ZOOM, MAX_ZOOM);
    if (nextZoom === zoom || !isValidSize(size)) {
      return;
    }

    setZoom(nextZoom);
    const nextCoordinate = zoomAroundScreenPoint(
      size.width / 2,
      size.height / 2,
      safeCoordinate,
      size,
      zoom,
      nextZoom,
    );
    if (isValidCoordinate(nextCoordinate)) {
      onCoordinateChange(nextCoordinate);
    }
  }

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gestureState) =>
          Math.abs(gestureState.dx) > DRAG_THRESHOLD || Math.abs(gestureState.dy) > DRAG_THRESHOLD,
        onPanResponderGrant: () => {
          dragStartCoordinateRef.current = safeCoordinate;
        },
        onPanResponderMove: (_event, gestureState) => {
          if (!isValidSize(size)) {
            return;
          }

          const nextCoordinate = dragOffsetToCoordinate(
            gestureState.dx,
            gestureState.dy,
            dragStartCoordinateRef.current,
            zoom,
          );
          if (isValidCoordinate(nextCoordinate)) {
            onCoordinateChange(nextCoordinate);
          }
        },
      }),
    [onCoordinateChange, safeCoordinate, size, zoom],
  );

  const webGestureHandlers =
    Platform.OS === 'web'
      ? ({
          onPointerDown: (event: any) => {
            if (event.button != null && event.button !== 0) {
              return;
            }
            pointerDragRef.current = {
              pointerId: event.pointerId,
              startX: event.clientX,
              startY: event.clientY,
              coordinate: safeCoordinate,
              moved: false,
            };
            event.currentTarget?.setPointerCapture?.(event.pointerId);
          },
          onPointerMove: (event: any) => {
            const drag = pointerDragRef.current;
            if (!drag || drag.pointerId !== event.pointerId) {
              return;
            }

            const dx = event.clientX - drag.startX;
            const dy = event.clientY - drag.startY;
            if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
              drag.moved = true;
            }

            if (!drag.moved) {
              return;
            }

            event.preventDefault?.();
            const nextCoordinate = dragOffsetToCoordinate(dx, dy, drag.coordinate, zoom);
            if (isValidCoordinate(nextCoordinate)) {
              onCoordinateChange(nextCoordinate);
            }
          },
          onPointerUp: (event: any) => {
            if (pointerDragRef.current?.moved) {
              suppressNextPressRef.current = true;
            }
            event.currentTarget?.releasePointerCapture?.(event.pointerId);
            pointerDragRef.current = null;
          },
          onPointerCancel: (event: any) => {
            event.currentTarget?.releasePointerCapture?.(event.pointerId);
            pointerDragRef.current = null;
          },
          onWheel: (event: any) => {
            if (!isValidSize(size)) {
              return;
            }

            event.preventDefault?.();
            const nextZoom = clamp(zoom + (event.deltaY < 0 ? 1 : -1), MIN_ZOOM, MAX_ZOOM);
            if (nextZoom === zoom) {
              return;
            }

            const pressLocation = eventLocationFromClientPoint(event, event.currentTarget);
            if (!pressLocation) {
              setZoom(nextZoom);
              return;
            }

            const nextCoordinate = zoomAroundScreenPoint(
              pressLocation.x,
              pressLocation.y,
              safeCoordinate,
              size,
              zoom,
              nextZoom,
            );
            setZoom(nextZoom);
            if (isValidCoordinate(nextCoordinate)) {
              onCoordinateChange(nextCoordinate);
            }
          },
          onClick: (event: any) => {
            if (suppressNextPressRef.current) {
              event.preventDefault?.();
            }
          },
        } as any)
      : null;

  return (
    <View style={styles.container}>
      <Pressable
        {...panResponder.panHandlers}
        {...webGestureHandlers}
        accessibilityLabel="Map pin location"
        accessibilityRole="button"
        testID="representative-map-pin-picker"
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          setSize({ width, height });
        }}
        onPress={handlePress}
        style={[styles.mapSurface, webMapSurfaceStyle]}
      >
        {tileGrid.length === 0 ? (
          <View style={styles.loadingState}>
            <Text style={styles.loadingText}>Loading map</Text>
          </View>
        ) : null}
        {tileGrid.map((tile, index) => (
          <Image
            key={`${tile.z}-${tile.x}-${tile.y}-${index}`}
            source={tileImageSource(tile.x, tile.y, tile.z)}
            style={[
              styles.tile,
              {
                left: tile.left,
                top: tile.top,
              },
            ]}
          />
        ))}
        {boundaryPoints ? (
          <Svg style={styles.boundaryOverlay} width={size.width} height={size.height}>
            <Polygon points={boundaryPoints} fill="rgba(214, 39, 40, 0.06)" stroke="none" />
            <Polyline
              points={boundaryPoints}
              fill="none"
              stroke={theme.colors.accent}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={3}
            />
          </Svg>
        ) : null}
        <View style={styles.crosshairHorizontal} />
        <View style={styles.crosshairVertical} />
        <View style={styles.pin} />
        {!isInMinnesota ? (
          <View style={styles.coverageBadge}>
            <Text style={styles.coverageBadgeText}>Outside Minnesota lookup area</Text>
          </View>
        ) : null}
        <View style={styles.zoomControls}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Zoom map in"
            onPress={(event) => {
              event.stopPropagation();
              handleZoomStep(1);
            }}
            style={({ pressed }) => [styles.zoomButton, pressed ? styles.zoomButtonPressed : null]}
          >
            <Text style={styles.zoomButtonText}>+</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Zoom map out"
            onPress={(event) => {
              event.stopPropagation();
              handleZoomStep(-1);
            }}
            style={({ pressed }) => [styles.zoomButton, pressed ? styles.zoomButtonPressed : null]}
          >
            <Text style={styles.zoomButtonText}>-</Text>
          </Pressable>
        </View>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="Open OpenStreetMap copyright"
          onPress={(event) => {
            event.stopPropagation();
            void Linking.openURL(OPENSTREETMAP_COPYRIGHT_URL);
          }}
          style={({ pressed }) => [styles.attribution, pressed ? styles.attributionPressed : null]}
        >
          <Text style={styles.attributionText}>(c) OpenStreetMap contributors</Text>
        </Pressable>
      </Pressable>
      <View style={styles.coordinateRow}>
        <Text testID="representative-map-pin-latitude" style={styles.coordinateText}>
          {safeCoordinate.latitude.toFixed(5)}
        </Text>
        <Text testID="representative-map-pin-longitude" style={styles.coordinateText}>
          {safeCoordinate.longitude.toFixed(5)}
        </Text>
        <Text
          style={[
            styles.coordinateText,
            isInMinnesota ? styles.coverageInsideText : styles.coverageOutsideText,
          ]}
        >
          {isInMinnesota ? 'MN lookup area' : 'Outside MN lookup area'}
        </Text>
      </View>
    </View>
  );
}

function pressLocationFromEvent(event: GestureResponderEvent): { x: number; y: number } | null {
  const nativeEvent = event.nativeEvent as GestureResponderEvent['nativeEvent'] & {
    clientX?: number;
    clientY?: number;
    offsetX?: number;
    offsetY?: number;
  };
  if (Number.isFinite(nativeEvent.locationX) && Number.isFinite(nativeEvent.locationY)) {
    return { x: nativeEvent.locationX, y: nativeEvent.locationY };
  }
  const offsetX = nativeEvent.offsetX;
  const offsetY = nativeEvent.offsetY;
  if (Number.isFinite(offsetX) && Number.isFinite(offsetY)) {
    return { x: offsetX as number, y: offsetY as number };
  }

  const clientX = nativeEvent.clientX;
  const clientY = nativeEvent.clientY;
  const target = event.currentTarget as unknown as { getBoundingClientRect?: () => DOMRect };
  if (target?.getBoundingClientRect && Number.isFinite(clientX) && Number.isFinite(clientY)) {
    const rect = target.getBoundingClientRect();
    return {
      x: (clientX as number) - rect.left,
      y: (clientY as number) - rect.top,
    };
  }
  return null;
}

function buildTileGrid(coordinate: RepresentativeLookupCoordinates, size: Size, zoom: number) {
  if (!isValidCoordinate(coordinate) || !isValidSize(size)) {
    return [];
  }

  const center = coordinateToWorldPixel(coordinate, zoom);
  if (!Number.isFinite(center.x) || !Number.isFinite(center.y)) {
    return [];
  }

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
        z: zoom,
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
  size: Size,
  zoom: number,
): RepresentativeLookupCoordinates {
  const center = coordinateToWorldPixel(centerCoordinate, zoom);
  const worldPoint = {
    x: center.x + x - size.width / 2,
    y: center.y + y - size.height / 2,
  };
  return worldPixelToCoordinate(worldPoint, zoom);
}

function zoomAroundScreenPoint(
  x: number,
  y: number,
  centerCoordinate: RepresentativeLookupCoordinates,
  size: Size,
  currentZoom: number,
  nextZoom: number,
): RepresentativeLookupCoordinates {
  const targetCoordinate = screenPointToCoordinate(x, y, centerCoordinate, size, currentZoom);
  const targetWorldPoint = coordinateToWorldPixel(targetCoordinate, nextZoom);
  return worldPixelToCoordinate(
    {
      x: targetWorldPoint.x - x + size.width / 2,
      y: targetWorldPoint.y - y + size.height / 2,
    },
    nextZoom,
  );
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

function worldPixelToCoordinate(
  point: { x: number; y: number },
  zoom: number,
): RepresentativeLookupCoordinates {
  const scale = TILE_SIZE * 2 ** zoom;
  const longitude = (point.x / scale) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * point.y) / scale;
  const latitude = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return {
    latitude: clamp(latitude, -90, 90),
    longitude: clamp(longitude, -180, 180),
  };
}

function buildBoundaryPoints(
  centerCoordinate: RepresentativeLookupCoordinates,
  size: Size,
  zoom: number,
) {
  if (!isValidCoordinate(centerCoordinate) || !isValidSize(size)) {
    return null;
  }

  const center = coordinateToWorldPixel(centerCoordinate, zoom);
  return MINNESOTA_BOUNDARY.map(([latitude, longitude]) => {
    const point = coordinateToWorldPixel({ latitude, longitude }, zoom);
    const x = point.x - center.x + size.width / 2;
    const y = point.y - center.y + size.height / 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

function tileUrl(x: number, y: number, z: number) {
  const max = 2 ** z;
  const wrappedX = ((x % max) + max) % max;
  const clampedY = clamp(y, 0, max - 1);
  return tileTemplate
    .replace('{z}', String(z))
    .replace('{x}', String(wrappedX))
    .replace('{y}', String(clampedY));
}

function tileImageSource(x: number, y: number, z: number) {
  const uri = tileUrl(x, y, z);
  if (Platform.OS === 'web') {
    return { uri };
  }

  return {
    uri,
    headers: {
      'User-Agent': MAP_TILE_USER_AGENT,
    },
  };
}

function dragOffsetToCoordinate(
  dx: number,
  dy: number,
  centerCoordinate: RepresentativeLookupCoordinates,
  zoom: number,
): RepresentativeLookupCoordinates {
  const center = coordinateToWorldPixel(centerCoordinate, zoom);
  return worldPixelToCoordinate(
    {
      x: center.x - dx,
      y: center.y - dy,
    },
    zoom,
  );
}

function eventLocationFromClientPoint(
  event: { clientX?: number; clientY?: number },
  target: unknown,
) {
  const element = target as { getBoundingClientRect?: () => DOMRect };
  if (
    !element?.getBoundingClientRect ||
    !Number.isFinite(event.clientX) ||
    !Number.isFinite(event.clientY)
  ) {
    return null;
  }

  const rect = element.getBoundingClientRect();
  return {
    x: (event.clientX as number) - rect.left,
    y: (event.clientY as number) - rect.top,
  };
}

function isValidCoordinate(coordinate: RepresentativeLookupCoordinates) {
  return Number.isFinite(coordinate.latitude) && Number.isFinite(coordinate.longitude);
}

function isValidSize(size: Size) {
  return (
    Number.isFinite(size.width) && Number.isFinite(size.height) && size.width > 0 && size.height > 0
  );
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
    pointerEvents: 'none',
  },
  boundaryOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    pointerEvents: 'none',
  },
  loadingState: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
  },
  loadingText: {
    color: theme.colors.mutedInk,
    fontFamily: theme.typography.ui,
    fontSize: 13,
  },
  crosshairHorizontal: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '50%',
    height: 1,
    backgroundColor: 'rgba(17, 17, 17, 0.22)',
    pointerEvents: 'none',
  },
  crosshairVertical: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: '50%',
    width: 1,
    backgroundColor: 'rgba(17, 17, 17, 0.22)',
    pointerEvents: 'none',
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
    pointerEvents: 'none',
  },
  coverageBadge: {
    position: 'absolute',
    left: theme.spacing.md,
    right: theme.spacing.md,
    bottom: 34,
    alignItems: 'center',
    pointerEvents: 'none',
  },
  coverageBadgeText: {
    borderWidth: 1,
    borderColor: theme.colors.accent,
    backgroundColor: 'rgba(249, 249, 247, 0.94)',
    color: theme.colors.accent,
    fontFamily: theme.typography.ui,
    fontSize: 12,
    fontWeight: '700',
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 5,
    textTransform: 'uppercase',
  },
  zoomControls: {
    position: 'absolute',
    left: theme.spacing.xs,
    top: theme.spacing.xs,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  zoomButton: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  zoomButtonPressed: {
    backgroundColor: theme.colors.surfaceAlt,
  },
  zoomButtonText: {
    color: theme.colors.ink,
    fontFamily: theme.typography.ui,
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 24,
  },
  attribution: {
    position: 'absolute',
    right: theme.spacing.xs,
    bottom: theme.spacing.xs,
    backgroundColor: 'rgba(249, 249, 247, 0.88)',
    borderWidth: 1,
    borderColor: 'rgba(17, 17, 17, 0.18)',
    paddingHorizontal: theme.spacing.xs,
    paddingVertical: 3,
  },
  attributionPressed: {
    opacity: 0.72,
  },
  attributionText: {
    color: theme.colors.ink,
    fontFamily: theme.typography.ui,
    fontSize: 10,
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
  coverageInsideText: {
    color: theme.colors.mutedInk,
  },
  coverageOutsideText: {
    color: theme.colors.accent,
    fontWeight: '700',
  },
});
