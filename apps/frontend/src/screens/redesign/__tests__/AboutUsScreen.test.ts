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
});
