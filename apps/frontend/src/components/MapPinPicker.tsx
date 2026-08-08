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
import {
  arrowMovedCoordinate,
  pinchZoomLevel,
  visibleTileKeys,
  zoomedMapViewport,
} from '../lib/districtMap';
import { externalLinkProps } from '../navigation/links';
import { theme as t } from '../theme/tokens';
import { LinkArrow } from './LinkArrow';

const TILE_SIZE = 256;
const MIN_ZOOM = 5;
const MAX_ZOOM = 15;
const OSM_COPYRIGHT = 'https://www.openstreetmap.org/copyright';
const GIS_CREDIT = 'https://gis.lcc.mn.gov/';
const isWeb = Platform.OS === 'web';

const MINNESOTA_GEOMETRY: GeoJsonGeometry = {
  type: 'Polygon',
  coordinates: [MINNESOTA_BOUNDARY.map(([latitude, longitude]) => [longitude, latitude])],
};

type Size = { width: number; height: number };
type MapTouch = { locationX: number; locationY: number };

function pinchForTouches(touches: readonly MapTouch[]) {
  if (touches.length < 2) return null;
  const [first, second] = touches;
  return {
    distance: Math.hypot(second.locationX - first.locationX, second.locationY - first.locationY),
    point: {
      x: (first.locationX + second.locationX) / 2,
      y: (first.locationY + second.locationY) / 2,
    },
  };
}

export interface MapViewport {
  center: RepresentativeLookupCoordinates;
  zoom: number;
}

export const MINNESOTA_MAP_VIEWPORT: MapViewport = {
  center: { latitude: 46.3, longitude: -94.4 },
  zoom: 6,
};

export interface MapPinPickerProps {
  coordinate?: RepresentativeLookupCoordinates;
  houseGeometry?: GeoJsonGeometry;
  senateGeometry?: GeoJsonGeometry;
  houseDistrict?: string;
  senateDistrict?: string;
  preserveViewport?: boolean;
  initialViewport?: MapViewport;
  onViewportChange?: (viewport: MapViewport) => void;
  onCoordinateChange: (coordinate: RepresentativeLookupCoordinates) => void;
  onOutsideMinnesota?: (coordinate: RepresentativeLookupCoordinates) => void;
  mobile?: boolean;
}

