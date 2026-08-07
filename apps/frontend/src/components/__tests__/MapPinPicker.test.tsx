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

  it('uses the full credit wording and keeps the tile credit tied to loaded tiles', () => {
    const markup = renderToStaticMarkup(<MapPinPicker onCoordinateChange={vi.fn()} />);

    expect(markup).toContain('District boundaries: Minnesota Legislature GIS');
    expect(markup).toContain('District boundaries: Minnesota Legislature GIS ↗');
    expect(markup).toContain(
      'aria-label="District boundaries: Minnesota Legislature GIS, opens in a new tab"',
    );
    expect(markup).toContain('href="https://gis.lcc.mn.gov/"');
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('rel="noopener noreferrer"');
    expect(markup).not.toContain('© OpenStreetMap contributors');
    expect(source).toContain('label="© OpenStreetMap contributors"');
    expect(source).toContain('accessibilityLabel={`${label}, opens in a new tab`}');
    expect(source).toContain('{label} ↗');
    expect(source).toContain("creditLinkHovered: { textDecorationLine: 'underline' }");
    expect(source.indexOf('© OpenStreetMap contributors')).toBeLessThan(
      source.indexOf('District boundaries: Minnesota Legislature GIS'),
    );
  });
});
