import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { HOME_BILL_GROUP_CONTINUATIONS } from '../homepage';

describe('desktop bill groups continue into the matching Bill Search view', () => {
  it('uses unique names and preserves each group’s filter and order', () => {
    expect(HOME_BILL_GROUP_CONTINUATIONS).toEqual({
      passed: {
        label: 'See more recently passed',
        params: { status: 'signed_into_law', sort: 'action' },
      },
      introduced: {
        label: 'See more recently introduced',
        params: { sort: 'introduced' },
      },
    });
  });

  it('adds the 2 group links only to desktop and keeps mobile’s section-level action', () => {
    const source = readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        '../../screens/redesign/HomeSignedOutScreen.tsx',
      ),
      'utf8',
    );
    const [desktopSource, mobileSource = ''] = source.split('// MOBILE HOME');
    expect(desktopSource.match(/<BillGroupContinuationLink/g) ?? []).toHaveLength(2);
    expect(mobileSource).not.toContain('<BillGroupContinuationLink');
    expect(mobileSource).toContain('<SeeMore');
  });

  it('attaches the mobile in-page jump to the top of bill activity while it loads and after it loads', () => {
    const source = readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        '../../screens/redesign/HomeSignedOutScreen.tsx',
      ),
      'utf8',
    );
    const [, mobileSource = ''] = source.split('// MOBILE HOME');
    expect(
      mobileSource.match(/<Text ref=\{billActivityRef\} style=\{m\.eyebrow\}>/g) ?? [],
    ).toHaveLength(2);
  });

  it('keeps 1 main mobile heading and marks the section headings as level 2', () => {
    const source = readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        '../../screens/redesign/HomeSignedOutScreen.tsx',
      ),
      'utf8',
    );
    const [, mobileSource = ''] = source.split('// MOBILE HOME');

    expect(mobileSource).toMatch(
      /accessibilityRole="header" aria-level=\{2\} style=\{m\.sectionH2\}>\s*Legislative Bill Activity/,
    );
    expect(mobileSource).toMatch(
      /accessibilityRole="header" aria-level=\{2\} style=\{m\.finderH2\}>\s*Find My Legislator/,
    );
  });

  it('gives the 2 visible See more links distinct spoken names', () => {
    const source = readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        '../../screens/redesign/HomeSignedOutScreen.tsx',
      ),
      'utf8',
    );
    const [, mobileSource = ''] = source.split('// MOBILE HOME');

    expect(mobileSource).toContain('accessibilityLabel="See more In the News bills"');
    expect(mobileSource).toContain('accessibilityLabel="See more Legislative Bill Activity"');
  });
});
