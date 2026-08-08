import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const { renderToStaticMarkup } = require('react-dom/server') as {
  renderToStaticMarkup: (node: React.ReactNode) => string;
};

vi.mock('../../icons', () => ({
  Crosshair: ({ size }: { size: number }) => (
    <svg aria-hidden="true" data-icon="crosshair" data-size={size} />
  ),
  MapPin: () => <span aria-hidden="true" />,
}));
vi.mock('react-native-svg', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <svg>{children}</svg>,
  Circle: () => <circle />,
  Path: () => <path />,
}));

import { HOME_FINDER_HELP, HomeLegislatorFinderForm } from '../HomeLegislatorFinder';

function renderFinder(options?: {
  findingLocation?: boolean;
  layout?: 'phone' | 'tablet' | 'desktop';
}) {
  return renderToStaticMarkup(
    <HomeLegislatorFinderForm
      value=""
      focused={false}
      findingLocation={options?.findingLocation ?? false}
      layout={options?.layout ?? 'desktop'}
      reduceMotion
      onValueChange={vi.fn()}
      onFocus={vi.fn()}
      onBlur={vi.fn()}
      onFind={vi.fn()}
      onUseLocation={vi.fn()}
    />,
  );
}

describe('homepage legislator finder form', () => {
  it('gives the field 1 name, linked help, and browser street-address fill behavior', () => {
    const html = renderFinder();

    expect(html.match(/aria-label="Full street address"/g)).toHaveLength(1);
    expect(html).toContain('aria-describedby="home-finder-address-help"');
    expect(html).toContain('id="home-finder-address-help"');
    expect(html).toMatch(/autocomplete="street-address"/i);
    expect(html).toContain('placeholder="350 S 5th St, Minneapolis, MN 55415"');
    expect(HOME_FINDER_HELP).toBe(
      "Enter a full street address — a city or ZIP code alone can't identify your legislators",
    );
    expect(html).toContain(HOME_FINDER_HELP.replace("'", '&#x27;'));
    expect(html).not.toContain('legislators.</div>');
  });

  it('keeps the waiting location control focusable, busy, and politely announced', () => {
    const html = renderFinder({ findingLocation: true, layout: 'phone' });

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('Finding your location…');
    expect(html).not.toContain('rotate(');
    expect(html).not.toContain('disabled=""');
    expect(html).not.toContain('disabled="true"');
    expect(html).not.toContain('aria-disabled="true"');
  });

  it('matches the destination page control without taking width from the address field', () => {
    const desktop = renderFinder();
    const phone = renderFinder({ layout: 'phone' });
    const source = readFileSync(join(__dirname, '..', 'HomeLegislatorFinder.tsx'), 'utf8');
    const desktopButtonStyle = source.slice(
      source.indexOf('locationButtonDesktop:'),
      source.indexOf('locationButtonWaiting:'),
    );
    const inputStyle = source.slice(source.indexOf('input: {'), source.indexOf('findButton: {'));

    expect(desktop).toContain('data-icon="crosshair"');
    expect(desktop).toContain('data-size="19"');
    expect(phone).toContain('data-size="18"');
    expect(desktopButtonStyle).toContain('height: 62');
    expect(desktopButtonStyle).not.toContain('minWidth');
    expect(inputStyle).toContain('fontSize: 16');
    expect(inputStyle).toContain('inputDesktop: { fontSize: 18');
  });

  it('keeps 1 shared finder below either phone hero', () => {
    const source = readFileSync(
      join(__dirname, '..', '..', '..', 'screens', 'redesign', 'HomeSignedOutScreen.tsx'),
      'utf8',
    );
    const mobile = source.slice(
      source.indexOf('function HomeSignedOutMobile'),
      source.indexOf('const m = StyleSheet.create'),
    );

    expect(mobile.match(/<HomeLegislatorFinder/g)).toHaveLength(1);
    expect(mobile.indexOf('<HomeLegislatorFinder')).toBeGreaterThan(mobile.indexOf('isSignedIn ?'));
  });
});
