import { describe, expect, it } from 'vitest';

import {
  homeAddressDestination,
  homeFinderLayout,
  homeFinderRequestState,
  homeLocationDestination,
  homeLocationFailureDestination,
  locationFailureFromBrowserError,
} from '../homeLegislatorFinder';
import { prepareAddressLookup } from '../findMyLegislator';

describe('homepage Find My Legislator handoff', () => {
  it('preserves the typed address for display and trims only the service request', () => {
    expect(prepareAddressLookup('  350 S 5th St, Minneapolis, MN 55415  ')).toEqual({
      displayAddress: '  350 S 5th St, Minneapolis, MN 55415  ',
      serviceAddress: '350 S 5th St, Minneapolis, MN 55415',
    });
    expect(prepareAddressLookup('   ')).toEqual({
      displayAddress: '   ',
      serviceAddress: undefined,
    });
  });

  it('navigates with the raw non-empty address and clears temporary location data', () => {
    expect(homeAddressDestination(' 350 S 5th St ')).toEqual({
      address: ' 350 S 5th St ',
      coordinate: undefined,
      lookupAddress: true,
      locationFailure: undefined,
    });
  });

  it('navigates an empty Find without starting the next page focused', () => {
    expect(homeAddressDestination('   ')).toEqual({
      address: undefined,
      coordinate: undefined,
      lookupAddress: undefined,
      locationFailure: undefined,
    });
  });

  it('hands a Minnesota location to the full page without an address', () => {
    expect(homeLocationDestination({ latitude: 44.97683, longitude: -93.26579 })).toEqual({
      address: undefined,
      coordinate: { latitude: 44.97683, longitude: -93.26579 },
      lookupAddress: undefined,
      locationFailure: undefined,
    });
  });

  it('turns an outside-Minnesota location into a temporary page failure', () => {
    expect(homeLocationDestination({ latitude: 41.8781, longitude: -87.6298 })).toEqual({
      address: undefined,
      coordinate: undefined,
      lookupAddress: undefined,
      locationFailure: 'outside-minnesota',
    });
  });

  it.each([
    [1, 'permission-denied'],
    [2, 'unavailable'],
    [3, 'timeout'],
    [99, 'unknown'],
    [undefined, 'unknown'],
  ] as const)('maps browser location error %s to %s', (code, expected) => {
    expect(locationFailureFromBrowserError({ code })).toBe(expected);
  });

  it('carries unsupported location as temporary failure details', () => {
    expect(homeLocationFailureDestination('unsupported')).toEqual({
      address: undefined,
      coordinate: undefined,
      lookupAddress: undefined,
      locationFailure: 'unsupported',
    });
  });

  it('locks both actions while location is pending and resets after any answer', () => {
    expect(homeFinderRequestState('idle', 'start-location')).toBe('waiting-location');
    expect(homeFinderRequestState('waiting-location', 'start-location')).toBe('waiting-location');
    expect(homeFinderRequestState('waiting-location', 'settle-location')).toBe('idle');
  });

  it('uses the 3 accepted layout rules at their exact breakpoints', () => {
    expect(homeFinderLayout(767)).toBe('phone');
    expect(homeFinderLayout(768)).toBe('tablet');
    expect(homeFinderLayout(1099)).toBe('tablet');
    expect(homeFinderLayout(1100)).toBe('desktop');
  });
});
