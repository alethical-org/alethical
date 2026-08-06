import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  Linking,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { MINNESOTA_BOUNDARY, isCoordinateInMinnesota } from '../data/minnesotaBoundary';
import type { GeoJsonGeometry, RepresentativeLookupCoordinates } from '../data/types';
import { arrowMovedCoordinate, visibleTileKeys } from '../lib/districtMap';
import { externalLinkProps } from '../navigation/links';
import { theme as t } from '../theme/tokens';

const TILE_SIZE = 256;
const MIN_ZOOM = 5;
const MAX_ZOOM = 15;
const OSM_COPYRIGHT = 'https://www.openstreetmap.org/copyright';
const GIS_CREDIT = 'https://gis.lcc.mn.gov/';
const isWeb = Platform.OS === 'web';

type Size = { width: number; height: number };

export interface MapPinPickerProps {
  coordinate?: RepresentativeLookupCoordinates;
  houseGeometry?: GeoJsonGeometry;
  senateGeometry?: GeoJsonGeometry;
  houseDistrict?: string;
  senateDistrict?: string;
  otherHouseDistrict?: string;
  onCoordinateChange: (coordinate: RepresentativeLookupCoordinates) => void;
  mobile?: boolean;
}

function worldPoint(coordinate: RepresentativeLookupCoordinates, zoom: number) {
  const scale = TILE_SIZE * 2 ** zoom;
  const sin = Math.sin((coordinate.latitude * Math.PI) / 180);
  return {
    x: ((coordinate.longitude + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
}

function coordinateAt(point: { x: number; y: number }, zoom: number) {
  const scale = TILE_SIZE * 2 ** zoom;
  const longitude = (point.x / scale) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * point.y) / scale;
  return { latitude: (180 / Math.PI) * Math.atan(Math.sinh(n)), longitude };
}

function screenPoint(
  coordinate: RepresentativeLookupCoordinates,
  center: RepresentativeLookupCoordinates,
  size: Size,
  zoom: number,
) {
  const point = worldPoint(coordinate, zoom);
  const origin = worldPoint(center, zoom);
  return { x: size.width / 2 + point.x - origin.x, y: size.height / 2 + point.y - origin.y };
}

function coordinateForScreen(
  x: number,
  y: number,
  center: RepresentativeLookupCoordinates,
  size: Size,
  zoom: number,
) {
  const origin = worldPoint(center, zoom);
  return coordinateAt(
    { x: origin.x + x - size.width / 2, y: origin.y + y - size.height / 2 },
    zoom,
  );
}

function geometryPoints(geometry?: GeoJsonGeometry) {
  if (!geometry) return [] as number[][][][];
  return geometry.type === 'Polygon'
    ? [geometry.coordinates as number[][][]]
    : (geometry.coordinates as number[][][][]);
}

function boundsForGeometry(geometry?: GeoJsonGeometry) {
  const points = geometryPoints(geometry).flat(3) as number[];
  if (!points.length) return null;
  const pairs: number[][] = [];
  for (let index = 0; index < points.length; index += 2)
    pairs.push([points[index], points[index + 1]]);
  return {
    minLongitude: Math.min(...pairs.map((p) => p[0])),
    maxLongitude: Math.max(...pairs.map((p) => p[0])),
    minLatitude: Math.min(...pairs.map((p) => p[1])),
    maxLatitude: Math.max(...pairs.map((p) => p[1])),
  };
}

function fitView(geometry: GeoJsonGeometry | undefined, size: Size) {
  const bounds = boundsForGeometry(geometry);
  if (!bounds || size.width < 1 || size.height < 1) return null;
  const center = {
    latitude: (bounds.minLatitude + bounds.maxLatitude) / 2,
    longitude: (bounds.minLongitude + bounds.maxLongitude) / 2,
  };
  for (let zoom = MAX_ZOOM; zoom >= MIN_ZOOM; zoom -= 1) {
    const a = worldPoint({ latitude: bounds.maxLatitude, longitude: bounds.minLongitude }, zoom);
    const b = worldPoint({ latitude: bounds.minLatitude, longitude: bounds.maxLongitude }, zoom);
    if (Math.abs(b.x - a.x) <= size.width - 48 && Math.abs(b.y - a.y) <= size.height - 48) {
      return { center, zoom };
    }
  }
  return { center, zoom: MIN_ZOOM };
}

function geoPath(
  geometry: GeoJsonGeometry | undefined,
  center: RepresentativeLookupCoordinates,
  size: Size,
  zoom: number,
) {
  return geometryPoints(geometry)
    .map((polygon) =>
      polygon
        .map(
          (ring) =>
            ring
              .map(([longitude, latitude], index) => {
                const point = screenPoint({ latitude, longitude }, center, size, zoom);
                return `${index ? 'L' : 'M'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
              })
              .join(' ') + ' Z',
        )
        .join(' '),
    )
    .join(' ');
}

function tileStyle(key: string, center: RepresentativeLookupCoordinates, size: Size, zoom: number) {
  const [, rawX, rawY] = key.split('/').map(Number);
  const origin = worldPoint(center, zoom);
  return {
    position: 'absolute' as const,
    left: size.width / 2 + rawX * TILE_SIZE - origin.x,
    top: size.height / 2 + rawY * TILE_SIZE - origin.y,
    width: TILE_SIZE,
    height: TILE_SIZE,
  };
}

export function MapPinPicker({
  coordinate,
  houseGeometry,
  senateGeometry,
  houseDistrict,
  senateDistrict,
  otherHouseDistrict,
  onCoordinateChange,
  mobile = false,
}: MapPinPickerProps) {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const [center, setCenter] = useState<RepresentativeLookupCoordinates>({
    latitude: 46.3,
    longitude: -94.4,
  });
  const [zoom, setZoom] = useState(6);
  const [tilesLoaded, setTilesLoaded] = useState(false);
  const [displayCoordinate, setDisplayCoordinate] = useState(coordinate);
  const [dragPin, setDragPin] = useState<{ x: number; y: number } | null>(null);
  const fittedFor = useRef<GeoJsonGeometry | undefined>(undefined);
  const keyboardTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panStart = useRef(center);

  useEffect(() => {
    if (!senateGeometry || fittedFor.current === senateGeometry) return;
    const fitted = fitView(senateGeometry, size);
    if (fitted) {
      fittedFor.current = senateGeometry;
      setCenter(fitted.center);
      setZoom(fitted.zoom);
    }
  }, [senateGeometry, size]);

  useEffect(
    () => () => {
      if (keyboardTimer.current) clearTimeout(keyboardTimer.current);
    },
    [],
  );

  useEffect(() => setDisplayCoordinate(coordinate), [coordinate]);

  const tiles = useMemo(
    () => (size.width ? visibleTileKeys(center, size, zoom) : []),
    [center, size, zoom],
  );
  const pinPoint = displayCoordinate ? screenPoint(displayCoordinate, center, size, zoom) : null;
  const housePath = geoPath(houseGeometry, center, size, zoom);
  const senatePath = geoPath(senateGeometry, center, size, zoom);

  const mapPan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, gesture) =>
          Math.abs(gesture.dx) + Math.abs(gesture.dy) > 4,
        onPanResponderGrant: () => {
          panStart.current = center;
        },
        onPanResponderMove: (_, gesture) => {
          const origin = worldPoint(panStart.current, zoom);
          setCenter(coordinateAt({ x: origin.x - gesture.dx, y: origin.y - gesture.dy }, zoom));
        },
        onPanResponderRelease: (event, gesture) => {
          if (Math.abs(gesture.dx) + Math.abs(gesture.dy) <= 4) {
            const chosen = coordinateForScreen(
              event.nativeEvent.locationX,
              event.nativeEvent.locationY,
              center,
              size,
              zoom,
            );
            if (isCoordinateInMinnesota(chosen)) {
              setDisplayCoordinate(chosen);
              onCoordinateChange(chosen);
            }
          }
        },
      }),
    [center, onCoordinateChange, size, zoom],
  );

  const pinPan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => setDragPin(pinPoint),
        onPanResponderMove: (_, gesture) => {
          if (pinPoint) setDragPin({ x: pinPoint.x + gesture.dx, y: pinPoint.y + gesture.dy });
        },
        onPanResponderRelease: (_, gesture) => {
          if (!pinPoint) return;
          const chosen = coordinateForScreen(
            pinPoint.x + gesture.dx,
            pinPoint.y + gesture.dy,
            center,
            size,
            zoom,
          );
          setDragPin(null);
          if (isCoordinateInMinnesota(chosen)) {
            setDisplayCoordinate(chosen);
            onCoordinateChange(chosen);
          }
        },
      }),
    [center, onCoordinateChange, pinPoint, size, zoom],
  );

  const movePinByKey = (event: {
    nativeEvent?: { key?: string; shiftKey?: boolean };
    preventDefault?: () => void;
  }) => {
    const key = event.nativeEvent?.key ?? '';
    if (!displayCoordinate || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key))
      return;
    event.preventDefault?.();
    const moved = arrowMovedCoordinate(
      displayCoordinate,
      key,
      Boolean(event.nativeEvent?.shiftKey),
    );
    if (!isCoordinateInMinnesota(moved)) return;
    setDisplayCoordinate(moved);
    const nextPoint = screenPoint(moved, center, size, zoom);
    if (
      nextPoint.x < 30 ||
      nextPoint.x > size.width - 30 ||
      nextPoint.y < 30 ||
      nextPoint.y > size.height - 30
    ) {
      setCenter(moved);
    }
    if (keyboardTimer.current) clearTimeout(keyboardTimer.current);
    keyboardTimer.current = setTimeout(() => onCoordinateChange(moved), 500);
  };

  const otherPill =
    senateGeometry && otherHouseDistrict ? screenPoint(center, center, size, zoom) : null;

  return (
    <View style={styles.wrap}>
      <View
        {...mapPan.panHandlers}
        onLayout={(event) => setSize(event.nativeEvent.layout)}
        style={[
          styles.map,
          mobile && styles.mapMobile,
          isWeb ? ({ touchAction: 'none' } as object) : null,
        ]}
        accessibilityLabel="Minnesota district map"
      >
        {tiles.map((key) => (
          <Image
            key={key}
            source={{ uri: `https://tile.openstreetmap.org/${key}.png` }}
            style={tileStyle(key, center, size, zoom)}
            onLoad={() => setTilesLoaded(true)}
            onError={() => undefined}
          />
        ))}
        <Svg
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
          width={size.width}
          height={size.height}
        >
          {housePath ? (
            <Path
              d={housePath}
              fill="rgba(45,212,126,0.16)"
              stroke="white"
              strokeWidth={7}
              fillRule="evenodd"
            />
          ) : null}
          {housePath ? (
            <Path
              d={housePath}
              fill="rgba(45,212,126,0.16)"
              stroke={t.colors.brand.deep}
              strokeWidth={3}
              strokeDasharray="8 7"
              fillRule="evenodd"
            />
          ) : null}
          {senatePath ? <Path d={senatePath} fill="none" stroke="white" strokeWidth={7} /> : null}
          {senatePath ? (
            <Path d={senatePath} fill="none" stroke={t.colors.purple.base} strokeWidth={3} />
          ) : null}
        </Svg>

        {houseDistrict && pinPoint ? (
          <View
            pointerEvents="none"
            style={[styles.codePill, { left: pinPoint.x + 18, top: pinPoint.y - 52 }]}
          >
            <Text style={styles.houseCode}>HOUSE {houseDistrict}</Text>
          </View>
        ) : null}
        {senateDistrict && pinPoint ? (
          <View
            pointerEvents="none"
            style={[styles.senatePill, { left: pinPoint.x + 18, top: pinPoint.y - 20 }]}
          >
            <Text style={styles.senateCode}>SENATE {senateDistrict}</Text>
          </View>
        ) : null}
        {otherPill ? (
          <View pointerEvents="none" style={[styles.otherPill, { left: 16, bottom: 56 }]}>
            <Text style={styles.houseCode}>HOUSE {otherHouseDistrict}</Text>
            <Text style={styles.otherText}>NOT YOUR HOUSE DISTRICT</Text>
          </View>
        ) : null}
      </View>

      {pinPoint ? (
        <Pressable
          {...pinPan.panHandlers}
          accessibilityRole="button"
          accessibilityLabel="Selected location. Use arrow keys to move it"
          {...({ onKeyDown: movePinByKey } as object)}
          style={[
            styles.pinTarget,
            { left: (dragPin ?? pinPoint).x - 22, top: (dragPin ?? pinPoint).y - 38 },
          ]}
        >
          <View style={styles.pinHead} />
          <View style={styles.pinPoint} />
        </Pressable>
      ) : null}

      <View style={styles.zoomControls}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Zoom in"
          onPress={() => setZoom((value) => Math.min(MAX_ZOOM, value + 1))}
          style={styles.zoomButton}
        >
          <Text style={styles.zoomText}>+</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Zoom out"
          onPress={() => setZoom((value) => Math.max(MIN_ZOOM, value - 1))}
          style={styles.zoomButton}
        >
          <Text style={styles.zoomText}>−</Text>
        </Pressable>
      </View>

      <View style={styles.credits}>
        <Pressable
          {...externalLinkProps(GIS_CREDIT, () => void Linking.openURL(GIS_CREDIT))}
          accessibilityLabel="Minnesota GIS, opens in a new tab"
        >
          <Text style={styles.creditLink}>Minnesota GIS</Text>
        </Pressable>
        {tilesLoaded ? (
          <Pressable
            {...externalLinkProps(OSM_COPYRIGHT, () => void Linking.openURL(OSM_COPYRIGHT))}
            accessibilityLabel="OpenStreetMap, opens in a new tab"
          >
            <Text style={styles.creditLink}>OpenStreetMap</Text>
          </Pressable>
        ) : null}
      </View>

      <Text style={styles.helper}>
        {displayCoordinate
          ? mobile
            ? 'Drag the pin or tap the map to move it'
            : 'Drag the pin, click the map, or use the arrow keys to move it'
          : mobile
            ? 'Tap the map to choose a location.'
            : 'Click the map to choose a location.'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'relative' },
  map: {
    height: 430,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#e7ebe5',
    borderWidth: 1,
    borderColor: t.colors.alpha.ink14,
  },
  mapMobile: { height: 340 },
  pinTarget: { position: 'absolute', width: 44, height: 44, zIndex: 8, alignItems: 'center' },
  pinHead: {
    width: 25,
    height: 25,
    borderRadius: 13,
    backgroundColor: t.colors.brand.deep,
    borderWidth: 4,
    borderColor: 'white',
    ...(t.shadows.md as object),
  },
  pinPoint: {
    width: 0,
    height: 0,
    borderLeftWidth: 7,
    borderRightWidth: 7,
    borderTopWidth: 13,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: t.colors.brand.deep,
    marginTop: -3,
  },
  zoomControls: { position: 'absolute', right: 12, top: 12, zIndex: 10, gap: 6 },
  zoomButton: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: 'white',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: t.colors.alpha.ink14,
  },
  zoomText: { fontFamily: t.typography.ui, fontSize: 24, color: t.colors.ink },
  credits: {
    position: 'absolute',
    left: 10,
    top: 10,
    flexDirection: 'row',
    gap: 10,
    backgroundColor: 'rgba(255,255,255,0.92)',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 7,
  },
  creditLink: {
    fontFamily: t.typography.body,
    fontSize: 11,
    color: t.colors.text.secondary,
    textDecorationLine: 'underline',
  },
  helper: {
    marginTop: 10,
    fontFamily: t.typography.body,
    fontSize: 13,
    color: t.colors.text.muted,
  },
  codePill: {
    position: 'absolute',
    backgroundColor: 'white',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  senatePill: {
    position: 'absolute',
    backgroundColor: 'white',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  otherPill: {
    position: 'absolute',
    backgroundColor: 'white',
    borderRadius: 9,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  houseCode: {
    fontFamily: t.typography.mono,
    fontSize: 11,
    fontWeight: '700',
    color: t.colors.brand.deep,
  },
  senateCode: {
    fontFamily: t.typography.mono,
    fontSize: 11,
    fontWeight: '700',
    color: t.colors.purple.base,
  },
  otherText: {
    fontFamily: t.typography.mono,
    fontSize: 8,
    marginTop: 2,
    color: t.colors.text.faint,
  },
});
