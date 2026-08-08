import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const { renderToStaticMarkup } = require('react-dom/server') as {
  renderToStaticMarkup: (node: React.ReactNode) => string;
};

vi.mock('react-native-svg', () => ({
  default: ({ children, testID, ...props }: React.PropsWithChildren<{ testID?: string }>) => (
    <svg data-testid={testID} {...props}>
      {children}
    </svg>
  ),
  Path: (props: React.SVGProps<SVGPathElement>) => <path {...props} />,
}));

import { LinkArrow } from '../LinkArrow';

const source = readFileSync(join(__dirname, '..', 'LinkArrow.tsx'), 'utf8');

describe('LinkArrow', () => {
  it('draws one long, centered arrow instead of using a phone-dependent text character', () => {
    const html = renderToStaticMarkup(<LinkArrow color="#123456" />);

    expect(html).toContain('data-testid="link-arrow"');
    expect(html).toContain('width="19"');
    expect(html).toContain('height="19"');
    expect(html).toContain('M3.5 12 H19.5 M13 6 L19.5 12 L13 18');
    expect(html).toContain('stroke="#123456"');
    expect(html).not.toContain('→');
    expect(source).not.toContain('accessible={false}');
    expect(source).not.toContain('pointerEvents="none"');
    expect(source).toMatch(/arrow:\s*\{[^}]*pointerEvents: 'none'/);
  });
});
