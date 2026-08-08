import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const { renderToStaticMarkup } = require('react-dom/server') as {
  renderToStaticMarkup: (node: React.ReactNode) => string;
};

import { LinkArrow } from '../LinkArrow';

const source = readFileSync(join(__dirname, '..', 'LinkArrow.tsx'), 'utf8');

describe('LinkArrow', () => {
  it('uses one decorative text glyph that inherits the surrounding label size and color', () => {
    const html = renderToStaticMarkup(<LinkArrow />);

    expect(html).toContain('data-testid="link-arrow"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('→');
    expect(source).toContain("fontWeight: '400'");
    expect(source).not.toContain('fontSize');
    expect(source).not.toContain('lineHeight');
    expect(source).not.toContain('top:');
    expect(source).not.toContain('transform');
    expect(source).not.toContain('react-native-svg');
  });
});
