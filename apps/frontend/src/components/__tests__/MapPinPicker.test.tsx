import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const { renderToStaticMarkup } = require('react-dom/server') as {
  renderToStaticMarkup: (node: React.ReactNode) => string;
};

vi.mock('react-native-svg', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <svg>{children}</svg>,
  Path: () => <path />,
}));

import { MapPinPicker } from '../MapPinPicker';

const source = readFileSync(join(__dirname, '..', 'MapPinPicker.tsx'), 'utf8');
const screenSource = readFileSync(
  join(__dirname, '..', '..', 'screens', 'FindMyLegislatorScreen.tsx'),
  'utf8',
);

describe('district map credits', () => {
  it('places the district explanation between the instruction and the 3 source rows', () => {
    const markup = renderToStaticMarkup(<MapPinPicker onCoordinateChange={vi.fn()} />);

    const map = markup.indexOf('district-map-canvas');
    const instruction = markup.indexOf('Click the map to choose your location');
    const explanation = markup.indexOf('Every address has one House district');
    const credits = markup.indexOf('district-map-credits');
    expect(map).toBeLessThan(instruction);
    expect(instruction).toBeLessThan(explanation);
    expect(explanation).toBeLessThan(credits);
    expect(source).toMatch(
      /credits:\s*\{[\s\S]*alignSelf: 'stretch'[\s\S]*alignItems: 'flex-start'[\s\S]*flexDirection: 'column'/,
    );
    expect(source).toMatch(/helper:\s*\{[\s\S]*marginTop: 6[\s\S]*fontSize: 15/);
    expect(source).toMatch(
      /districtExplanation:\s*\{[\s\S]*alignSelf: 'stretch'[\s\S]*marginTop: 18[\s\S]*marginBottom: 30[\s\S]*fontSize: 18/,
    );
    expect(source).not.toMatch(/districtExplanation:\s*\{[\s\S]*maxWidth/);
    expect(source).toMatch(/credits:\s*\{[\s\S]*marginTop: 0/);
  });

  it('keeps all 3 source rows together and gives both links the profile-card treatment', () => {
    const markup = renderToStaticMarkup(<MapPinPicker onCoordinateChange={vi.fn()} />);

    expect(markup).not.toContain('District boundaries: Minnesota Legislature GIS');
    expect(markup).not.toContain('© OpenStreetMap contributors');
    expect(source).toContain('label="© OpenStreetMap contributors"');
    expect(markup).toContain('District lines from');
    expect(markup).toContain('Minnesota’s Legislature');
    expect(markup).toContain('href="https://gis.lcc.mn.gov/"');
    expect(markup).toContain(
      'This product uses the Census Bureau Data API but is not endorsed or certified by the Census Bureau',
    );
    expect(markup).not.toContain('certified by the Census Bureau.');
    expect(source).toContain("{' (opens in a new tab)'}");
    expect(source).toContain("{' →'}");
    expect(source).toMatch(/creditLink:\s*\{[\s\S]*color: t.colors.brand.deep/);
    expect(source).toMatch(/creditLink:\s*\{[\s\S]*textDecorationLine: 'none'/);
  });

  it('keeps the Minnesota outline as context below selected districts', () => {
    expect(source).toContain('const MINNESOTA_GEOMETRY: GeoJsonGeometry');
    expect(source).toContain('const geometryToFit = senateGeometry');
    expect(source).toContain('fill="rgba(255,255,255,0.4)"');
    expect(source).toContain('stroke="rgba(17,21,15,0.55)"');
    expect(source.indexOf('statePath')).toBeLessThan(source.indexOf('housePath'));
  });

  it('keeps the current camera view while a map-selected district is loading and updating', () => {
    expect(source).toContain('preserveViewport?: boolean');
    expect(source).toMatch(
      /if \(preserveViewport\) \{[\s\S]*fittedFor\.current = geometryToFit;[\s\S]*return;/,
    );
    expect(screenSource).toContain('const [preserveMapViewport, setPreserveMapViewport]');
    expect(screenSource).toContain('preserveViewport={preserveMapViewport}');
    expect(screenSource).toMatch(
      /onCoordinateChange=\{\(coordinate\) => \{[\s\S]*setPreserveMapViewport\(true\);[\s\S]*runCoordinate\(coordinate, 'map'\)/,
    );
  });

  it('starts closer to Minnesota and restores every adjusted camera after the map remounts', () => {
    expect(source).toContain('export const MINNESOTA_MAP_VIEWPORT');
    expect(source).toMatch(/MINNESOTA_MAP_VIEWPORT[\s\S]*zoom: 6/);
    expect(source).toContain('initialViewport?: MapViewport');
    expect(source).toContain('onViewportChange?: (viewport: MapViewport) => void');
    expect(source).toContain('const geometryToFit = senateGeometry');
    expect(screenSource).toContain('const [mapViewport, setMapViewport]');
    expect(screenSource).toContain('useState<MapViewport>(MINNESOTA_MAP_VIEWPORT)');
    expect(screenSource).toContain('initialViewport={mapViewport}');
    expect(screenSource).toContain('onViewportChange={setMapViewport}');
  });

  it('does not show the neighboring House district badge', () => {
    expect(source).not.toContain('otherHouseDistrict');
    expect(source).not.toContain('NOT YOUR HOUSE DISTRICT');
    expect(screenSource).not.toContain('otherHouseDistrict={mapResult?.otherHouseDistrict}');
  });

  it('keeps unresolved helper text clean and hands outside map selections to the screen', () => {
    expect(source).toContain("'Tap the map to choose your location'");
    expect(source).toContain("'Click the map to choose your location'");
    expect(source).not.toContain("'Tap the map to choose your location.'");
    expect(source).not.toContain("'Click the map to choose your location.'");
    expect(source).toContain('onOutsideMinnesota?:');
    expect(source).toContain('onOutsideMinnesota?.(chosen)');
  });

  it('describes clicking or tapping as the main way to adjust a selected location', () => {
    expect(source).toContain("'Click the map to adjust your location'");
    expect(source).toContain("'Tap the map to adjust your location'");
    expect(source).not.toContain('Use + or − to zoom if needed');
    expect(source).not.toContain("'Drag the pin, click the map");
    expect(source).not.toContain("'Drag the pin or tap the map");
  });

  it('keeps the district explanation on the full map width without a final period', () => {
    const markup = renderToStaticMarkup(<MapPinPicker onCoordinateChange={vi.fn()} />);

    expect(markup).toContain(
      'Every address has one House district and one Senate district — we’ll show the legislator for each',
    );
    expect(markup).not.toContain('we’ll show the legislator for each.');
  });

  it('uses the configured tile source and only credits a successful tile request', () => {
    expect(source).toContain('EXPO_PUBLIC_OPENSTREETMAP_TILE_URL');
    expect(source).toContain('EXPO_PUBLIC_MAP_TILE_URL');
    expect(source).toContain('tileUrlForKey(key)');
    expect(source).toContain('tileState.requestKey === tileRequestKey && tileState.loaded');
    expect(source).toContain('const markTileFailed');
    expect(source).toContain('current.requestKey === tileRequestKey && !current.loaded');
    expect(source).toContain('current.failed < tiles.length');
  });

  it('gives the keyboard pin a visible focus ring', () => {
    expect(source).toContain("target.addEventListener('keydown', handleKeyDown)");
    expect(source).toContain('onFocus={() => setPinFocused(true)}');
    expect(source).toContain('pinFocused && styles.pinTargetFocused');
    expect(source).toContain("borderColor: '#7c5cff'");
  });
});
