import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'primitives.tsx'),
  'utf8',
);

describe('shared footer social marks', () => {
  it('keeps the accepted optical sizes, LinkedIn centering, and responsive circles', () => {
    const glyphs = SOURCE.match(
      /function FooterSocialGlyph[\s\S]*?\n\}\n\nfunction FooterSocialLink/,
    )?.[0];
    const facebook = glyphs?.match(
      /if \(platform === 'facebook'\) \{[\s\S]*?\n  \}\n  if \(platform === 'linkedin'\)/,
    )?.[0];
    const linkedin = glyphs?.match(
      /if \(platform === 'linkedin'\) \{[\s\S]*?\n  \}\n  return \(/,
    )?.[0];
    const circle = SOURCE.match(/footerSocialLink: \{[\s\S]*?\n  \},/)?.[0];
    const phoneCircle = SOURCE.match(/footerSocialLinkMobile: \{[\s\S]*?\n  \},/)?.[0];

    expect(facebook).toContain('width={23} height={23} viewBox="0 0 24 24"');
    expect(linkedin).toContain('width={21} height={21} viewBox="0.87 2.87 22 22"');
    expect(linkedin).not.toContain('M22.22 0H1.77');
    expect(glyphs).toContain('width={20} height={20} viewBox="0 0 24 24"');
    expect(circle).toContain('width: 42');
    expect(circle).toContain('height: 42');
    expect(phoneCircle).toContain('width: 44');
    expect(phoneCircle).toContain('height: 44');
    expect(SOURCE).toContain('mobile && styles.footerSocialLinkMobile');
    expect(SOURCE).toContain(
      '<FooterSocialLink key={social.platform} social={social} mobile={isMobile} />',
    );
  });
});
