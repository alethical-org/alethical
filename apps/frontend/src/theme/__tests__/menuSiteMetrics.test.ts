import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { IA, navDropdownItems } from '../../navigation/ia';

const SOURCE = readFileSync(join(__dirname, '..', 'primitives.tsx'), 'utf8');

describe('Site Metrics in the About menu', () => {
  it('is a live row directly above Contact Us', () => {
    expect(navDropdownItems('about').live.map((item) => item.id)).toEqual([
      'about-us',
      'about-site-metrics',
      'about-contact',
    ]);
    expect(IA.find((item) => item.id === 'about-site-metrics')).toMatchObject({
      label: 'Site Metrics',
      path: '/site-metrics',
    });
  });

  it('uses the approved decorative 3-bar geometry inside the existing icon tile', () => {
    expect(SOURCE).toContain("itemId === 'about-site-metrics'");
    expect(SOURCE).toContain('d="M7 18V14" stroke={c} strokeWidth={2} strokeLinecap="round"');
    expect(SOURCE).toContain('d="M12 18V10.5" stroke={c} strokeWidth={2} strokeLinecap="round"');
    expect(SOURCE).toContain('d="M17 18V7" stroke={c} strokeWidth={2} strokeLinecap="round"');
    expect(SOURCE).toContain('aria-hidden');
  });
});
