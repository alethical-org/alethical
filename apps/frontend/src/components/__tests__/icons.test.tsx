import { describe, expect, it, vi } from 'vitest';

const { renderToStaticMarkup } = require('react-dom/server') as {
  renderToStaticMarkup: (node: React.ReactNode) => string;
};

vi.mock('react-native-svg', () => ({
  default: ({ children, ...props }: { children?: React.ReactNode }) => (
    <svg {...props}>{children}</svg>
  ),
  Circle: (props: Record<string, unknown>) => <circle {...props} />,
  Path: (props: Record<string, unknown>) => <path {...props} />,
  Polygon: (props: Record<string, unknown>) => <polygon {...props} />,
}));

import { AlertCircle, ArrowLeft, ArrowRight, Crosshair, MapPin, usedIconNames } from '../icons';

describe('local icons', () => {
  it('keeps the 20 shipped icons and their Lucide SVG defaults', () => {
    expect(usedIconNames).toHaveLength(20);

    const html = renderToStaticMarkup(<ArrowLeft size={32} color="#123456" strokeWidth={2.4} />);

    expect(html).toContain('viewBox="0 0 24 24"');
    expect(html).toContain('width="32"');
    expect(html).toContain('stroke="#123456"');
    expect(html).toContain('stroke-width="2.4"');
    expect(html).toContain('stroke-linecap="round"');
    expect(html).toContain('d="m12 19-7-7 7-7"');
  });

  // The phone drawer's Read row ends in one of these. Libre Franklin has no
  // right-arrow glyph, so a typed arrow renders as a missing character and the
  // arrow has to be a drawn path.
  it('draws a right arrow as a path, with the shared round caps', () => {
    const html = renderToStaticMarkup(
      <ArrowRight size={21} color="#656c66" strokeWidth={2.2} aria-hidden />,
    );

    expect(html).toContain('d="M5 12 H19"');
    expect(html).toContain('d="M14 7 L19 12 L14 17"');
    expect(html).toContain('stroke-linecap="round"');
    expect(html).toContain('stroke-linejoin="round"');
    expect(html).toContain('aria-hidden="true"');
  });

  it('passes accessibility properties through to the SVG', () => {
    const html = renderToStaticMarkup(<MapPin aria-hidden />);

    expect(html).toContain('aria-hidden="true"');
  });

  it('draws the location action as a crosshair rather than a send arrow', () => {
    const html = renderToStaticMarkup(<Crosshair size={19} aria-hidden />);

    expect(html).toContain('r="3.4"');
    expect(html).toContain('r="8.5"');
    expect(html).toContain('d="M12 2v3M12 19v3M22 12h-3M5 12H2"');
  });

  it('draws a decorative warning that does not rely on color alone', () => {
    const html = renderToStaticMarkup(<AlertCircle size={14} aria-hidden />);

    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('r="9"');
    expect(html).toContain('d="M12 7v6"');
  });
});
