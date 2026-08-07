import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const source = (path: string) => readFileSync(resolve(here, path), 'utf8');

const chipSource = source('../../components/VoteCountLinkChip.tsx');
const billCardSource = source('../../components/search/BillResultCard.tsx');
const mobileProfileSource = source('../../screens/redesign/LegislatorProfileMobileScreen.tsx');
const webProfileSource = source('../../screens/redesign/LegislatorProfileWebScreen.tsx');

describe('shared vote-count link chip', () => {
  it('shows an uppercase singular or plural count and renders nothing at zero', () => {
    expect(chipSource).toContain('if (count <= 0) return null');
    expect(chipSource).toContain("count === 1 ? 'VOTE' : 'VOTES'");
  });

  it('is a real link with the outlined glyph treatment', () => {
    expect(chipSource).toContain('...linkProps(href, onPress)');
    expect(chipSource).toContain('d="M5 20 V10 M12 20 V4 M19 20 V14"');
    expect(chipSource).toContain('aria-hidden');
    expect(chipSource).toContain('paddingVertical: 6');
    expect(chipSource).toContain('paddingLeft: 8');
    expect(chipSource).toContain('paddingRight: 11');
    expect(chipSource).toContain('borderColor: t.colors.alpha.ink16');
    expect(chipSource).toContain('fontFamily: t.typography.mono');
    expect(chipSource).toContain('fontSize: 11');
  });

  it('uses a measured 44px target at phone widths', () => {
    expect(chipSource).toContain('minHeight: 44');
    expect(chipSource).toContain('paddingVertical: 0');
    expect(chipSource).toContain('paddingLeft: 9');
    expect(chipSource).toContain('paddingRight: 12');
    expect(chipSource).toContain('fontSize: 12');
  });

  it('is the one vote-count control used by bill and legislator cards', () => {
    for (const consumer of [billCardSource, mobileProfileSource, webProfileSource]) {
      expect(consumer).toContain("import { VoteCountLinkChip } from '");
      expect(consumer).toContain('<VoteCountLinkChip');
    }

    expect(billCardSource).not.toContain('styles.rollCalls');
    expect(mobileProfileSource).not.toContain('VIEW VOTES');
    expect(webProfileSource).not.toContain('label="VIEW VOTES"');
  });
});
