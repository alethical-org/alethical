import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { StyleSheet, Text } from 'react-native';

const { JSDOM } = require('jsdom') as {
  JSDOM: new (html: string) => { window: Window & typeof globalThis };
};

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

import { GreenLinkArrow, LinkArrow, LinkArrowLabel, linkArrowRow } from '../LinkArrow';

const source = readFileSync(join(__dirname, '..', 'LinkArrow.tsx'), 'utf8');

describe('LinkArrow', () => {
  it.each(['underline', 'none', 'underline line-through'] as const)(
    'carries %s across the final-word layout without decorating the arrow',
    (textDecorationLine) => {
      const html = renderToStaticMarkup(
        <LinkArrowLabel
          label="Minnesota’s campaign-finance downloads"
          style={[
            { textDecorationLine: 'none' },
            { textDecorationLine, textDecorationColor: '#123456', textDecorationStyle: 'dotted' },
          ]}
        />,
      );
      const sheet = (
        StyleSheet as typeof StyleSheet & { getSheet(): { textContent: string } }
      ).getSheet();
      const dom = new JSDOM(`<style>${sheet.textContent}</style>${html}`);
      const label = dom.window.document.body.firstElementChild!;
      const group = label.querySelector('span')!;
      expect(dom.window.getComputedStyle(label).textDecorationLine).toBe(textDecorationLine);
      expect(dom.window.getComputedStyle(group).textDecorationLine).toBe(textDecorationLine);
      expect(dom.window.getComputedStyle(group).textDecorationColor).toBe('rgb(18, 52, 86)');
      expect(dom.window.getComputedStyle(group).textDecorationStyle).toBe('dotted');
      expect(group.querySelector('svg')!.style.textDecorationLine).toBe('');
      dom.window.close();
    },
  );

  it('inherits parent-owned decoration, including single-word labels', () => {
    const html = renderToStaticMarkup(
      <Text style={{ textDecorationLine: 'underline', textDecorationColor: '#123456' }}>
        <LinkArrowLabel label="Downloads" />
      </Text>,
    );
    const sheet = (
      StyleSheet as typeof StyleSheet & { getSheet(): { textContent: string } }
    ).getSheet();
    const dom = new JSDOM(`<style>${sheet.textContent}</style>${html}`);
    const label = dom.window.document.body.firstElementChild!.firstElementChild!;
    expect(dom.window.getComputedStyle(label).textDecorationLine).toBe('underline');
    expect(dom.window.getComputedStyle(label).textDecorationColor).toBe('rgb(18, 52, 86)');
    expect(dom.window.getComputedStyle(label.firstElementChild!).textDecorationLine).toBe(
      'underline',
    );
    dom.window.close();
  });

  it('draws one long, centered arrow instead of using a phone-dependent text character', () => {
    const html = renderToStaticMarkup(<LinkArrow color="#123456" />);

    expect(html).toContain('data-testid="link-arrow"');
    expect(html).toContain('width="19"');
    expect(html).toContain('height="19"');
    expect(html).toContain('M3.5 12 H19.5 M13 6 L19.5 12 L13 18');
    expect(html).toContain('stroke="#123456"');
    expect(html).toContain('stroke-width="1.8"');
    expect(html).toContain('stroke-linecap="round"');
    expect(html).toContain('stroke-linejoin="round"');
    expect(html).not.toContain('→');
    expect(source).not.toContain('accessible={false}');
    expect(source).not.toContain('pointerEvents="none"');
    expect(source).toMatch(/arrow:\s*\{[^}]*pointerEvents: 'none'/);
    expect(source).not.toMatch(/arrow:\s*\{[^}]*\btop:/);
  });

  it('owns the approved 6px space and centered row alignment', () => {
    expect(linkArrowRow).toEqual({
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    });
  });

  it('keeps the final word and approved arrow together when a label wraps', () => {
    const html = renderToStaticMarkup(
      <LinkArrowLabel label="Minnesota campaign finance downloads" />,
    );

    expect(html).toContain('Minnesota campaign finance ');
    expect(html).toContain('downloads');
    expect(html).toContain('stroke="#0f7a45"');
    expect(source).toMatch(/keepTogether:\s*\{[^}]*display: 'inline-flex'/);
    expect(source).toMatch(/keepTogether:\s*\{[^}]*alignItems: 'center'/);
    expect(source).toMatch(/inlineArrow:\s*\{[^}]*marginLeft: 6/);
    expect(source).not.toMatch(/inlineArrow:\s*\{[^}]*verticalAlign:/);
  });

  it('does not let green links override the approved arrow color or size', () => {
    const html = renderToStaticMarkup(<GreenLinkArrow />);

    expect(html).toContain('width="19"');
    expect(html).toContain('height="19"');
    expect(html).toContain('stroke="#0f7a45"');
  });
});