export function tileUrlForKey(key: string) {
  const template = [
    process.env.EXPO_PUBLIC_OPENSTREETMAP_TILE_URL,
    process.env.EXPO_PUBLIC_MAP_TILE_URL,
    'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  ].find((value) => value?.trim());
  const [z, x, y] = key.split('/');
  return template!.replaceAll('{z}', z).replaceAll('{x}', x).replaceAll('{y}', y);
}

function MapCredit({ href, label }: { href: string; label: string }) {
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      {...externalLinkProps(href, () => void Linking.openURL(href))}
      accessibilityLabel={`${label}, opens in a new tab`}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={styles.creditTarget}
    >
      <Text style={[styles.creditLink, hovered && styles.creditLinkHovered]}>{label}</Text>
      <LinkArrow color={t.colors.brand.deep} />
      <Text style={[styles.visuallyHidden, isWeb ? ({ clipPath: 'inset(50%)' } as object) : null]}>
        {' (opens in a new tab)'}
      </Text>
    </Pressable>
  );
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
  preserveViewport = false,
  initialViewport = MINNESOTA_MAP_VIEWPORT,
  onViewportChange,
  onCoordinateChange,
  onOutsideMinnesota,
  mobile = false,
}: MapPinPickerProps) {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const [center, setCenter] = useState<RepresentativeLookupCoordinates>(initialViewport.center);
  const [zoom, setZoom] = useState(initialViewport.zoom);
  const [tileState, setTileState] = useState({ requestKey: '', loaded: false, failed: 0 });
  const [displayCoordinate, setDisplayCoordinate] = useState(coordinate);
  const [dragPin, setDragPin] = useState<{ x: number; y: number } | null>(null);
  const [pinFocused, setPinFocused] = useState(false);
  const fittedFor = useRef<GeoJsonGeometry | undefined>(undefined);
  const keyboardTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mapTargetRef = useRef<View | null>(null);
  const pinTargetRef = useRef<View | null>(null);
  const panStart = useRef(center);
  const panOffset = useRef({ dx: 0, dy: 0 });
  const pinchStart = useRef<{
    center: RepresentativeLookupCoordinates;
    distance: number;
    point: { x: number; y: number };
    size: Size;
    zoom: number;
  } | null>(null);
  const pinched = useRef(false);
  const mapState = useRef({
    center,
    zoom,
    size,
    onCoordinateChange,
    onOutsideMinnesota,
  });
  mapState.current = { center, zoom, size, onCoordinateChange, onOutsideMinnesota };
  const geometryToFit = senateGeometry;

  useEffect(() => {
    if (preserveViewport) {
      fittedFor.current = geometryToFit;
      return;
    }
    if (fittedFor.current === geometryToFit) return;
    const fitted = fitView(geometryToFit, size);
    if (fitted) {
      fittedFor.current = geometryToFit;
      setCenter(fitted.center);
      setZoom(fitted.zoom);
    }
  }, [geometryToFit, preserveViewport, size]);

  useEffect(() => {
    onViewportChange?.({ center, zoom });
  }, [center, onViewportChange, zoom]);

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
  const tileRequestKey = tiles.join('|');
  const tilesLoaded = tileState.requestKey === tileRequestKey && tileState.loaded;
  const pinPoint = displayCoordinate ? screenPoint(displayCoordinate, center, size, zoom) : null;
  const statePath = geoPath(MINNESOTA_GEOMETRY, center, size, zoom);
  const housePath = geoPath(houseGeometry, center, size, zoom);
  const senatePath = geoPath(senateGeometry, center, size, zoom);

  useEffect(() => {
    setTileState({ requestKey: tileRequestKey, loaded: false, failed: 0 });
  }, [tileRequestKey]);

  const markTileLoaded = () => {
    setTileState((current) =>
      current.requestKey === tileRequestKey && !current.loaded
        ? { ...current, loaded: true }
        : current,
    );
  };
  const markTileFailed = () => {
    setTileState((current) =>
      current.requestKey === tileRequestKey && current.failed < tiles.length
        ? { ...current, failed: Math.min(current.failed + 1, tiles.length) }
        : current,
    );
  };

  const mapPan = useMemo(() => {
    const beginPinch = (event: { nativeEvent: { touches: readonly MapTouch[] } }) => {
      const pinch = pinchForTouches(event.nativeEvent.touches);
      if (!pinch) return;
      const { center, size, zoom } = mapState.current;
      pinchStart.current = { center, distance: pinch.distance, point: pinch.point, size, zoom };
      pinched.current = true;
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: (_, gesture) => gesture.numberActiveTouches > 1,
      onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) + Math.abs(gesture.dy) > 4,
      onMoveShouldSetPanResponderCapture: (_, gesture) => gesture.numberActiveTouches > 1,
      onPanResponderGrant: (event, gesture) => {
        panStart.current = mapState.current.center;
        panOffset.current = { dx: gesture.dx, dy: gesture.dy };
        pinched.current = false;
        beginPinch(event);
      },
      onPanResponderStart: (event) => beginPinch(event),
      onPanResponderMove: (event, gesture) => {
        const pinch = pinchForTouches(event.nativeEvent.touches);
        if (pinch) {
          if (!pinchStart.current) beginPinch(event);
          const start = pinchStart.current;
          if (!start) return;
          const nextZoom = pinchZoomLevel(
            start.zoom,
            start.distance,
            pinch.distance,
            MIN_ZOOM,
            MAX_ZOOM,
          );
          const next = zoomedMapViewport(
            start.center,
            start.zoom,
            nextZoom,
            start.size,
            start.point,
            pinch.point,
          );
          mapState.current = { ...mapState.current, center: next.center, zoom: next.zoom };
          setCenter(next.center);
          setZoom(next.zoom);
          return;
        }
        const { zoom } = mapState.current;
        const origin = worldPoint(panStart.current, zoom);
        setCenter(
          coordinateAt(
            {
              x: origin.x - gesture.dx + panOffset.current.dx,
              y: origin.y - gesture.dy + panOffset.current.dy,
            },
            zoom,
          ),
        );
      },
      onPanResponderEnd: (_, gesture) => {
        if (!pinchStart.current) return;
        pinchStart.current = null;
        panStart.current = mapState.current.center;
        panOffset.current = { dx: gesture.dx, dy: gesture.dy };
      },
      onPanResponderRelease: (event, gesture) => {
        if (!pinched.current && Math.abs(gesture.dx) + Math.abs(gesture.dy) <= 4) {
          const { center, size, zoom, onCoordinateChange, onOutsideMinnesota } = mapState.current;
          const chosen = coordinateForScreen(
            event.nativeEvent.locationX,
            event.nativeEvent.locationY,
            center,
            size,
            zoom,
          );
          if (!isCoordinateInMinnesota(chosen)) return onOutsideMinnesota?.(chosen);
          setDisplayCoordinate(chosen);
          onCoordinateChange(chosen);
        }
        pinchStart.current = null;
        pinched.current = false;
      },
      onPanResponderTerminate: () => {
        pinchStart.current = null;
        pinched.current = false;
      },
      onPanResponderTerminationRequest: () => false,
    });
  }, []);

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
          if (!isCoordinateInMinnesota(chosen)) return onOutsideMinnesota?.(chosen);
          setDisplayCoordinate(chosen);
          onCoordinateChange(chosen);
        },
      }),
    [center, onCoordinateChange, onOutsideMinnesota, pinPoint, size, zoom],
  );

  const movePinByKey = (key: string, shiftKey = false) => {
    if (!displayCoordinate || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key))
      return false;
    const moved = arrowMovedCoordinate(displayCoordinate, key, shiftKey, zoom);
    if (!isCoordinateInMinnesota(moved)) {
      onOutsideMinnesota?.(moved);
      return true;
    }
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
    return true;
  };

  useEffect(() => {
    const target = mapTargetRef.current as unknown as HTMLElement | null;
    if (!isWeb || !target) return;
    let lastZoomAt = Number.NEGATIVE_INFINITY;
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      if (!event.deltaY || event.timeStamp - lastZoomAt < 120) return;
      const { center, size, zoom } = mapState.current;
      const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom + (event.deltaY < 0 ? 1 : -1)));
      if (nextZoom === zoom) return;
      const bounds = target.getBoundingClientRect();
      const next = zoomedMapViewport(center, zoom, nextZoom, size, {
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      });
      lastZoomAt = event.timeStamp;
      mapState.current = { ...mapState.current, center: next.center, zoom: next.zoom };
      setCenter(next.center);
      setZoom(next.zoom);
    };
    target.addEventListener('wheel', handleWheel, { passive: false });
    return () => target.removeEventListener('wheel', handleWheel);
  }, []);

  useEffect(() => {
    const target = pinTargetRef.current as unknown as HTMLElement | null;
    if (!isWeb || !target) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (movePinByKey(event.key, event.shiftKey)) event.preventDefault();
    };
    target.addEventListener('keydown', handleKeyDown);
    return () => target.removeEventListener('keydown', handleKeyDown);
  }, [movePinByKey]);

  return (
    <View style={styles.wrap}>
      <View
        ref={mapTargetRef}
        {...mapPan.panHandlers}
        onLayout={(event) => setSize(event.nativeEvent.layout)}
        style={[
          styles.map,
          mobile && styles.mapMobile,
          isWeb ? ({ touchAction: 'none', cursor: 'grab', userSelect: 'none' } as object) : null,
        ]}
        testID="district-map-canvas"
        accessibilityLabel="Minnesota district map"
      >
        {tiles.map((key) => (
          <Image
            key={key}
            source={{ uri: tileUrlForKey(key) }}
            style={[
              tileStyle(key, center, size, zoom),
              isWeb ? ({ pointerEvents: 'none' } as object) : null,
            ]}
            onLoad={markTileLoaded}
            onError={markTileFailed}
          />
        ))}
        <Svg
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
          width={size.width}
          height={size.height}
        >
          {statePath ? (
            <Path
              d={`M0 0H${size.width}V${size.height}H0Z ${statePath}`}
              fill="rgba(255,255,255,0.4)"
              fillRule="evenodd"
            />
          ) : null}
          {statePath ? (
            <Path
              d={statePath}
              fill="none"
              stroke="white"
              strokeWidth={5.5}
              strokeLinejoin="round"
            />
          ) : null}
          {statePath ? (
            <Path
              d={statePath}
              fill="none"
              stroke="rgba(17,21,15,0.55)"
              strokeWidth={2.5}
              strokeLinejoin="round"
            />
          ) : null}
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
      </View>

      {pinPoint ? (
        <Pressable
          ref={pinTargetRef}
          {...pinPan.panHandlers}
          accessibilityRole="button"
          accessibilityLabel="Selected location. Use arrow keys to move it"
          onFocus={() => setPinFocused(true)}
          onBlur={() => setPinFocused(false)}
          style={[
            styles.pinTarget,
            pinFocused && styles.pinTargetFocused,
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

      <Text style={styles.helper}>
        {displayCoordinate
          ? mobile
            ? 'Drag with 1 finger to explore. Use + and − or 2 fingers to zoom. Then tap to adjust your location.'
            : 'Drag the map to explore. Use + and − or 2 fingers on a trackpad to zoom. Then click to adjust your location.'
          : mobile
            ? 'Drag with 1 finger to explore. Use + and − or 2 fingers to zoom. Then tap to choose your location.'
            : 'Drag the map to explore. Use + and − or 2 fingers on a trackpad to zoom. Then click to choose your location.'}
      </Text>

      <Text style={styles.districtExplanation}>
        Every address has one House district and one Senate district — we’ll show the legislator for
        each
      </Text>

      <View testID="district-map-credits" style={[styles.credits, mobile && styles.creditsMobile]}>
        {tilesLoaded ? (
          <MapCredit href={OSM_COPYRIGHT} label="© OpenStreetMap contributors" />
        ) : null}
        <View style={styles.creditRow}>
          <Text style={styles.creditText}>District lines from </Text>
          <MapCredit href={GIS_CREDIT} label="Minnesota’s Legislature" />
        </View>
        <Text style={styles.creditText}>
          This product uses the Census Bureau Data API but is not endorsed or certified by the
          Census Bureau
        </Text>
      </View>
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
  pinTargetFocused: {
    borderWidth: 3,
    borderColor: '#7c5cff',
    borderRadius: 22,
  },
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
    alignSelf: 'stretch',
    alignItems: 'flex-start',
    flexDirection: 'column',
    gap: 6,
    marginTop: 0,
  },
  creditsMobile: { marginTop: 240 },
  creditRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  creditTarget: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  creditText: {
    fontFamily: t.typography.body,
    fontSize: 12,
    lineHeight: 18,
    color: t.colors.text.faint,
  },
  creditLink: {
    fontFamily: t.typography.body,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
    color: t.colors.brand.deep,
    textDecorationLine: 'none',
  },
  creditLinkHovered: { textDecorationLine: 'underline' },
  visuallyHidden: {
    position: 'absolute',
    width: 1,
    height: 1,
    overflow: 'hidden',
  },
  helper: {
    marginTop: 6,
    fontFamily: t.typography.body,
    fontSize: 15,
    lineHeight: 22,
    color: t.colors.text.muted,
  },
  districtExplanation: {
    alignSelf: 'stretch',
    marginTop: 18,
    marginBottom: 30,
    fontFamily: t.typography.body,
    fontSize: 18,
    lineHeight: 28,
    color: '#4f5651',
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
});
