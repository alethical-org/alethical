import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { HOME_BILL_GROUP_CONTINUATIONS } from '../homepage';

describe('home bill groups continue into the matching Bill Search view', () => {
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

  it('adds the 2 named group links to both desktop and mobile', () => {
    const source = readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        '../../screens/redesign/HomeSignedOutScreen.tsx',
      ),
      'utf8',
    );
    const [desktopSource, mobileSource = ''] = source.split('// MOBILE HOME');
    expect(desktopSource.match(/<BillGroupContinuationLink/g) ?? []).toHaveLength(2);
    expect(mobileSource.match(/<BillGroupContinuationLink/g) ?? []).toHaveLength(2);
    expect(mobileSource).toContain('HOME_BILL_GROUP_CONTINUATIONS.passed');
    expect(mobileSource).toContain('HOME_BILL_GROUP_CONTINUATIONS.introduced');
    expect(mobileSource).not.toContain('accessibilityLabel="See more Legislative Bill Activity"');
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

  it('keeps the 2 bill-group links distinct and removes the In the News continuation', () => {
    const source = readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        '../../screens/redesign/HomeSignedOutScreen.tsx',
      ),
      'utf8',
    );
    const [, mobileSource = ''] = source.split('// MOBILE HOME');

    expect(mobileSource).not.toContain('accessibilityLabel="See more In the News bills"');
    expect(mobileSource).not.toContain('<SeeMore');
    const labels = [
      HOME_BILL_GROUP_CONTINUATIONS.passed.label,
      HOME_BILL_GROUP_CONTINUATIONS.introduced.label,
    ];
    expect(new Set(labels).size).toBe(2);
  });

  it('uses the complete Find My Legislator description in both homepage layouts', () => {
    const source = readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        '../../screens/redesign/HomeSignedOutScreen.tsx',
      ),
      'utf8',
    ).replace(/\s+/g, ' ');
    const description =
      'See who represents you in the Minnesota House and Senate, and learn about their work and how to contact them.';

    expect(source.split(description)).toHaveLength(3);
  });
});
