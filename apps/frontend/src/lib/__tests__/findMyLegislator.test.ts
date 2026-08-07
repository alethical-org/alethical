import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  addressChoiceKey,
  contactEmail,
  districtMapVisible,
  legislatureLabel,
  senateProfileUrl,
  viewStateForLookup,
} from '../findMyLegislator';

describe('Find My Legislator state and copy helpers', () => {
  it('keeps all 9 page states distinct', () => {
    expect([
      viewStateForLookup({}),
      viewStateForLookup({ pending: true }),
      viewStateForLookup({ found: true }),
      viewStateForLookup({ choices: 2 }),
      viewStateForLookup({ error: 'not-found' }),
      viewStateForLookup({ error: 'outside-minnesota' }),
      viewStateForLookup({ error: 'location' }),
      viewStateForLookup({ found: true, vacant: true }),
      viewStateForLookup({ error: 'service-down' }),
    ]).toEqual([
      'empty',
      'looking',
      'found',
      'choice',
      'not-found',
      'outside-minnesota',
      'location-error',
      'vacant',
      'service-down',
    ]);
  });

  it('moves, selects, and closes address choices from the keyboard', () => {
    expect(addressChoiceKey('ArrowDown', 0, 4)).toEqual({ index: 1, action: 'move' });
    expect(addressChoiceKey('ArrowUp', 0, 4)).toEqual({ index: 3, action: 'move' });
    expect(addressChoiceKey('Enter', 2, 4)).toEqual({ index: 2, action: 'choose' });
    expect(addressChoiceKey('Escape', 2, 4)).toEqual({ index: 2, action: 'close' });
  });

  it('uses the shared short Legislature range', () => {
    expect(legislatureLabel('94th Legislature (2025–2026) Regular Session')).toBe(
      '94TH LEGISLATURE (2025–26)',
    );
    expect(legislatureLabel('94th Legislature (2025 - 2026) Regular Session')).toBe(
      '94TH LEGISLATURE (2025–26)',
    );
  });

  it('normalizes official email and old Senate links without inventing contact details', () => {
    expect(contactEmail('mailto:rep.esther.agbaje@house.mn.gov')).toBe(
      'rep.esther.agbaje@house.mn.gov',
    );
    expect(contactEmail('https://www.senate.mn/members/email-form/123')).toBeUndefined();
    expect(
      senateProfileUrl('http://www.senate.leg.state.mn.us/members/member_bio.php?leg_id=15245'),
    ).toBe('https://www.senate.mn/members/member_bio.html?leg_id=15245');
  });

  it('does not mount map tiles on a collapsed phone panel', () => {
    expect(districtMapVisible(false, false)).toBe(true);
    expect(districtMapVisible(true, false)).toBe(false);
    expect(districtMapVisible(true, true)).toBe(true);
  });

  it('keeps the accepted result panel and lookup-control treatment together', () => {
    const source = readFileSync(
      join(__dirname, '..', '..', 'screens', 'FindMyLegislatorScreen.tsx'),
      'utf8',
    );

    expect(source).toContain('linear-gradient(180deg,#f2f9f5 0%,#ffffff 100%)');
    expect(source).toContain('<Search size={17} color="#06231a" aria-hidden />');
    expect(source).toMatch(/<Crosshair\s+size=\{mobile \? 18 : 19\}/);
    expect(source).toContain('const locationLabel = findingLocation');
    expect(source).toContain('Finding your location…');
    expect(source).toContain("backgroundColor: '#2ed47e'");
    expect(source).toContain("color: '#06231a'");
    expect(source).not.toContain('disabled={!address.trim()');
    expect(source).not.toContain('Minnesota district shapes are provided by Minnesota GIS.');
    expect(source).toContain('Every address has one House district and one Senate district');
    expect(source).toContain('Looking up your districts');
    expect(source).toContain('setShimmerEnabled(true)');
    expect(source).toContain("role: 'combobox'");
    expect(source).toContain("role: 'listbox'");
    expect(source).toContain("role: 'option'");
    expect(source).toContain('aria-activedescendant');
    expect(source).toContain('onKeyPress={onChoiceKey}');
    expect(source).toMatch(/const runCoordinate[\s\S]*setChoiceClosed\(true\)/);
    expect(source).toContain(
      'Enter a house number and street name, like 350 S 5th St, Minneapolis, MN 55415.',
    );
    expect(source).toContain('LOCATION_ERROR_ID');
    expect(source).toContain('onOutsideMinnesota');
    expect(source).toContain("alignItems: 'flex-start'");
    expect(source).toContain("inputShellMobile: { width: '100%' }");
    expect(source).toContain('addressInputRef.current?.focus()');
    expect(source).toContain('paddingLeft: 17');
    expect(source).not.toContain('Your Minnesota legislators will appear here.');
    expect(source).not.toContain('Matching it to Minnesota districts…');
    expect(source).not.toContain('neighborhood');
    expect(source).not.toContain('borderLeftWidth: 4');
  });
});
