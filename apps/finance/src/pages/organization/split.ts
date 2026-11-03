import type { IdentitySummary } from './types';

/** A split part's line under its name (Organization and Person drawings, Round 39):
 * "ORG-0043 · 2 confirmed records". The count is the served one; a part with no count
 * held (a file not held, or a part later merged) shows its reference alone, never 0.
 * The internal id is never printed. */
export function splitPartSub(part: IdentitySummary): string {
  const counted = part.status === 'active' ? (part.confirmed_records ?? null) : null;
  return [
    part.reference,
    counted === null
      ? null
      : `${counted.toLocaleString('en-US')} confirmed ${counted === 1 ? 'record' : 'records'}`,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** The id a part's link opens: a part later merged opens the record it became. */
export function splitPartTarget(part: IdentitySummary): string {
  return part.status === 'merged' && part.redirect_to ? part.redirect_to : part.id;
}
