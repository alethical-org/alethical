import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { SOCIAL_ACCOUNTS } from '../../lib/socialLinks';

const THEME_SOURCE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'primitives.tsx'),
  'utf8',
);
const LINK_SOURCE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'components', 'SocialIconLink.tsx'),
  'utf8',
);

describe('shared footer social marks', () => {
  it('reads the shared account order and keeps the accepted responsive spacing', () => {
    expect(THEME_SOURCE).toContain('SOCIAL_ACCOUNTS.map');
    expect(THEME_SOURCE).toContain('surface="footer"');
    expect(THEME_SOURCE).toContain("footerTopMobile: { flexDirection: 'column', gap: 32 }");
    expect(THEME_SOURCE).toContain("footerUtility: { alignItems: 'flex-end', gap: 28 }");
    expect(THEME_SOURCE).toContain("footerUtilityMobile: { alignItems: 'flex-start', gap: 20 }");
    expect(THEME_SOURCE).toContain("footerSocialLinks: { flexDirection: 'row', gap: 10 }");
    expect(THEME_SOURCE).toContain('footerSocialLinksMobile: { gap: 8 }');
  });

  it('keeps the accepted marks, optical sizes, circle sizes, and active colours', () => {
    for (const platform of ['linkedin', 'facebook', 'instagram', 'tiktok', 'youtube']) {
      expect(LINK_SOURCE).toContain(`platform === '${platform}'`);
    }
    expect(LINK_SOURCE).toContain('M18.244 2.25h3.308');
    expect(LINK_SOURCE).toContain('linkedin: 21');
    expect(LINK_SOURCE).toContain('facebook: 23');
    expect(LINK_SOURCE).toContain('instagram: 22');
    expect(LINK_SOURCE).toContain('x: 20');
    expect(LINK_SOURCE).toContain('tiktok: 20');
    expect(LINK_SOURCE).toContain('youtube: 23');
    expect(LINK_SOURCE).toContain('tiktok: 21,\n    youtube: 24,');
    expect(LINK_SOURCE).toContain('width: 42');
    expect(LINK_SOURCE).toContain('width: 44');
    expect(LINK_SOURCE).toContain("backgroundColor: 'rgba(255,255,255,0.07)'");
    expect(LINK_SOURCE).toContain("backgroundColor: 'rgba(255,255,255,0.16)'");
    expect(LINK_SOURCE).not.toContain('opacity:');
  });

  it('renders every listed account as a link, so no mark is unclickable', () => {
    expect(LINK_SOURCE).not.toContain('if (!social.url)');
    for (const social of SOCIAL_ACCOUNTS) {
      expect(social.url).toMatch(/^https:\/\//);
    }
  });
});
