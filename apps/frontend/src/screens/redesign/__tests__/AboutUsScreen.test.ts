import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SCREEN = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'AboutUsScreen.tsx'),
  'utf8',
);

describe('About us screen contract', () => {
  it('explains the name and the public-record promise in plain words', () => {
    expect(SCREEN).toContain('TRUTH, UNCONCEALED');
    expect(SCREEN).toContain('Minnesota’s public record, in everyday words and');
    expect(SCREEN).toContain('linked to the source.');
    expect(SCREEN).toContain('Alethical comes from');
    expect(SCREEN).toContain('ancient Greek');
    expect(SCREEN).toContain('truth brought into the open');
  });

  it('keeps all 6 beliefs and all 6 roadmap items', () => {
    expect(SCREEN).toContain('const BELIEFS = [');
    expect(SCREEN).toContain('const ROADMAP_ITEMS = [');
    expect(SCREEN.match(/beliefTitle: '/g)).toHaveLength(6);
    expect(SCREEN.match(/roadmapTitle: '/g)).toHaveLength(6);
    expect(SCREEN).toContain('Candidates, campaigns, and money');
    expect(SCREEN).toContain('Grounded Ask');
    expect(SCREEN).toContain('Claimed Profiles');
  });

  it('makes all 4 starting points real links and keeps roadmap items unlinked', () => {
    expect(SCREEN.match(/destination: '/g)).toHaveLength(4);
    expect(SCREEN).toContain('linkProps(item.href, item.onPress)');
    expect(SCREEN).not.toContain('linkProps(item.roadmap');
    expect(SCREEN).toContain(
      'See who represents you in the Minnesota House and Senate, and learn about their work and how to contact them.',
    );
  });

  it('uses the shared page frame and the existing Contact us route', () => {
    expect(SCREEN).toContain('<TopNav');
    expect(SCREEN).toContain('<Footer');
    expect(SCREEN).toContain("navigation.navigate('ContactUs')");
    expect(SCREEN).toContain('routePath.contactUs()');
  });

  it('keeps the page white and separates sections with the reference rhythm', () => {
    expect(SCREEN).toMatch(/page:\s*\{[^}]*backgroundColor: t\.colors\.surfaces\.base[^}]*\}/s);
    expect(SCREEN).toContain('<View style={styles.originDivider} />');
    expect(SCREEN).toContain('firstSection: { marginTop: 44 }');
    expect(SCREEN).toContain('section: { marginTop: 56 }');
    expect(SCREEN.match(/isMobile && styles\.mobileSection/g)).toHaveLength(6);
    expect(SCREEN).toMatch(
      /mobileSection:\s*\{[^}]*marginTop: 34[^}]*paddingTop: 26[^}]*borderTopWidth: 1/s,
    );
  });

  it('keeps tinted surfaces bounded to the intended panels', () => {
    expect(SCREEN).toContain("roadmapSurface: '#f7f8fa'");
    expect(SCREEN).toContain("subtleBorder: 'rgba(17,21,15,0.09)'");
    expect(SCREEN).toContain('borderRadius: 16');
    expect(SCREEN).toContain('paddingHorizontal: 32');
    expect(SCREEN).toContain('paddingVertical: 30');
    expect(SCREEN).toMatch(
      /roadmapPanelMobile:\s*\{[^}]*paddingHorizontal: 18[^}]*paddingVertical: 18[^}]*\}/s,
    );
  });

  it('makes each starting card respond to hover and keyboard focus', () => {
    expect(SCREEN).toContain('hovered && styles.startCardHovered');
    expect(SCREEN).toContain('focused && styles.startCardFocused');
    expect(SCREEN).toContain("borderColor: 'rgba(45,212,126,0.55)'");
    expect(SCREEN).toContain("boxShadow: '0 14px 34px rgba(17,21,15,0.10)'");
    expect(SCREEN).toContain("transitionProperty: 'border-color, box-shadow'");
    expect(SCREEN).toContain("transitionDuration: '160ms'");
  });

  it('keeps card arrows beside their titles', () => {
    expect(SCREEN).toContain('<LinkArrow color={t.colors.text.primary} />');
    expect(SCREEN).not.toContain('startCardArrow');
    expect(SCREEN).toMatch(/startCardHeader:\s*\{[^}]*alignSelf: 'flex-start'[^}]*gap: 8[^}]*\}/s);
    expect(SCREEN).not.toMatch(/startCardHeader:\s*\{[^}]*justifyContent/s);
  });

  it('lets body prose fill the content column and shortens the feedback label', () => {
    expect(SCREEN).toContain('proseSection: { marginTop: 56 }');
    expect(SCREEN).not.toContain('proseSection: { marginTop: 56, maxWidth: 850 }');
    expect(SCREEN).toContain("Feedback:{' '}");
    expect(SCREEN).not.toContain("Questions and feedback:{' '}");
  });
});
