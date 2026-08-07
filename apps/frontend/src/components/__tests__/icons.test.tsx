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

import { ArrowLeft, MapPin, usedIconNames } from '../icons';

describe('local icons', () => {
  it('keeps the 17 shipped icons and their Lucide SVG defaults', () => {
    expect(usedIconNames).toHaveLength(17);

    const html = renderToStaticMarkup(<ArrowLeft size={32} color="#123456" strokeWidth={2.4} />);

    expect(html).toContain('viewBox="0 0 24 24"');
    expect(html).toContain('width="32"');
    expect(html).toContain('stroke="#123456"');
    expect(html).toContain('stroke-width="2.4"');
    expect(html).toContain('stroke-linecap="round"');
    expect(html).toContain('d="m12 19-7-7 7-7"');
  });

  it('passes accessibility properties through to the SVG', () => {
    const html = renderToStaticMarkup(<MapPin aria-hidden />);

    expect(html).toContain('aria-hidden="true"');
  });
});
