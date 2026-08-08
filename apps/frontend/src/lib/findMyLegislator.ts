import type { RepresentativeLookupInput, RepresentativeLookupResult } from '../data/types';
import { formatLegislatureLabel, type SessionDisplaySource } from './sessionLabel';

export type FindLegislatorState =
  | 'empty'
  | 'looking'
  | 'found'
  | 'choice'
  | 'not-found'
  | 'outside-minnesota'
  | 'location-error'
  | 'vacant'
  | 'rate-limited'
  | 'service-down';

export const FIND_MY_LEGISLATOR_INSTRUCTIONS =
  "Enter a full street address — a city or ZIP code alone can't identify your legislators";

export function prepareAddressLookup(rawAddress: string): {
  displayAddress: string;
  serviceAddress: string | undefined;
} {
  const serviceAddress = rawAddress.trim();
  return {
    displayAddress: rawAddress,
    serviceAddress: serviceAddress || undefined,
  };
}

const STREET_DIRECTIONS = new Set([
  'N',
  'S',
  'E',
  'W',
  'NE',
  'NW',
  'SE',
  'SW',
  'NORTH',
  'SOUTH',
  'EAST',
  'WEST',
  'NORTHEAST',
  'NORTHWEST',
  'SOUTHEAST',
  'SOUTHWEST',
]);

export function addressSuggestionInput(rawAddress: string): string | undefined {
  const address = rawAddress.trim();
  const streetLine = address.split(/[,;]/, 1)[0];
  const match = streetLine.match(/^\d+[A-Z]?\s+(.+)$/i);
  if (!match) return undefined;

  const streetTokens = match[1].match(/[A-Z0-9]+/gi) ?? [];
  while (streetTokens.length && STREET_DIRECTIONS.has((streetTokens[0] ?? '').toUpperCase())) {
    streetTokens.shift();
  }
  const streetPrefix = streetTokens.join('');
  return streetPrefix.length >= 2 || /^\d+$/.test(streetPrefix) ? address : undefined;
}

export function addressSuggestionResultsAreCurrent(
  currentInput: string,
  requestedInput: string,
): boolean {
  return Boolean(currentInput) && currentInput === requestedInput;
}

export function confirmedAddressForLookup(
  input: RepresentativeLookupInput | undefined,
  result: Pick<RepresentativeLookupResult, 'status' | 'address'> | null | undefined,
  currentAddress: string,
): string | undefined {
  if (typeof input !== 'string' || result?.status !== 'found') return undefined;
  if (
    prepareAddressLookup(input).serviceAddress !==
    prepareAddressLookup(currentAddress).serviceAddress
  ) {
    return undefined;
  }
  return prepareAddressLookup(result.address).serviceAddress;
}

export function viewStateForLookup(input: {
  pending?: boolean;
  found?: boolean;
  choices?: number;
  vacant?: boolean;
  error?: 'not-found' | 'outside-minnesota' | 'location' | 'rate-limited' | 'service-down';
}): FindLegislatorState {
  if (input.pending) return 'looking';
  if (input.choices) return 'choice';
  if (input.error === 'not-found') return 'not-found';
  if (input.error === 'outside-minnesota') return 'outside-minnesota';
  if (input.error === 'location') return 'location-error';
  if (input.error === 'rate-limited') return 'rate-limited';
  if (input.error === 'service-down') return 'service-down';
  if (input.found && input.vacant) return 'vacant';
  if (input.found) return 'found';
  return 'empty';
}

export function retryWaitSeconds(retryAfterSeconds?: number | null): number {
  const seconds = Number.isFinite(retryAfterSeconds) ? Math.ceil(retryAfterSeconds!) : 60;
  return Math.min(60, Math.max(1, seconds));
}

export function addressChoiceKey(
  key: string,
  index: number,
  count: number,
): { index: number; action: 'move' | 'choose' | 'close' } | null {
  if (count < 1) return null;
  if (key === 'ArrowDown') return { index: (index + 1) % count, action: 'move' };
  if (key === 'ArrowUp') return { index: (index - 1 + count) % count, action: 'move' };
  if (key === 'Enter') return { index, action: 'choose' };
  if (key === 'Escape') return { index, action: 'close' };
  return null;
}

export function legislatureLabel(session: string | SessionDisplaySource): string {
  return formatLegislatureLabel(session).toUpperCase();
}

export function contactEmail(value?: string | null): string | undefined {
  const cleaned = value?.trim().replace(/^mailto:/i, '');
  return cleaned && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned) ? cleaned : undefined;
}

export function senateProfileUrl(value?: string | null): string | undefined {
  if (!value) return undefined;
  const match = value.match(/[?&]leg_id=(\d+)/i);
  return match
    ? `https://www.senate.mn/members/member_bio.html?leg_id=${match[1]}`
    : value.replace(/^http:/i, 'https:');
}
