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

describe('district map credits', () => {
  it('places stacked, right-aligned credits after the clickable map', () => {
    const markup = renderToStaticMarkup(<MapPinPicker onCoordinateChange={vi.fn()} />);

    expect(markup.indexOf('district-map-canvas')).toBeLessThan(
      markup.indexOf('district-map-credits'),
    );
    expect(source).toMatch(
      /credits:\s*\{[\s\S]*alignSelf: 'flex-end'[\s\S]*alignItems: 'flex-end'[\s\S]*flexDirection: 'column'/,
    );
  });

  it('keeps only the required OpenStreetMap credit and its external-source treatment', () => {
    const markup = renderToStaticMarkup(<MapPinPicker onCoordinateChange={vi.fn()} />);

    expect(markup).not.toContain('District boundaries: Minnesota Legislature GIS');
    expect(markup).not.toContain('https://gis.lcc.mn.gov/');
    expect(markup).not.toContain('© OpenStreetMap contributors');
    expect(source).toContain('label="© OpenStreetMap contributors"');
    expect(source).not.toContain('GIS_CREDIT');
    expect(source).toContain("{' (opens in a new tab)'}");
    expect(source).toContain('viewBox="0 0 12 12"');
    expect(source).toMatch(/creditLink:\s*\{[\s\S]*textDecorationLine: 'underline'/);
  });

  it('fits Minnesota before a district is selected and keeps the state context below districts', () => {
    expect(source).toContain('const MINNESOTA_GEOMETRY: GeoJsonGeometry');
    expect(source).toContain('const geometryToFit = senateGeometry ?? MINNESOTA_GEOMETRY');
    expect(source).toContain('fill="rgba(255,255,255,0.4)"');
    expect(source).toContain('stroke="rgba(17,21,15,0.55)"');
    expect(source.indexOf('statePath')).toBeLessThan(source.indexOf('housePath'));
  });

  it('keeps unresolved helper text clean and hands outside map selections to the screen', () => {
    expect(source).toContain("'Tap the map to choose a location'");
    expect(source).toContain("'Click the map to choose a location'");
    expect(source).not.toContain("'Tap the map to choose a location.'");
    expect(source).not.toContain("'Click the map to choose a location.'");
    expect(source).toContain('onOutsideMinnesota?:');
    expect(source).toContain('onOutsideMinnesota?.(chosen)');
  });

  it('describes clicking or tapping as the main way to adjust a selected location', () => {
    expect(source).toContain(
      "'Click the map to adjust your location. Use + or − to zoom if needed.'",
    );
    expect(source).toContain(
      "'Tap the map to adjust your location. Use + or − to zoom if needed.'",
    );
    expect(source).not.toContain("'Drag the pin, click the map");
    expect(source).not.toContain("'Drag the pin or tap the map");
  });

  it('uses the configured tile source and only credits a successful tile request', () => {
    expect(source).toContain('EXPO_PUBLIC_OPENSTREETMAP_TILE_URL');
    expect(source).toContain('EXPO_PUBLIC_MAP_TILE_URL');
    expect(source).toContain('tileUrlForKey(key)');
    expect(source).toContain('tileState.requestKey === tileRequestKey && tileState.loaded');
    expect(source).toContain('const markTileFailed');
  });

  it('gives the keyboard pin a visible focus ring', () => {
    expect(source).toContain("target.addEventListener('keydown', handleKeyDown)");
    expect(source).toContain('onFocus={() => setPinFocused(true)}');
    expect(source).toContain('pinFocused && styles.pinTargetFocused');
    expect(source).toContain("borderColor: '#7c5cff'");
  });
});
