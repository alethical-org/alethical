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

  it('adds the signed-out phone search band between the news and bill activity sections', () => {
    const source = readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        '../../screens/redesign/HomeSignedOutScreen.tsx',
      ),
      'utf8',
    );
    const [, mobileSource = ''] = source.split('// MOBILE HOME');
    const newsIndex = mobileSource.indexOf('IN THE NEWS');
    const bandIndex = mobileSource.indexOf('m.searchActionsBand');
    const activityIndex = mobileSource.indexOf('LEGISLATIVE BILL ACTIVITY');

    expect(newsIndex).toBeGreaterThan(-1);
    expect(bandIndex).toBeGreaterThan(newsIndex);
    expect(activityIndex).toBeGreaterThan(bandIndex);
    expect(mobileSource).toMatch(
      /\{!isSignedIn \? \(\s*<View style=\{\[m\.searchActionsBand, searchBandGradientWeb\]\}>/,
    );

    const bandSource = mobileSource.slice(bandIndex, activityIndex);
    expect(bandSource.match(/<HeroEntryButton/g) ?? []).toHaveLength(2);
    expect(bandSource).toContain('label="Search Bills"');
    expect(bandSource).toContain('href={routePath.bills()}');
    expect(bandSource).toContain('label="Search Legislators"');
    expect(bandSource).toContain('href={routePath.legislators()}');
    expect(mobileSource).toContain(
      'linear-gradient(180deg,#eaf6ef 0%,#edf6f1 30%,#f2f7f5 62%,#f6f8f8 84%,${t.colors.surfaces.s200} 100%)',
    );
    expect(mobileSource).toMatch(
      /searchActionsBand:\s*\{[\s\S]*?marginTop: 64,[\s\S]*?paddingTop: 40,[\s\S]*?paddingRight: 20,[\s\S]*?paddingBottom: 64,[\s\S]*?paddingLeft: 20,[\s\S]*?gap: 12,[\s\S]*?\}/,
    );
    expect(mobileSource).toMatch(
      /searchActionLink:\s*\{[\s\S]*?minHeight: 59,[\s\S]*?borderRadius: 14,[\s\S]*?\}/,
    );
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
