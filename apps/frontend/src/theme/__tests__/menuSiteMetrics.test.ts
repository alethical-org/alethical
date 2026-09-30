import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { IA, navDropdownItems } from '../../navigation/ia';

const SOURCE = readFileSync(join(__dirname, '..', 'primitives.tsx'), 'utf8');

describe('Site Metrics is a private account destination', () => {
  it('is absent from the public About menu', () => {
    expect(navDropdownItems('about').live.map((item) => item.id)).toEqual([
      'about-us',
      'about-contact',
    ]);
    expect(IA.some((item) => item.id === 'about-site-metrics')).toBe(false);
  });

  it('does not carry an unused public dropdown icon', () => {
    expect(SOURCE).not.toContain("itemId === 'about-site-metrics'");
  });
});
