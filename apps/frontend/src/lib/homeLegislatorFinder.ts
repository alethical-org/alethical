import { isCoordinateInMinnesota } from '../data/minnesotaBoundary';
import type { RepresentativeLookupCoordinates } from '../data/types';
import { prepareAddressLookup } from './findMyLegislator';

export type HomeFinderLayout = 'phone' | 'tablet' | 'desktop';
export type HomeFinderRequestState = 'idle' | 'waiting-location';
export type HomeLocationFailure =
  | 'unsupported'
  | 'permission-denied'
  | 'timeout'
  | 'unavailable'
  | 'outside-minnesota'
  | 'unknown';

export type HomeFinderDestination = {
  address?: string;
  coordinate?: RepresentativeLookupCoordinates;
  focusAddress?: true;
  lookupAddress?: true;
  locationFailure?: HomeLocationFailure;
};

const clearedDestination: HomeFinderDestination = {
  address: undefined,
  coordinate: undefined,
  focusAddress: undefined,
  lookupAddress: undefined,
  locationFailure: undefined,
};

export function homeAddressDestination(rawAddress: string): HomeFinderDestination {
  const { serviceAddress } = prepareAddressLookup(rawAddress);
  return serviceAddress
    ? { ...clearedDestination, address: rawAddress, lookupAddress: true }
    : { ...clearedDestination, focusAddress: true };
}

export function homeLocationDestination(
  coordinate: RepresentativeLookupCoordinates,
): HomeFinderDestination {
  return isCoordinateInMinnesota(coordinate)
    ? { ...clearedDestination, coordinate }
    : { ...clearedDestination, locationFailure: 'outside-minnesota' };
}

export function homeLocationFailureDestination(
  locationFailure: HomeLocationFailure,
): HomeFinderDestination {
  return { ...clearedDestination, locationFailure };
}

export function locationFailureFromBrowserError(error?: { code?: number }): HomeLocationFailure {
  if (error?.code === 1) return 'permission-denied';
  if (error?.code === 2) return 'unavailable';
  if (error?.code === 3) return 'timeout';
  return 'unknown';
}

export function homeFinderRequestState(
  state: HomeFinderRequestState,
  action: 'start-location' | 'settle-location',
): HomeFinderRequestState {
  if (action === 'settle-location') return 'idle';
  return state === 'idle' ? 'waiting-location' : state;
}

export function homeFinderLayout(width: number): HomeFinderLayout {
  if (width < 768) return 'phone';
  if (width < 1100) return 'tablet';
  return 'desktop';
}
