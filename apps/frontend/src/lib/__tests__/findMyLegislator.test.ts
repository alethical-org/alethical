import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  FIND_MY_LEGISLATOR_INSTRUCTIONS,
  addressSuggestionInput,
  addressSuggestionResultsAreCurrent,
  addressChoiceKey,
  confirmedAddressForLookup,
  contactEmail,
  legislatureLabel,
  retryWaitSeconds,
  senateProfileUrl,
  viewStateForLookup,
} from '../findMyLegislator';

describe('Find My Legislator state and copy helpers', () => {
  it('uses the complete address instructions at every screen width', () => {
    expect(FIND_MY_LEGISLATOR_INSTRUCTIONS).toBe(
      'Enter a full street address. Cities and ZIP codes can cross district lines.',
    );

    const source = readFileSync(
      join(__dirname, '..', '..', 'screens', 'FindMyLegislatorScreen.tsx'),
      'utf8',
    );
    expect(source).toContain('{FIND_MY_LEGISLATOR_INSTRUCTIONS}');
  });

  it('keeps all 10 page states distinct', () => {
    expect([
      viewStateForLookup({}),
      viewStateForLookup({ pending: true }),
      viewStateForLookup({ found: true }),
      viewStateForLookup({ choices: 2 }),
      viewStateForLookup({ error: 'not-found' }),
      viewStateForLookup({ error: 'outside-minnesota' }),
      viewStateForLookup({ error: 'location' }),
      viewStateForLookup({ found: true, vacant: true }),
      viewStateForLookup({ error: 'rate-limited' }),
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
      'rate-limited',
      'service-down',
    ]);
  });

  it('uses a safe 60-second maximum for the lookup wait', () => {
    expect(retryWaitSeconds()).toBe(60);
    expect(retryWaitSeconds(7)).toBe(7);
    expect(retryWaitSeconds(0)).toBe(1);
    expect(retryWaitSeconds(99)).toBe(60);
  });

  it('moves, selects, and closes address choices from the keyboard', () => {
    expect(addressChoiceKey('ArrowDown', 0, 4)).toEqual({ index: 1, action: 'move' });
    expect(addressChoiceKey('ArrowUp', 0, 4)).toEqual({ index: 3, action: 'move' });
    expect(addressChoiceKey('Enter', 2, 4)).toEqual({ index: 2, action: 'choose' });
    expect(addressChoiceKey('Escape', 2, 4)).toEqual({ index: 2, action: 'close' });
  });

  it('starts suggestions only after a house number and two street letters', () => {
    expect(addressSuggestionInput('3040 Ex')).toBe('3040 Ex');
    expect(addressSuggestionInput('3040 E Ex')).toBe('3040 E Ex');
    expect(addressSuggestionInput('350 S 5')).toBe('350 S 5');
    expect(addressSuggestionInput('350 Su')).toBe('350 Su');
    expect(addressSuggestionInput('350 S')).toBeUndefined();
    expect(addressSuggestionInput('3040 E')).toBeUndefined();
    expect(addressSuggestionInput('3040 X')).toBeUndefined();
    expect(addressSuggestionInput('Excelsior')).toBeUndefined();
  });

  it('never shows an older suggestion reply after the address changes', () => {
    expect(addressSuggestionResultsAreCurrent('3040 Ex', '3040 Ex')).toBe(true);
    expect(addressSuggestionResultsAreCurrent('3040 Exc', '3040 Ex')).toBe(false);
    expect(addressSuggestionResultsAreCurrent('', '3040 Ex')).toBe(false);
  });

  it('wires the address choices to real web keyboard, hover, and selected-value behavior', () => {
    const source = readFileSync(
      join(__dirname, '..', '..', 'screens', 'FindMyLegislatorScreen.tsx'),
      'utf8',
    );

    expect(source).toContain('onKeyDownCapture: onChoiceKey');
    expect(source).toContain("if (event.nativeEvent?.key === 'Enter') return;");
    expect(source).not.toContain('onKeyPress={onChoiceKey}');
    expect(source).toContain('setAddress(choice.matchedAddress)');
    expect(source).toContain('onHoverIn={() => setChoiceIndex(index)}');
    expect(source).toContain('useDebouncedSearchCommit(');
    expect(source).toContain('useAddressSuggestions(');
    expect(source).toContain("'aria-autocomplete': 'list'");
    expect(source).toContain('Suggested addresses');
    expect(source).toContain('Finding matching addresses…');
    expect(source).toContain('No matching Minnesota addresses yet. Keep typing.');
    expect(source).not.toContain('Finding matching Minnesota addresses…');
    expect(source).not.toContain('Keep typing or choose Find.');
    expect(source).toContain('FIND_MY_LEGISLATOR_INSTRUCTIONS');
    expect(source).toContain('if (!lookup.error && !clientError) setSuggestionsOpen(true)');
    expect(source).toContain('<Text style={styles.choiceKey}>↑</Text>');
    expect(source).toContain('<Text style={styles.choiceKey}>↓</Text>');
    expect(source).toContain('<Text style={styles.choiceKey}>Enter</Text>');
    expect(source).not.toContain('<Text style={styles.choiceKey}>Esc</Text>');
    expect(source).toContain('{choices.length > 1 ? (');
  });

  it('replaces only a successful typed address with the confirmed address', () => {
    const confirmedResult = {
      status: 'found' as const,
      address: '350 ST PETER ST, SAINT PAUL, MN, 55102',
    };

    expect(
      confirmedAddressForLookup(
        '350 St Peer St, St. Paul, MN 55102',
        confirmedResult,
        '350 St Peer St, St. Paul, MN 55102',
      ),
    ).toBe('350 ST PETER ST, SAINT PAUL, MN, 55102');
    expect(
      confirmedAddressForLookup({ latitude: 44.94493, longitude: -93.09528 }, confirmedResult, ''),
    ).toBeUndefined();
    expect(
      confirmedAddressForLookup(
        '350 St Peer St, St. Paul, MN 55102',
        {
          status: 'address-choice',
          address: '350 St Peer St, St. Paul, MN 55102',
        },
        '350 St Peer St, St. Paul, MN 55102',
      ),
    ).toBeUndefined();
    expect(
      confirmedAddressForLookup(
        '350 St Peer St, St. Paul, MN 55102',
        confirmedResult,
        '700 W 7th St, St. Paul, MN 55102',
      ),
    ).toBeUndefined();

    const source = readFileSync(
      join(__dirname, '..', '..', 'screens', 'FindMyLegislatorScreen.tsx'),
      'utf8',
    );
    expect(source).toContain('confirmedAddressForLookup(lookup.variables, settledResult, address)');
    expect(source).toContain('setAddress(confirmedAddress)');
    expect(source).toContain('autoRanFor.current = confirmedAddress');
    expect(source).toMatch(/navigation\.setParams\(\{\s*address: confirmedAddress/);
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
    expect(source).not.toContain('This product uses the Census Bureau Data API');
    expect(source).not.toContain('styles.notices');
    expect(source).not.toContain('Every address has one House district and one Senate district');
    expect(source).not.toContain('<Text style={styles.sourceText}>Source: </Text>');
    expect(source).not.toContain('https://www.leg.mn.gov/');
    expect(source).not.toContain('https://www.revisor.mn.gov/');
    expect(source).not.toContain('formatSourceDate');
    expect(source).toContain('Looking up districts');
    expect(source).not.toContain('Looking up your districts');
    expect(source).toContain('setShimmerEnabled(true)');
    expect(source).toContain("role: 'combobox'");
    expect(source).toContain("role: 'listbox'");
    expect(source).toContain("role: 'option'");
    expect(source).toContain('aria-activedescendant');
    expect(source).toContain('onKeyDownCapture: onChoiceKey');
    expect(source).toMatch(/const runCoordinate[\s\S]*setChoiceClosed\(true\)/);
    expect(source).toContain(
      'Enter a house number and street name, like 350 S 5th St, Minneapolis, MN 55415',
    );
    expect(source).not.toContain(
      'Enter a house number and street name, like 350 S 5th St, Minneapolis, MN 55415.',
    );
    expect(source).toContain('LOCATION_ERROR_ID');
    expect(source).toContain('onOutsideMinnesota');
    expect(source).toContain("alignItems: 'flex-start'");
    expect(source).toContain("inputShellMobile: { width: '100%' }");
    expect(source).toContain('addressInputRef.current?.focus()');
    expect(source).toContain("field: 'Too many lookups'");
    expect(source).toContain("answer: 'Try again in up to 60 seconds'");
    expect(source).not.toContain("answer: 'Try again in up to 60 seconds.'");
    expect(source).toContain('disabled={lookupDisabled}');
    expect(source).toContain('disabled={locationDisabled}');
    expect(source).toContain('Try again in ${rateLimitSeconds}s');
    expect(source).not.toContain('Your Minnesota legislators will appear here.');
    expect(source).not.toContain('Matching it to Minnesota districts…');
    expect(source).not.toContain('neighborhood');
    expect(source).not.toContain('borderLeftWidth: 4');
  });

  it('gives phone member cards a definite full width for their primary action', () => {
    const source = readFileSync(
      join(__dirname, '..', '..', 'screens', 'FindMyLegislatorScreen.tsx'),
      'utf8',
    );

    expect(source).toMatch(/cards:\s*\{[^}]*alignItems: 'flex-start'/);
    expect(source).toMatch(
      /cardsMobile:\s*\{[^}]*flexDirection: 'column'[^}]*alignItems: 'stretch'[^}]*gap: 12/,
    );
    expect(source.match(/<VacantSeatCard[\s\S]*?mobile=\{isMobile\}/g)).toHaveLength(2);
  });

  it('shares matching row heights between the 2 desktop member cards only', () => {
    const source = readFileSync(
      join(__dirname, '..', '..', 'screens', 'FindMyLegislatorScreen.tsx'),
      'utf8',
    );

    expect(source).toContain("gridTemplateColumns: 'repeat(2, minmax(0, 1fr))'");
    expect(source).toContain('const alignRepresentativeSections = Boolean(');
    expect(source.match(/alignSections=\{alignRepresentativeSections\}/g)).toHaveLength(2);
  });

  it('matches the accepted result summary on desktop and phone', () => {
    const source = readFileSync(
      join(__dirname, '..', '..', 'screens', 'FindMyLegislatorScreen.tsx'),
      'utf8',
    );
    const summaryHeading = source.indexOf('Your Minnesota legislators');
    const mobileDistrictChips = source.indexOf('{isMobile &&', summaryHeading);
    const nestingSentence = source.indexOf('<Text style={styles.nesting}>', summaryHeading);

    expect(source).toContain('<View aria-hidden style={styles.foundHeaderPin}>');
    expect(source).toContain(
      'd="M12 21 C 12 21 5 14.5 5 9.5 A7 7 0 0 1 19 9.5 C 19 14.5 12 21 12 21 Z"',
    );
    expect(source).toMatch(/!isMobile \? \([\s\S]*styles\.foundHeaderPin/);
    expect(source).toMatch(/isMobile &&[\s\S]*<DistrictChips[\s\S]*mobile/);
    expect(source).toMatch(/!isMobile &&[\s\S]*<DistrictChips[\s\S]*mobile=\{false\}/);
    expect(summaryHeading).toBeLessThan(mobileDistrictChips);
    expect(mobileDistrictChips).toBeLessThan(nestingSentence);
    expect(source).toContain("backgroundColor: '#ffffff'");
    expect(source).toContain("senateDistrictChip: { borderColor: '#d8c9f7', color: '#5b30d6' }");
    expect(source).toContain("houseDistrictChip: { borderColor: '#bfeacf', color: '#0f7a45' }");
    expect(source).toContain('districtArrowMobile: { fontSize: 11 }');
  });

  it('keeps the accepted result mounted while a map-selected lookup is pending', () => {
    const source = readFileSync(
      join(__dirname, '..', '..', 'screens', 'FindMyLegislatorScreen.tsx'),
      'utf8',
    );

    expect(source).toContain(
      'const retainedMapResult = retainLastFoundResult ? lastFoundResult.current : undefined',
    );
    expect(source).toContain('const displayedResult = retainedMapResult ?? settledResult');
    expect(source).toContain("state === 'looking' && !retainedMapResult");
    expect(source).toContain("const mapUpdateLabel = lookup.isPending ? 'Updating districts'");
    expect(source).toContain('accessibilityLabel={mapUpdateLabel}');
    expect(source).toContain('styles.mapUpdatingOverlay');
  });

  it('keeps the accepted result mounted when a map-selected lookup fails', () => {
    const source = readFileSync(
      join(__dirname, '..', '..', 'screens', 'FindMyLegislatorScreen.tsx'),
      'utf8',
    );

    expect(source).toMatch(
      /const retainLastFoundResult =\s*preserveMapViewport[\s\S]*lookup\.isPending[\s\S]*lookup\.error[\s\S]*clientError/,
    );
    expect(source).toContain('activeError && !retainedMapResult');
    expect(source).toContain("'Couldn’t update districts'");
  });

  it('keeps the reader at the same page position while lookup content appears', () => {
    const source = readFileSync(
      join(__dirname, '..', '..', 'screens', 'FindMyLegislatorScreen.tsx'),
      'utf8',
    );

    expect(source).toContain('const preserveLookupScrollStyle = isWeb');
    expect(source).toContain("overflowAnchor: 'none'");
    expect(source).toContain('style={[styles.scroll, preserveLookupScrollStyle]}');
  });
});
