import type { IdentitySummary } from './types';

/** Show only a held confirmed-record count below a split part's name. */
export function splitPartSub(part: IdentitySummary): string {
  const count = part.status === 'active' ? (part.confirmed_records ?? null) : null;
  return count === null
    ? ''
    : `${count.toLocaleString('en-US')} confirmed ${count === 1 ? 'record' : 'records'}`;
}

/** The id a part's link opens: a part later merged opens the record it became. */
export function splitPartTarget(part: IdentitySummary): string {
  return part.status === 'merged' && part.redirect_to ? part.redirect_to : part.id;
}
